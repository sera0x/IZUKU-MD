import { createHash, createHmac } from 'node:crypto'

/**
 * Optional card-art backup to Cloudflare R2 (S3-compatible API).
 *
 * Enabled only when all of these env vars are set; otherwise every call is a
 * silent no-op:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * Optional: R2_PREFIX (default "cards/").
 *
 * Failures are logged and swallowed; a backup must never break card delivery.
 */

type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; prefix: string }

function r2Config(): R2Config | undefined {
    const env = process.env
    const accountId = env.R2_ACCOUNT_ID?.trim()
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim()
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim()
    const bucket = env.R2_BUCKET?.trim()
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined
    return { accountId, accessKeyId, secretAccessKey, bucket, prefix: env.R2_PREFIX?.trim() || 'cards/' }
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** AWS SigV4 PUT for R2 (region is always "auto"). */
function signedPut(cfg: R2Config, key: string, body: Buffer, contentType: string): { url: string; headers: Record<string, string> } {
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`
    const path = `/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = sha256Hex(body)
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request')
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
    return {
        url: `https://${host}${path}`,
        headers: {
            'content-type': contentType,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
    }
}

/**
 * Upload a card art buffer to R2 under `<prefix><cardId>.<ext>`. Skips silently
 * when R2 is not configured. Returns true only when R2 accepted the object.
 */
export async function backupCardArt(cardId: string, buffer: Buffer, ext: string): Promise<boolean> {
    const cfg = r2Config()
    if (!cfg || !buffer.length) return false
    const key = `${cfg.prefix}${cardId}.${ext}`
    const contentType = ext === 'mp4' ? 'video/mp4' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg'
    try {
        const { url, headers } = signedPut(cfg, key, buffer, contentType)
        const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(buffer), signal: AbortSignal.timeout(15000) })
        if (!response.ok) {
            console.warn(`[card-backup] R2 PUT ${key} failed: ${response.status}`)
            return false
        }
        return true
    } catch (error) {
        console.warn(`[card-backup] R2 PUT ${key} error: ${(error as Error).message}`)
        return false
    }
}

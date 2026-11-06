import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AuthenticationCreds } from 'baileys'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'

const log = createLogger(config.logLevel, { scope: 'vault' })

const ENV_FILE = resolve('.env')
const FALLBACK_KEY_FILE = resolve('data/deployment.key')
const PLAIN_CREDS = 'creds.json'
const SEALED_CREDS = 'creds.json.enc'
const VERSION = 'v1'

const envFlag = (name: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes((process.env[name] ?? '').trim().toLowerCase())

/**
 * Key that ties the stored WhatsApp session to this deployment.
 *
 * The session on disk is encrypted with it, so copying `data/session` (or
 * shipping a `SESSION_ID` around) produces a folder that cannot be opened on
 * another install: that install generates its own key. Set `DEPLOYMENT_KEY`
 * yourself to move a session on purpose; `SESSION_VAULT=off` disables the
 * encryption entirely.
 */
export function deploymentKey(): string {
    const configured = (process.env.DEPLOYMENT_KEY ?? '').trim()
    if (configured.length >= 16) return configured

    if (existsSync(FALLBACK_KEY_FILE)) {
        const stored = readFileSync(FALLBACK_KEY_FILE, 'utf8').trim()
        if (stored.length >= 16) {
            process.env.DEPLOYMENT_KEY = stored
            return stored
        }
    }

    const generated = randomBytes(32).toString('base64url')

    try {
        mkdirSync(resolve('.'), { recursive: true })
        writeFileSync(
            ENV_FILE,
            `${existsSync(ENV_FILE) ? '\n' : ''}# Generated once. Encrypts the stored WhatsApp session — keep it secret.\nDEPLOYMENT_KEY=${generated}\n`,
            { flag: 'a', mode: 0o600 },
        )
        process.env.DEPLOYMENT_KEY = generated
        log.info('Generated DEPLOYMENT_KEY in .env — the stored session is encrypted with it.')
        return generated
    } catch (error) {
        log.warn('Could not write .env (%s); keeping the key beside the session instead.', (error as Error).message)
    }

    mkdirSync(resolve('data'), { recursive: true })
    writeFileSync(FALLBACK_KEY_FILE, `${generated}\n`, { mode: 0o600 })
    process.env.DEPLOYMENT_KEY = generated
    return generated
}

const cipherKey = (secret: string): Buffer =>
    createHash('sha256').update(`izuku.session.v1:${secret}`).digest()

type Buffered = { type?: string; data?: unknown }

// Credentials carry key material as Buffers. Plain JSON turns those into
// `{ type: 'Buffer', data: [...] }`, and a noise key restored that way makes the
// handshake allocate NaN bytes. These mirror Baileys' BufferJSON helpers.
const replacer = (_key: string, value: unknown): unknown => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || (value as Buffered | null)?.type === 'Buffer') {
        const raw = (value as Buffered | null)?.data ?? value
        return { type: 'Buffer', data: Buffer.from(raw as ArrayBufferLike).toString('base64') }
    }

    return value
}

const reviver = (_key: string, value: unknown): unknown => {
    const candidate = value as Buffered | null

    if (candidate && candidate.type === 'Buffer' && typeof candidate.data === 'string') {
        return Buffer.from(candidate.data, 'base64')
    }

    return value
}

function encrypt(secret: string, plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', cipherKey(secret), iv)
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

    return [
        VERSION,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        body.toString('base64'),
    ].join('.')
}

function decrypt(secret: string, payload: string): string {
    const [version, iv, tag, body] = payload.trim().split('.')
    if (version !== VERSION || !iv || !tag || !body) throw new Error('unrecognised session file')

    const decipher = createDecipheriv('aes-256-gcm', cipherKey(secret), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))

    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
}

const vaultEnabled = (): boolean => !envFlag('SESSION_VAULT_OFF')

const sealedPath = (): string => join(config.sessionDir, SEALED_CREDS)
const plainPath = (): string => join(config.sessionDir, PLAIN_CREDS)

/** Tighten permissions on the files that carry the session. */
export function hardenPermissions(): void {
    const targets: { path: string; mode: number }[] = [
        { path: config.sessionDir, mode: 0o700 },
        { path: sealedPath(), mode: 0o600 },
        { path: plainPath(), mode: 0o600 },
        { path: ENV_FILE, mode: 0o600 },
    ]
    if (config.dbPath !== ':memory:') targets.push({ path: config.dbPath, mode: 0o600 })

    for (const target of targets) {
        try {
            if (existsSync(target.path)) chmodSync(target.path, target.mode)
        } catch {
            // best effort — a read-only volume is not a reason to fail startup
        }
    }
}

/**
 * Load the stored credentials.
 *
 * A sealed file that cannot be opened belongs to a different deployment. That
 * is refused loudly rather than silently starting a fresh pairing: pairing
 * again would throw away the only copy of a real session.
 */
export function loadCreds(): AuthenticationCreds | null {
    mkdirSync(config.sessionDir, { recursive: true })

    if (existsSync(sealedPath())) {
        const payload = readFileSync(sealedPath(), 'utf8')

        try {
            return JSON.parse(decrypt(deploymentKey(), payload), reviver) as AuthenticationCreds
        } catch (error) {
            log.fatal('The stored WhatsApp session belongs to another deployment (it cannot be decrypted here).')
            log.fatal('It was not started, and it was not overwritten.')
            log.fatal('Restore this deployment\'s original DEPLOYMENT_KEY in .env, or delete %s to pair again.', config.sessionDir)
            log.fatal('Detail: %s', (error as Error).message)
            process.exit(78)
        }
    }

    if (!existsSync(plainPath())) return null

    try {
        return JSON.parse(readFileSync(plainPath(), 'utf8'), reviver) as AuthenticationCreds
    } catch {
        return null
    }
}

export function writeCreds(creds: AuthenticationCreds): void {
    mkdirSync(config.sessionDir, { recursive: true })

    if (!vaultEnabled()) {
        writeFileSync(plainPath(), JSON.stringify(creds, replacer), { mode: 0o600 })
        return
    }

    const target = sealedPath()
    const temporary = `${target}.tmp`
    writeFileSync(temporary, encrypt(deploymentKey(), JSON.stringify(creds, replacer)), { mode: 0o600 })
    renameSync(temporary, target)

    // The plaintext copy is only ever a migration leftover.
    if (existsSync(plainPath())) rmSync(plainPath(), { force: true })
}

/** Encrypt credentials left in plaintext by an older version. */
export function migrateCreds(): void {
    if (!vaultEnabled() || existsSync(sealedPath()) || !existsSync(plainPath())) return

    const creds = loadCreds()
    if (!creds) return

    try {
        writeCreds(creds)
        log.info('Encrypted the stored WhatsApp session with this deployment\'s key.')
    } catch (error) {
        log.warn('Could not encrypt the stored session: %s', (error as Error).message)
    }
}

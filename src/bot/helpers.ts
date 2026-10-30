import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloadContentFromMessage, getContentType, type proto, type WAMessage } from 'baileys'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'

const exec = promisify(execFile)

const bundledFfmpeg = ffmpegPath as unknown as string | null
export const FFMPEG = process.env.FFMPEG_PATH || bundledFfmpeg || 'ffmpeg'

/**
 * Resolve with `fallback` when a promise takes too long or rejects. Some
 * WhatsApp queries (USync status) never settle when the server ignores them,
 * which would leave a command hanging with no reply.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        let done = false
        const finish = (value: T): void => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(value)
        }

        const timer = setTimeout(() => finish(fallback), ms)
        timer.unref?.()

        promise.then(
            (value) => finish(value),
            () => finish(fallback),
        )
    })
}

export function jidToNumber(jid: string): string {
    return jid.split('@')[0]?.split(':')[0] ?? ''
}

export function userName(jid: string): string {
    return jidToNumber(jid)
}

export function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | undefined {
    if (!message) return undefined
    const wrapper =
        message.ephemeralMessage ??
        message.viewOnceMessage ??
        message.viewOnceMessageV2 ??
        message.viewOnceMessageV2Extension ??
        message.statusMentionMessage ??
        message.documentWithCaptionMessage ??
        message.deviceSentMessage ??
        message.editedMessage ??
        message.associatedChildMessage ??
        message.groupStatusMessage ??
        message.groupStatusMessageV2
    const inner = wrapper && 'message' in wrapper ? wrapper.message : undefined
    return inner ? unwrapMessage(inner) : message
}

export function messageType(message: proto.IMessage | null | undefined): string | undefined {
    const unwrapped = unwrapMessage(message)
    return unwrapped ? getContentType(unwrapped) : undefined
}

export function extractText(message: proto.IMessage | null | undefined): string {
    const unwrapped = unwrapMessage(message)
    if (!unwrapped) return ''
    return (
        unwrapped.conversation ||
        unwrapped.extendedTextMessage?.text ||
        unwrapped.imageMessage?.caption ||
        unwrapped.videoMessage?.caption ||
        unwrapped.documentMessage?.caption ||
        unwrapped.buttonsResponseMessage?.selectedButtonId ||
        unwrapped.listResponseMessage?.singleSelectReply?.selectedRowId ||
        ''
    )
}

export function contextInfoOf(message: proto.IMessage | null | undefined): proto.IContextInfo | undefined {
    const content = unwrapMessage(message)
    if (!content) return undefined
    return (
        content.extendedTextMessage?.contextInfo ??
        content.imageMessage?.contextInfo ??
        content.videoMessage?.contextInfo ??
        content.documentMessage?.contextInfo ??
        content.stickerMessage?.contextInfo ??
        content.audioMessage?.contextInfo ??
        undefined
    )
}

export interface QuotedMedia {
    message: proto.IMessage
    mimetype: string
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker'
}

/**
 * Find the context of the message being replied to. Some client versions wrap
 * status replies so the quote is not in the first contextInfo; walk the tree
 * until a context carrying a quoted message shows up.
 */
export function quotedContext(
    message: proto.IMessage | null | undefined,
): proto.IContextInfo | undefined {
    const direct = contextInfoOf(message)
    if (direct?.quotedMessage) return direct

    const seen = new Set<unknown>()
    const walk = (value: unknown, depth: number): proto.IContextInfo | undefined => {
        if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return undefined
        seen.add(value)

        const record = value as Record<string, unknown>
        if (record.quotedMessage && typeof record.quotedMessage === 'object') {
            return record as proto.IContextInfo
        }

        for (const child of Object.values(record)) {
            const found = walk(child, depth + 1)
            if (found) return found
        }
        return undefined
    }

    // Status replies carry the status key instead of a quoted message.
    return walk(message, 0) ?? direct
}

export function quotedMedia(msg: WAMessage): QuotedMedia | null {
    const context = quotedContext(msg.message)
    const quoted = context?.quotedMessage
    if (!quoted) return null

    const unwrapped = unwrapMessage(quoted)
    if (!unwrapped) return null
    const type = getContentType(unwrapped)
    if (!type) return null

    const content = unwrapped[type] as { mimetype?: string } | undefined
    const base = type.replace(/Message$/, '') as QuotedMedia['type']
    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(base)) return null

    return { message: unwrapped, mimetype: content?.mimetype ?? '', type: base }
}

export async function downloadQuotedMedia(msg: WAMessage): Promise<{ buffer: Buffer; mimetype: string } | null> {
    const media = quotedMedia(msg)
    if (!media) return null
    return downloadMedia(media.message, media.type)
}

export async function downloadMedia(
    message: proto.IMessage,
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker',
): Promise<{ buffer: Buffer; mimetype: string }> {
    const key = (`${type}Message`) as keyof proto.IMessage
    const content = message[key] as { mimetype?: string; fileLength?: number } | undefined
    if (!content) throw new Error(`No ${type} content in message`)

    const stream = await downloadContentFromMessage(content as never, type)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer)
    }

    return { buffer: Buffer.concat(chunks), mimetype: content.mimetype ?? 'application/octet-stream' }
}

export async function convert(buffer: Buffer, inputExt: string, outputExt: string, args: string[]): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'izuku-'))
    const input = join(dir, `input.${inputExt}`)
    const output = join(dir, `output.${outputExt}`)

    try {
        await writeFile(input, buffer)
        await exec(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...args, output], {
            maxBuffer: 32 * 1024 * 1024,
        })
        return await readFile(output)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

export const toSticker = (buffer: Buffer, inputExt: string, animated: boolean): Promise<Buffer> =>
    convert(buffer, inputExt, 'webp', [
        ...(animated ? ['-t', '6', '-r', '12'] : []),
        '-vf',
        'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-c:v',
        'libwebp',
        '-preset',
        'default',
        '-an',
        '-vsync',
        '0',
        '-s',
        '512:512',
        '-loop',
        '0',
        '-q:v',
        '60',
    ])

export const toImage = (buffer: Buffer, inputExt: string): Promise<Buffer> =>
    convert(buffer, inputExt, 'png', ['-vf', 'scale=512:512:force_original_aspect_ratio=decrease'])

export const toMp3 = (buffer: Buffer, inputExt: string): Promise<Buffer> =>
    convert(buffer, inputExt, 'mp3', ['-vn', '-ac', '2', '-b:a', '128k'])

// Cap animated card art at 640px wide, keep aspect ratio, even dimensions so WhatsApp renders it in proportion.
// ffmpeg splits a filtergraph on commas, so the comma inside min() must be
// escaped — unescaped it fails with "No such filter: '640)/2)*2:-2'" and every
// animated card silently fell back to generated art.
const MP4_ARGS = ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-crf', '18', '-vf', 'scale=trunc(min(iw\\,640)/2)*2:-2']

async function webpFrameCount(buffer: Buffer): Promise<number> {
    try {
        const metadata = await sharp(buffer, { animated: true }).metadata()
        return metadata.pages ?? 1
    } catch {
        return 0
    }
}

async function webpToGif(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer, { animated: true }).gif().toBuffer()
}

export async function toMp4(buffer: Buffer, inputExt: string): Promise<Buffer> {
    if (inputExt !== 'webp') {
        return convert(buffer, inputExt, 'mp4', MP4_ARGS)
    }

    const pages = await webpFrameCount(buffer)
    if (pages > 1) {
        // ffmpeg's WebP decoder rejects animated WhatsApp stickers. libvips
        // (sharp) reads every frame, so give ffmpeg an animated GIF instead.
        const gif = await webpToGif(buffer)
        return convert(gif, 'gif', 'mp4', MP4_ARGS)
    }

    try {
        return await convert(buffer, 'webp', 'mp4', MP4_ARGS)
    } catch (error) {
        // Some static WebP files also trip the bundled decoder. Retry through
        // libvips before surfacing the original ffmpeg error.
        try {
            const gif = await webpToGif(buffer)
            return await convert(gif, 'gif', 'mp4', MP4_ARGS)
        } catch {
            throw error
        }
    }
}

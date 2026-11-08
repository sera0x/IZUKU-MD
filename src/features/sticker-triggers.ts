import { createHash } from 'node:crypto'
import type { proto, WAMessage } from 'baileys'
import { quotedContext, unwrapMessage } from '../bot/helpers.js'
import { db } from '../db/index.js'

const hex = (value: Uint8Array | null | undefined): string =>
    value && value.length ? Buffer.from(value).toString('hex') : ''

export function stickerHash(message: proto.IMessage | null | undefined): string {
    const sticker = unwrapMessage(message)?.stickerMessage
    if (!sticker) return ''

    const raw = hex(sticker.fileSha256) || hex(sticker.fileEncSha256)
    if (raw) return createHash('sha256').update(raw).digest('hex').slice(0, 32)
    return ''
}

export function stickerHashOfMessage(msg: WAMessage): string {
    return stickerHash(msg.message)
}

export function quotedStickerHash(msg: WAMessage): string {
    return stickerHash(quotedContext(msg.message)?.quotedMessage)
}

export function stickerCommand(msg: WAMessage): string {
    const hash = stickerHashOfMessage(msg)
    return hash ? db.stickerTrigger(hash) : ''
}

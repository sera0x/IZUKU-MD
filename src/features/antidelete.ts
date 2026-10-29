import { downloadContentFromMessage, proto, type WASocket, type WAMessage } from 'baileys'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { jidToNumber, unwrapMessage } from '../bot/helpers.js'
import { findStoredMessage, getStoredMessage, storedSenderName, type StoredMessage } from './message-store.js'
import { db } from '../db/index.js'

const log = createLogger(config.logLevel, { scope: 'antidelete' })

type MediaDownloader = typeof downloadContentFromMessage
let mediaDownloader: MediaDownloader = downloadContentFromMessage

/** Test seam: media re-download needs a live WhatsApp connection. */
export function setAntideleteMediaDownloader(downloader: MediaDownloader): void {
    mediaDownloader = downloader
}

// Moderation deletes must not be restored by anti-delete, otherwise antilink
// would immediately undo its own work.
const botDeletes = new Set<string>()

// WhatsApp can replay the same revoke event after a reconnect. Remember which
// deletions were already handled so a recovery is never sent twice.
const handledRevokes = new Set<string>()

export function markBotDelete(id: string | null | undefined): void {
    if (!id) return
    botDeletes.add(id)
    if (botDeletes.size > 500) {
        const first = botDeletes.values().next().value
        if (first) botDeletes.delete(first)
    }
}

function rememberRevoke(id: string): boolean {
    if (handledRevokes.has(id)) return false
    handledRevokes.add(id)
    if (handledRevokes.size > 1_000) {
        const first = handledRevokes.values().next().value
        if (first) handledRevokes.delete(first)
    }
    return true
}

const isBroadcastJid = (jid: string | null | undefined): boolean =>
    typeof jid === 'string' && (jid === 'status@broadcast' || jid.endsWith('@broadcast'))



// `sudo` is gone: forwarding every recovered message to multiple sudo users
// leaked private chats. Recovery now stays in the chat it happened in, or goes
// to one explicitly configured personal chat.
export type AntiDeleteMode = 'off' | 'same' | 'bot' | 'jid'

export function isAntiDeleteEnabled(): boolean {
    return config.antiDelete.mode !== 'off'
}

// The owner's real DM jid, learned from traffic. WhatsApp sessions can run
// personal chats as @lid jids, so a synthesized `<number>@s.whatsapp.net`
// may not resolve — the jid the owner actually writes from always does.
let learnedOwnerChat: string | null = null

/** Record a private chat jid as the owner chat if the sender is the owner. */
export function noteOwnerChat(senderJid: string | undefined, chatJid: string): void {
    if (!senderJid || !chatJid || chatJid.endsWith('@g.us')) return
    const number = jidNumber(senderJid)
    if (!number) return
    if (config.owners.some((owner) => owner === number)) learnedOwnerChat = chatJid
}

function jidNumber(jid: string): string {
    return (jid.split('@')[0] ?? '').split(':')[0] ?? ''
}

function destinations(chat: string): string[] {
    switch (config.antiDelete.mode) {
        case 'same':
            return [chat].filter(Boolean)
        case 'bot': {
            // The owner chat: prefer the jid the owner actually writes from
            // (handles @lid sessions), fall back to the number form.
            if (learnedOwnerChat) return [learnedOwnerChat]
            const owner = config.anchorNumber || config.owners[0]
            return owner ? [`${owner}@s.whatsapp.net`] : []
        }
        case 'jid':
            return config.antiDelete.jid ? [`${config.antiDelete.jid}@s.whatsapp.net`] : []
        default:
            return []
    }
}


async function recover(
    sock: WASocket,
    dest: string,
    content: proto.IMessage,
    senderName: string,
): Promise<boolean> {
    const header = `*🪄 Message deleted by ${senderName}*`
    // Plain text: normal path, proven deliverable. Raw proto text fields are
    // rejected by sendMessage and silently dropped by relayMessage.
    if (typeof content.conversation === 'string') {
        await sock.sendMessage(dest, { text: `${header}\n\n${content.conversation}` })
        return true
    }
    const ext = content.extendedTextMessage
    if (ext && typeof ext.text === 'string') {
        await sock.sendMessage(dest, { text: `${header}\n\n${ext.text}` })
        return true
    }

    // Media: re-download with the stored keys, upload fresh.
    const MEDIA: Record<string, string> = {
        imageMessage: 'image',
        videoMessage: 'video',
        audioMessage: 'audio',
        stickerMessage: 'sticker',
        documentMessage: 'document',
    }
    for (const key of Object.keys(MEDIA)) {
        const rec = content as unknown as Record<string, Record<string, unknown>>
        const media = rec[key]
        if (!media) continue
        const kind = MEDIA[key] as 'image' | 'video' | 'audio' | 'sticker' | 'document'
        const stream = await mediaDownloader(media as never, kind)
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        const buffer = Buffer.concat(chunks)
        const caption = typeof media.caption === 'string' ? media.caption : undefined
        await sock.sendMessage(dest, { text: header })
        if (kind === 'image') await sock.sendMessage(dest, { image: buffer, caption })
        else if (kind === 'video') await sock.sendMessage(dest, { video: buffer, caption })
        else if (kind === 'audio') await sock.sendMessage(dest, { audio: buffer, mimetype: 'audio/mpeg' })
        else if (kind === 'sticker') await sock.sendMessage(dest, { sticker: buffer })
        else await sock.sendMessage(dest, { document: buffer, mimetype: 'application/octet-stream' })
        return true
    }

    log.warn('anti-delete: unsupported content type for recovery')
    return false
}


/**
 * Handle a revoke (`protocolMessage.type === 0`) by resending the cached
 * original message. Returns true when the message was a revoke so the
 * pipeline stops processing it as a normal message.
 */
export async function handleAntiDelete(sock: WASocket, msg: WAMessage): Promise<boolean> {
    const protocol = unwrapMessage(msg.message)?.protocolMessage
    if (!protocol) return false

    const rawType = protocol.type as unknown
    const numericType =
        typeof rawType === 'object' && rawType !== null && 'toNumber' in rawType
            ? (rawType as { toNumber: () => number }).toNumber()
            : Number(rawType)
    // Some clients omit the enum on a revoke wrapper. A protocol message with
    // a target key but no type is still a revoke candidate; other protocol
    // types (edits, history sync, keys) must never be restored as deletes.
    const isRevoke =
        numericType === 0 ||
        String(rawType).toUpperCase() === 'REVOKE' ||
        ((rawType === undefined || rawType === null) && Boolean(protocol.key?.id))
    if (!isRevoke) {
        log.debug('anti-delete: ignoring protocol type %s', String(rawType))
        return false
    }

    const deletedKey = protocol.key
    const id = deletedKey?.id
    const chat = msg.key.remoteJid
    if (!id || !chat) return true

    // Deleted statuses are never relayed. They belong to the person who posted
    // them, and forwarding them anywhere else would leak private content.
    // Check every JID on the revoke: some clients deliver a status deletion
    // through a normal-looking wrapper while the target key is the status.
    const outer = msg.key as { remoteJidAlt?: string }
    const deleted = deletedKey as { remoteJid?: string; remoteJidAlt?: string } | undefined
    if (
        isBroadcastJid(chat) ||
        isBroadcastJid(outer.remoteJidAlt) ||
        isBroadcastJid(deleted?.remoteJid) ||
        isBroadcastJid(deleted?.remoteJidAlt)
    ) {
        log.debug('anti-delete: ignoring a deleted status for privacy')
        return true
    }
    if (!isAntiDeleteEnabled()) return true

    if (botDeletes.delete(id)) {
        log.debug('anti-delete: ignoring a message deleted by the bot')
        return true
    }

    if (!rememberRevoke(id)) {
        log.debug('anti-delete: duplicate revoke for %s ignored', id)
        return true
    }

    log.info('anti-delete: revoke for %s in %s', id, chat)

    const storeChat = deletedKey?.remoteJid ?? chat
    const entry: StoredMessage | undefined =
        getStoredMessage(storeChat, id) ??
        (storeChat !== chat ? getStoredMessage(chat, id) : undefined) ??
        findStoredMessage(id)

    // Never post into a group without an active .agb live. Owner DM copies are unaffected.
    const destinationList = destinations(chat).filter((dest) => !dest.endsWith('@g.us') || db.gameActive(dest))
    if (!destinationList.length) return true

    // With no cached copy the original sender is unknown, but the revoke still
    // carries who deleted it — better than printing "unknown".
    const deleter = msg.key.participant ?? chat
    const senderName = entry
        ? storedSenderName(entry) || 'unknown'
        : (msg.pushName ?? '').trim() || jidToNumber(deleter) || 'unknown'


    if (!entry) {
        log.debug('anti-delete: no cached copy for %s; sending a notice', id)
        for (const raw of destinationList) {
            const dest = raw
            await sock
                .sendMessage(dest, { text: `Message deleted from *${senderName}*` })
                .catch(() => undefined)
        }
        return true
    }


    for (const raw of destinationList) {
        // Relay to the exact chat the revoke arrived in (asamake behaviour).
        const dest = raw
        try {
            const restored = await recover(sock, dest, entry.message, senderName)
            if (!restored) {
                log.warn('anti-delete: nothing to restore for %s', id)
                await sock.sendMessage(dest, { text: `Message deleted from *${senderName}*` }).catch(() => undefined)
                continue
            }
            log.info('anti-delete: recovered a message from %s to %s', senderName, dest)
        } catch (error) {
            log.warn('anti-delete: recovery failed: %s', (error as Error).message)
            await sock
                .sendMessage(dest, { text: `Message deleted from *${senderName}*` })
                .catch(() => undefined)
        }
    }

    return true
}

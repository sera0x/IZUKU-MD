import { jidNormalizedUser, type WAMessage, type WASocket } from 'baileys'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { runtime } from '../runtime.js'
import { phoneJidFor, rememberIdentityPair } from '../bot/identity.js'

const log = createLogger(config.logLevel, { scope: 'status-view' })

const STATUS_JID = 'status@broadcast'

interface StatusKey {
    participant?: string
    participantAlt?: string
    remoteJid?: string
    remoteJidAlt?: string
    fromMe?: boolean
    id?: string
}

export function statusParticipant(msg: WAMessage): string | undefined {
    const key = msg.key as StatusKey
    const extra = msg as unknown as { participant?: string }

    return [key.participant, key.participantAlt, key.remoteJidAlt, extra.participant].find(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )
}

function rememberStatusIdentity(msg: WAMessage): void {
    const key = msg.key as StatusKey
    const extra = msg as unknown as { participant?: string }
    const hints = [key.participant, key.participantAlt, key.remoteJidAlt, extra.participant].filter(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )

    const lid = hints.find((jid) => jid.endsWith('@lid'))
    const pn = hints.find((jid) => jid.endsWith('@s.whatsapp.net'))
    if (lid && pn) rememberIdentityPair(lid, pn)
}

export async function viewStatus(sock: WASocket, msg: WAMessage): Promise<void> {
    if (!runtime.autoReadStatus) return
    if (msg.key.fromMe === true) return
    if (msg.message?.protocolMessage || msg.message?.reactionMessage) return

    const id = msg.key.id
    if (!id) return

    const participant = statusParticipant(msg)
    if (!participant) return

    rememberIdentityPair(participant, (msg.key as StatusKey).participantAlt)
    rememberStatusIdentity(msg)

    const resolved = await phoneJidFor(sock, participant)
    const senderJid = resolved || jidNormalizedUser(participant) || participant

    const receiptTargets = [...new Set([senderJid, jidNormalizedUser(participant) || participant].filter(Boolean))]
    let delivered = false

    for (const target of receiptTargets) {
        try {
            await sock.sendReceipt(STATUS_JID, target, [id], 'read')
            delivered = true
            log.info('status viewed from %s', target)
        } catch (error) {
            log.warn('status read failed for %s: %s', target, (error as Error).message)
        }
    }

    if (!delivered) {
        await sock.readMessages([{ remoteJid: STATUS_JID, id, participant: senderJid }]).catch(() => undefined)
    }

    const emoji = config.status.react.trim()
    if (!emoji || emoji.toLowerCase() === 'off') return

    const self = await phoneJidFor(sock, sock.user?.id)
    const selfJid = self || (sock.user?.id ? jidNormalizedUser(sock.user.id) : '')
    const statusJidList = [...new Set([senderJid, selfJid].filter(Boolean))]

    try {
        await sock.sendMessage(
            STATUS_JID,
            {
                react: {
                    text: emoji,
                    key: {
                        remoteJid: STATUS_JID,
                        fromMe: false,
                        id,
                        participant: senderJid,
                    },
                },
            },
            { statusJidList },
        )
    } catch (error) {
        log.debug('status reaction failed: %s', (error as Error).message)
    }
}

export async function handleStatusView(sock: WASocket, msg: WAMessage): Promise<void> {
    if (!runtime.autoReadStatus) return
    if (msg.key.fromMe === true) return
    if (msg.message?.protocolMessage || msg.message?.reactionMessage) return

    const delay = Math.max(0, config.status.delayMs)
    if (delay === 0) {
        await viewStatus(sock, msg)
        return
    }

    const timer = setTimeout(() => {
        if (!runtime.autoReadStatus) return
        void viewStatus(sock, msg)
    }, delay)
    timer.unref?.()
}

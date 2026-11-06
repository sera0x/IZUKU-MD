import { createHash, randomBytes } from 'node:crypto'
import { jidNormalizedUser, type WAMessage, type WASocket } from 'baileys'
import { decryptPollVote } from 'baileys/lib/Utils/process-message.js'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { unwrapMessage } from './helpers.js'
import type { PollHandler } from './types.js'

const log = createLogger(config.logLevel, { scope: 'polls' })

interface PendingPoll {
    chat: string
    creators: string[]
    secret: Uint8Array
    options: string[]
    selectableCount: number
    onSelect?: PollHandler
    expires: number
}

const TTL = 30 * 60 * 1000
const pending = new Map<string, PendingPoll>()

const keyOf = (chat: string, id: string): string => `${chat}|${id}`
const hashOf = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * Poll vote encryption uses a JID in its signature. Depending on the account
 * and chat type WhatsApp may use the device form, the normalised form, the
 * phone JID or the LID. Keep both forms for every candidate.
 */
const jidVariants = (jids: Array<string | null | undefined>): string[] =>
    [
        ...new Set(
            jids
                .filter((jid): jid is string => typeof jid === 'string' && jid.length > 0)
                .flatMap((jid) => [jid, jidNormalizedUser(jid)])
                .filter(Boolean),
        ),
    ]

const findById = (id: string): PendingPoll | undefined => {
    for (const [key, entry] of pending) {
        if (key.endsWith(`|${id}`)) return entry
    }
    return undefined
}

function remember(entry: PendingPoll, id: string): void {
    pending.set(keyOf(entry.chat, id), entry)
    for (const [key, poll] of pending) {
        if (poll.expires < Date.now()) pending.delete(key)
    }
}

export async function sendPoll(
    sock: WASocket,
    chat: string,
    msg: WAMessage,
    question: string,
    options: string[],
    onSelect?: PollHandler,
    secretOverride?: Uint8Array,
): Promise<unknown> {
    const clean = options.map((option) => option.trim()).filter(Boolean).slice(0, 12)
    if (!clean.length) return undefined

    const secret = secretOverride ?? new Uint8Array(randomBytes(32))
    const creators = jidVariants([sock.user?.id, sock.user?.lid])
    const sent = await sock.sendMessage(
        chat,
        { poll: { name: question, values: clean, selectableCount: 1, messageSecret: secret } },
        { quoted: msg },
    )

    const id = sent?.key?.id
    if (id) {
        remember(
            {
                chat,
                creators,
                secret,
                options: clean,
                selectableCount: 1,
                onSelect,
                expires: Date.now() + TTL,
            },
            id,
        )
    }

    return sent
}

export async function handlePollUpdate(
    sock: WASocket,
    msg: WAMessage,
    chat: string,
    sender: string,
): Promise<boolean> {
    const update = unwrapMessage(msg.message)?.pollUpdateMessage
    const id = update?.pollCreationMessageKey?.id
    if (!update || !id) return false

    const creationChat = update.pollCreationMessageKey?.remoteJid
    const pendingKey = keyOf(chat, id)
    const entry =
        pending.get(pendingKey) ??
        (creationChat ? pending.get(keyOf(creationChat, id)) : undefined) ??
        findById(id)
    if (!entry) {
        log.debug('poll vote for unknown poll %s in %s', id, chat)
        return true
    }
    if (entry.expires < Date.now()) {
        pending.delete(keyOf(entry.chat, id))
        return true
    }
    if (!update.vote) return true

    const msgKey = msg.key as { participantAlt?: string; remoteJidAlt?: string; participant?: string }
    const voter =
        chat.endsWith('@g.us') || msg.key.fromMe === true
            ? sender
            : msg.key.remoteJid ?? chat
    const voters = jidVariants([
        msgKey.participantAlt,
        msgKey.remoteJidAlt,
        msgKey.participant,
        msg.key.remoteJid,
        update.pollCreationMessageKey?.participant,
        sender,
        voter,
    ])

    let selected: string[] = []
    let decrypted: ReturnType<typeof decryptPollVote> | undefined
    let matchedVoter = ''

    for (const creator of entry.creators) {
        for (const candidate of voters) {
            try {
                decrypted = decryptPollVote(update.vote, {
                    pollCreatorJid: creator,
                    pollMsgId: id,
                    pollEncKey: entry.secret,
                    voterJid: candidate,
                })
                matchedVoter = candidate
                break
            } catch {
                continue
            }
        }
        if (decrypted) break
    }

    if (!decrypted) {
        log.warn('poll vote could not be decrypted for %s in %s', id, chat)
        return true
    }
    selected = (decrypted.selectedOptions ?? []).map((option) => Buffer.from(option).toString('hex'))

    const choices = selected
        .map((hash) => entry.options.find((option) => hashOf(option) === hash))
        .filter((option): option is string => Boolean(option))

    // Prefer the phone alias so per-user settings still resolve when a group
    // vote arrives as a LID without a participantAlt.
    const phoneSender = [msgKey.participantAlt, msgKey.remoteJidAlt, matchedVoter, sender, voter]
        .filter((jid): jid is string => typeof jid === 'string' && jid.length > 0)
        .map((jid) => jidNormalizedUser(jid))
        .find((jid) => jid.endsWith('@s.whatsapp.net'))
    const selectedSender = phoneSender || jidNormalizedUser(matchedVoter) || voter
    for (const option of choices) {
        await entry.onSelect?.({
            sock,
            chat: entry.chat,
            sender: selectedSender,
            msg,
            option,
            reply: (content) => sock.sendMessage(entry.chat, { text: content }, { quoted: msg }),
        })
    }

    if (entry.selectableCount === 1) pending.delete(keyOf(entry.chat, id))
    return true
}

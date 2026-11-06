import type { GroupMetadata, WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { jidToNumber } from '../bot/helpers.js'
import { phoneJidFor } from '../bot/identity.js'
import { cleanGroupName } from './text.js'

const log = createLogger(config.logLevel, { scope: 'groups' })

type Participant = string | { id: string; lid?: string; phoneNumber?: string }

export interface ParticipantUpdate {
    id: string
    participants: Participant[]
    action: 'add' | 'remove' | 'promote' | 'demote' | string
}

const participantId = (entry: Participant): string => (typeof entry === 'string' ? entry : entry.id)

const participantAliases = (entry: Participant): string[] => {
    if (typeof entry === 'string') return [entry]
    return [entry.id, entry.lid, entry.phoneNumber].filter(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )
}

const render = (template: string, values: Record<string, string>): string =>
    template.replace(/@(user|group|count)/g, (_, key: string) => values[key] ?? '')

async function removeBanned(
    sock: WASocket,
    chat: string,
    participants: Participant[],
): Promise<string[]> {
    const allowed: string[] = []
    const protectedNumbers = new Set([...config.owners, config.anchorNumber].filter(Boolean))

    for (const participant of participants) {
        const jid = participantId(participant)
        const aliases = participantAliases(participant)
        const phone = await phoneJidFor(sock, jid).catch(() => '')
        if (phone) aliases.push(phone)

        // Owners are never removed by the ban guard. A stale row under an old
        // LID must not be able to kick the account that controls the bot.
        if (aliases.some((alias) => protectedNumbers.has(jidToNumber(alias)))) {
            for (const alias of aliases) db.ban(alias, false)
            allowed.push(jid)
            continue
        }

        // Once the phone number is known it is the single source of truth. A
        // ban row left behind under the account's LID used to keep someone
        // banned even after `.unban` cleared their number, so every `.add`
        // removed them again one second later. A stale LID row no longer wins.
        const authoritative = phone
            ? aliases.filter((alias) => jidToNumber(alias) === jidToNumber(phone))
            : aliases

        if (!db.bannedAny(authoritative)) {
            allowed.push(jid)
            continue
        }

        try {
            await sock.groupParticipantsUpdate(chat, [jid], 'remove')
            log.info('removed banned participant %s from %s', jidToNumber(jid), chat)
        } catch (error) {
            log.warn('banned participant removal failed for %s: %s', jidToNumber(jid), (error as Error).message)
        }
    }

    return allowed
}

export async function enforceAntifake(sock: WASocket, chat: string, joined: string[]): Promise<string[]> {
    const settings = db.group(chat)
    if (!settings.antifake || config.blockedCountries.length === 0) return joined

    const allowed: string[] = []
    for (const jid of joined) {
        const number = jidToNumber(jid)
        const blocked = config.blockedCountries.some((code) => number.startsWith(code))
        if (!blocked) {
            allowed.push(jid)
            continue
        }

        try {
            await sock.groupParticipantsUpdate(chat, [jid], 'remove')
            // Removal still happens; the notice is an auto-send, so it needs .agb live.
            if (db.gameActive(chat)) await sock.sendMessage(chat, { text: `+${number} is not allowed in this group.` })
        } catch (error) {
            log.warn('antifake removal failed for %s: %s', number, (error as Error).message)
            allowed.push(jid)
        }
    }

    return allowed
}

export async function handleParticipantUpdate(
    sock: WASocket,
    update: ParticipantUpdate,
    metadata: GroupMetadata,
): Promise<void> {
    const settings = db.group(update.id)
    const count = String(metadata.participants.length)
    const ids = update.participants.map(participantId)
    const groupName = cleanGroupName(metadata.subject)

    if (update.action === 'add') {
        // A banned user can be re-added by any group admin. Remove them again
        // before welcome/antifake handling so they cannot rejoin silently.
        const allowed = await removeBanned(sock, update.id, update.participants)
        const joined = await enforceAntifake(sock, update.id, allowed)
        // Welcome only in groups with an active .agb live record.
        if (!settings.welcome || config.features.welcomeCard || !db.gameActive(update.id)) return

        for (const jid of joined) {
            const text = render(config.welcomeMessage, {
                user: `@${jidToNumber(jid)}`,
                group: groupName,
                count,
            })
            await sock.sendMessage(update.id, { text, mentions: [jid] }).catch((error: Error) => {
                log.warn('welcome failed: %s', error.message)
            })
        }
        return
    }

    // Goodbye only in groups with an active .agb live record.
    if (update.action === 'remove' && settings.goodbye && !config.features.welcomeCard && db.gameActive(update.id)) {
        for (const jid of ids) {
            const text = render(config.goodbyeMessage, {
                user: `@${jidToNumber(jid)}`,
                group: groupName,
                count,
            })
            await sock.sendMessage(update.id, { text, mentions: [jid] }).catch((error: Error) => {
                log.warn('goodbye failed: %s', error.message)
            })
        }
    }
}

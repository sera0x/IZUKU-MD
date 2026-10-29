import { jidNormalizedUser, type GroupMetadata } from 'baileys'
import type { CommandContext } from './types.js'
import { contextInfoOf, jidToNumber } from './helpers.js'
import { lidJidFor, phoneDigitsFor, phoneJidFor, rememberIdentityPair, sameUser } from './identity.js'
import { findStoredMessage, latestNameFor } from '../features/message-store.js'
import { db } from '../db/index.js'

/**
 * Check whether any of the supplied JIDs is an admin in the group. Accepts
 * both phone-number and LID forms because WhatsApp reports group participants
 * under either one, depending on the group's addressing mode.
 */
export function isGroupAdmin(metadata: GroupMetadata | undefined, jids: string | string[]): boolean {
    if (!metadata) return false

    const wanted = (Array.isArray(jids) ? jids : [jids]).filter(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )
    if (!wanted.length) return false

    const numbers = new Set(wanted.map(jidToNumber))
    return metadata.participants.some((participant) => {
        const identifiers = [participant.id, participant.lid, participant.phoneNumber].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        )
        const matches = identifiers.some(
            (identifier) => wanted.includes(identifier) || numbers.has(jidToNumber(identifier)),
        )
        return matches && participant.admin !== null && participant.admin !== undefined
    })
}

export function resolveTarget(ctx: CommandContext): string | undefined {
    const context = contextInfoOf(ctx.msg.message)
    const selfJid = jidNormalizedUser(ctx.sock.user?.id ?? '')
    const isOther = (jid: string): boolean =>
        jid.length > 0 && !sameUser(jid, ctx.sender) && !(selfJid && sameUser(jid, selfJid))

    // A tag is unambiguous, so it wins over quoted context. Compare by
    // identity rather than digits so a LID mention of the caller is ignored.
    const mentioned = context?.mentionedJid?.find((jid) => typeof jid === 'string' && isOther(jid))
    if (mentioned) return mentioned

    // WhatsApp sometimes puts the command author in contextInfo.participant.
    // The cached original message is the reliable source for a quoted sender.
    const quotedId = context?.stanzaId
    if (quotedId) {
        const stored = findStoredMessage(quotedId)
        if (stored?.sender && isOther(stored.sender)) return stored.sender

        // Quoting a bot reply (for example the ban notice) has no author we
        // can use, but the quoted message still carries its mentions.
        const quotedContext = contextInfoOf(context?.quotedMessage)
        const quotedMention = quotedContext?.mentionedJid?.find(
            (jid) => typeof jid === 'string' && isOther(jid),
        )
        if (quotedMention) return quotedMention

        const quotedAuthor = quotedContext?.participant
        if (quotedAuthor && isOther(quotedAuthor)) return quotedAuthor
    }

    const quoted = context?.participant
    if (quoted && isOther(quoted)) return quoted

    const digits = ctx.text.replace(/\D/g, '')
    if (digits.length >= 7) return `${digits}@s.whatsapp.net`

    return undefined
}

export const targetLabel = (jid: string): string => `@${jidToNumber(jid)}`

/** Text tag for a mention: raw number so WhatsApp renders the chip (it shows the saved name). Pairs with the same jid in `mentions`. */
export const tagOf = (_name: string | undefined, jid: string): string =>
    `@${phoneDigitsFor(jid) || jidToNumber(jid)}`

export async function normalizeTarget(ctx: CommandContext, jid: string): Promise<string> {
    const normalized = jidNormalizedUser(jid)
    if (!normalized.endsWith('@lid')) return normalized

    const mapped = await phoneJidFor(ctx.sock, normalized)
    return mapped || normalized
}

/**
 * Every JID form that can refer to the same account: the JID itself, its
 * phone-number form, its LID, and any participant form present in the group
 * metadata. Bans are stored per JID, so a ban or unban has to be applied to
 * all of them — clearing only one leaves the others behind and the user is
 * removed again the moment WhatsApp re-reports them under a different form.
 */
export async function identityAliases(ctx: CommandContext, jid: string): Promise<string[]> {
    const aliases = new Set<string>()
    const add = (value: string | null | undefined): void => {
        if (!value) return
        const normalized = jidNormalizedUser(value)
        if (normalized) aliases.add(normalized)
    }

    add(jid)
    const phone = await phoneJidFor(ctx.sock, jid).catch(() => '')
    add(phone)

    for (const seed of aliases) {
        // LID digits are not a phone number, so they must not be turned into a
        // fake `…@s.whatsapp.net` JID.
        if (seed.endsWith('@lid')) continue

        const number = jidToNumber(seed)
        if (number.length < 7) continue
        add(`${number}@s.whatsapp.net`)
        add(lidJidFor(number))
    }

    const metadata = await ctx.groupMetadata().catch(() => undefined)
    for (const participant of metadata?.participants ?? []) {
        const forms = [participant.id, participant.lid, participant.phoneNumber].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        )
        if (!forms.some((form) => [...aliases].some((alias) => sameUser(form, alias)))) continue
        forms.forEach(add)
    }

    // Remember the pairs so a later add/remove event resolves the same way.
    for (const alias of aliases) {
        for (const other of aliases) rememberIdentityPair(alias, other)
    }

    return [...aliases]
}

/**
 * A stored name is sometimes just the phone/LID digits (old rows, or a
 * contact saved without a name). Those are not display names: showing them
 * makes TTT and profile cards look like raw identifiers.
 */
const usableName = (value: string | null | undefined): string => {
    const name = (value ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return ''
    if (/^[+@\d\s()_-]+$/.test(name)) return ''
    return name
}

export async function targetName(ctx: CommandContext, jid: string): Promise<string> {
    const normalized = jidNormalizedUser(jid) || jid
    const aliases = new Set<string>([normalized])

    const phone = await phoneJidFor(ctx.sock, normalized).catch(() => '')
    if (phone) aliases.add(phone)
    const lid = lidJidFor(normalized)
    if (lid) aliases.add(lid)

    for (const alias of aliases) {
        const stored = usableName(db.user(alias).name)
        if (stored) return stored
    }

    const recent = usableName(latestNameFor(normalized))
    if (recent) return recent

    const metadata = await ctx.groupMetadata()
    const participant = metadata?.participants.find((entry) => {
        const identifiers = [entry.id, entry.lid, entry.phoneNumber].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        )
        return identifiers.some((value) => sameUser(value, normalized))
    })

    return usableName(participant?.notify || participant?.name || participant?.verifiedName)
}

export async function participantIds(ctx: CommandContext): Promise<string[]> {
    const metadata = await ctx.groupMetadata()
    return metadata?.participants.map((participant) => participant.id) ?? []
}


/**
 * Levanter-style persistent display name: the stored pushname for ANY form of
 * this account (raw, normalized, lid <-> phone), @number fallback. Every
 * user-facing message should use this instead of targetLabel so names stay
 * consistent across gban, addmod, transfer confirmations, etc.
 */
export function displayNameFor(jid: string): string {
    const forms = new Set<string>()
    const norm = jidNormalizedUser(jid)
    if (norm) {
        forms.add(norm)
        forms.add(norm.split(':')[0] as string)
    }
    forms.add(jid)
    for (const form of [...forms]) {
        if (form.endsWith('@lid')) {
            const digits = phoneDigitsFor(form)
            if (digits) forms.add(`${digits}@s.whatsapp.net`)
        } else if (form.endsWith('@s.whatsapp.net')) {
            const digits = form.split('@')[0]
            if (digits) forms.add(`${digits}@lid`)
        }
    }
    for (const form of forms) {
        const name = db.user(form).name
        if (name) return name
    }
    return targetLabel(jid)
}

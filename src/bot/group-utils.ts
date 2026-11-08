import { jidNormalizedUser, type GroupMetadata } from 'baileys'
import type { CommandContext } from './types.js'
import { contextInfoOf, jidToNumber } from './helpers.js'
import { lidJidFor, phoneDigitsFor, phoneJidFor, rememberIdentityPair, sameUser } from './identity.js'
import { findStoredMessage, latestNameFor } from '../features/message-store.js'
import { db } from '../db/index.js'

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

    const mentioned = context?.mentionedJid?.find((jid) => typeof jid === 'string' && isOther(jid))
    if (mentioned) return mentioned

    const quotedId = context?.stanzaId
    if (quotedId) {
        const stored = findStoredMessage(quotedId)
        if (stored?.sender && isOther(stored.sender)) return stored.sender

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

export const tagOf = (_name: string | undefined, jid: string): string =>
    `@${phoneDigitsFor(jid) || jidToNumber(jid)}`

export async function normalizeTarget(ctx: CommandContext, jid: string): Promise<string> {
    const normalized = jidNormalizedUser(jid)
    if (!normalized.endsWith('@lid')) return normalized

    const mapped = await phoneJidFor(ctx.sock, normalized)
    return mapped || normalized
}

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

    for (const alias of aliases) {
        for (const other of aliases) rememberIdentityPair(alias, other)
    }

    return [...aliases]
}

export const usableName = (value: string | null | undefined): string => {
    const name = (value ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return ''

    const digits = name.replace(/\D/g, '')
    const hasLetters = /[a-z\u00c0-\uffff]/i.test(name)
    if (!hasLetters && digits.length >= 7) return ''
    if (/^[^\s@]+@[^\s@]+$/.test(name)) return ''
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

    for (const alias of aliases) {
        const recent = usableName(latestNameFor(alias))
        if (recent) return recent
    }

    const metadata = await ctx.groupMetadata()
    const participant = metadata?.participants.find((entry) => {
        const identifiers = [entry.id, entry.lid, entry.phoneNumber].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        )
        return identifiers.some((value) => sameUser(value, normalized))
    })

    const fromGroup = usableName(participant?.notify || participant?.name || participant?.verifiedName)
    if (fromGroup) return fromGroup

    const self = ctx.sock.user
    if (self && sameUser(self.id, normalized)) {
        const own = usableName(self.name)
        if (own) return own
    }
    if (sameUser(ctx.sender, normalized)) return usableName(ctx.msg.pushName)

    return ''
}

export async function participantIds(ctx: CommandContext): Promise<string[]> {
    const metadata = await ctx.groupMetadata()
    return metadata?.participants.map((participant) => participant.id) ?? []
}

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

import { jidNormalizedUser, type WAMessage } from 'baileys'
import { jidToNumber } from '../bot/helpers.js'

const TTL = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 200

export interface CachedStatus {
    message: WAMessage
    identities: string[]
    sender: string
    name: string
    at: number
}

const statuses = new Map<string, CachedStatus>()

function timestampMs(message: WAMessage): number {
    const raw = message.messageTimestamp
    const value = typeof raw === 'number' ? raw : Number(raw?.toString() ?? 0)
    if (!value) return Date.now()
    return value > 1_000_000_000_000 ? value : value * 1000
}

function clean(): void {
    const cutoff = Date.now() - TTL
    for (const [id, entry] of statuses) {
        if (entry.at < cutoff) statuses.delete(id)
    }

    if (statuses.size <= MAX_ENTRIES) return
    const oldest = [...statuses.entries()].sort(([, a], [, b]) => a.at - b.at)
    for (const [id] of oldest.slice(0, statuses.size - MAX_ENTRIES)) statuses.delete(id)
}

export function rememberStatus(message: WAMessage, identities: string[], name = ''): void {
    const id = message.key.id
    if (!id) return

    const unique = [...new Set(identities.filter(Boolean))]
    const sender = unique[0] ?? ''
    statuses.set(id, {
        message,
        identities: unique,
        sender,
        name: name.trim(),
        at: timestampMs(message),
    })
    clean()
}

export function getStatus(id: string): CachedStatus | undefined {
    clean()
    return statuses.get(id)
}

export function recentStatuses(): CachedStatus[] {
    clean()
    return [...statuses.values()].sort((a, b) => b.at - a.at)
}

export function latestStatusFor(jid: string): CachedStatus | undefined {
    const normalized = jidNormalizedUser(jid)
    const number = jidToNumber(jid)

    return recentStatuses().find((entry) =>
        entry.identities.some(
            (identity) =>
                identity === jid ||
                identity === normalized ||
                jidToNumber(identity) === number,
        ),
    )
}

export function clearStatuses(): void {
    statuses.clear()
}

import type { WASocket } from 'baileys'
import { config } from '../config.js'
import { db } from '../db/index.js'

/**
 * Several deployments of the bot can sit in the same group. `.bot <name>`
 * names the one that should answer; the rest stay silent. The setting lives in
 * each bot's own database, and every bot receives the command, so they all
 * record the same answer without needing to talk to each other.
 */
export const activeBotKey = (chat: string): string => `active_bot:${chat}`

/** `IZUKU-MD 1` and `izuku-md-1` are the same answer. */
export function normalizeBotRef(value: string): string {
    return value.trim().replace(/^\+/, '').toLowerCase().replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '')
}

/** How this deployment can be named: its BOT_NAME, and its own number. */
export function botRefs(sock?: WASocket | null): string[] {
    const number = (sock?.user?.id ?? '').split('@')[0]?.split(':')[0] ?? ''
    return [normalizeBotRef(config.botName), number].filter((value) => value.length > 0)
}

export function activeBotFor(chat: string): string {
    return normalizeBotRef(db.settingValue(activeBotKey(chat)) ?? '')
}

export function setActiveBot(chat: string, value: string): void {
    if (value) db.setSetting(activeBotKey(chat), value)
    else db.removeSetting(activeBotKey(chat))
}

/** True when this bot is the one allowed to answer in the group. */
export function answersHere(sock: WASocket | null | undefined, chat: string): boolean {
    const active = activeBotFor(chat)
    if (!active) return true
    return botRefs(sock).includes(active)
}

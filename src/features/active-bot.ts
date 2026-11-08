import type { WASocket } from 'baileys'
import { config } from '../config.js'
import { db } from '../db/index.js'

export const activeBotKey = (chat: string): string => `active_bot:${chat}`

export function normalizeBotRef(value: string): string {
    return value.trim().replace(/^\+/, '').toLowerCase().replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '')
}

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

export function answersHere(sock: WASocket | null | undefined, chat: string): boolean {
    const active = activeBotFor(chat)
    if (!active) return true
    return botRefs(sock).includes(active)
}

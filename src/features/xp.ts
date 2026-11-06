import { db } from '../db/index.js'

/**
 * Level curve: level 1 starts at 0 xp, level 2 at 10, level 3 at 40, level 4 at
 * 90 ... i.e. `(level - 1)^2 * 10`. Cheap to compute in both directions and
 * grows fast enough that the leaderboard stays meaningful.
 */
export const xpForLevel = (level: number): number => Math.max(0, level - 1) ** 2 * 10

export const levelForXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1

export interface Progress {
    level: number
    current: number
    needed: number
    total: number
}

export function progressFor(xp: number): Progress {
    const level = levelForXp(xp)
    const floor = xpForLevel(level)
    const next = xpForLevel(level + 1)
    return {
        level,
        current: Math.max(0, xp - floor),
        needed: Math.max(1, next - floor),
        total: Math.max(0, xp),
    }
}

/** Flat 5 xp per message: predictable, and one upsert per message. */
export const XP_PER_MESSAGE = 5

export function awardMessageXp(chat: string, user: string): Progress {
    const row = db.addXp(chat, user, XP_PER_MESSAGE)
    return progressFor(row.xp)
}

export function progressBar(progress: Progress, width = 10): string {
    const filled = Math.max(0, Math.min(width, Math.round((progress.current / progress.needed) * width)))
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

export const rankLine = (chat: string, user: string): string => {
    const position = db.xpRank(chat, user)
    return position > 0 ? `#${position}` : 'unranked'
}

export const tidyName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, 24)

/**
 * Progressive hero rank. A tier needs both activity (level) and games played
 * and won, so chatting alone cannot max it out and win-farming alone cannot
 * either. Tiers are ascending; the last one a player qualifies for wins.
 */
export interface HeroTier {
    name: string
    badge: string
    level: number
    wins: number
}

export const HERO_TIERS: HeroTier[] = [
    { name: 'Civilian', badge: '🌱', level: 1, wins: 0 },
    { name: 'U.A. Student', badge: '🎒', level: 4, wins: 0 },
    { name: 'Intern', badge: '🩹', level: 8, wins: 3 },
    { name: 'Sidekick', badge: '🥋', level: 14, wins: 8 },
    { name: 'Pro Hero', badge: '🦸', level: 22, wins: 18 },
    { name: 'Top 10 Hero', badge: '🏅', level: 32, wins: 35 },
    { name: 'Symbol of Peace', badge: '👑', level: 45, wins: 60 },
]

export interface TierProgress {
    current: HeroTier
    next?: HeroTier
    /** 0-100 progress inside the current tier. */
    percent: number
}

export function heroTier(level: number, wins: number): TierProgress {
    let index = 0
    for (let i = 0; i < HERO_TIERS.length; i += 1) {
        const tier = HERO_TIERS[i] as HeroTier
        if (level >= tier.level && wins >= tier.wins) index = i
    }

    const current = HERO_TIERS[index] as HeroTier
    const next = HERO_TIERS[index + 1]
    if (!next) return { current, percent: 100 }

    const levelSpan = Math.max(1, next.level - current.level)
    const winSpan = Math.max(1, next.wins - current.wins)
    const levelPart = Math.min(1, Math.max(0, (level - current.level) / levelSpan))
    const winPart = Math.min(1, Math.max(0, (wins - current.wins) / winSpan))
    return { current, next, percent: Math.round(((levelPart + winPart) / 2) * 100) }
}

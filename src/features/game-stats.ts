import { jidNormalizedUser } from 'baileys'
import { jidToNumber } from '../bot/helpers.js'
import { lidJidFor, phoneDigitsFor } from '../bot/identity.js'
import { db, type GameBreakdownRow, type GameOutcome, type GameStatRow } from '../db/index.js'

/**
 * Cross-game scoreboard.
 *
 * Every finished game records one win/loss/draw on the player, so the streak
 * and the leaderboard follow the person rather than the game. The rows are
 * mirrored to the cloud store (see `cloud.ts`), so a dead VPS does not wipe
 * anyone's record.
 *
 * A person can appear as a phone JID or a LID. Stats are always keyed by the
 * phone-number form when the bridge knows it, so a TTT win and a word-chain
 * loss land on the same profile instead of two half-empty rows.
 */

export { type GameOutcome }

/** Stable scoreboard key: phone JID when known, otherwise the original JID. */
export function statsKey(jid: string): string {
    const normalized = jidNormalizedUser(jid) || jid
    const phone = phoneDigitsFor(normalized)
    if (phone) return `${phone}@s.whatsapp.net`
    if (normalized.endsWith('@lid')) return normalized

    const digits = jidToNumber(normalized)
    return /^\d{7,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : normalized
}

/** Every JID form that may hold an older stats row for this person. */
export function statsAliases(jid: string): string[] {
    const normalized = jidNormalizedUser(jid) || jid
    const aliases = new Set<string>([normalized, statsKey(normalized)])

    const phone = phoneDigitsFor(normalized)
    if (phone) aliases.add(`${phone}@s.whatsapp.net`)
    const lid = lidJidFor(normalized)
    if (lid) aliases.add(lid)

    return [...aliases].filter(Boolean)
}

export const GAME_LABEL: Record<string, string> = {
    tictactoe: 'Tic-tac-toe',
    wordchain: 'Word chain',
}

export const gameLabel = (game: string): string => GAME_LABEL[game] ?? game

export interface Profile {
    wins: number
    losses: number
    draws: number
    played: number
    streak: number
    best: number
    winRate: number
    rank: number
}

const emptyStats = (userJid: string): GameStatRow => ({
    user_jid: userJid,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    best_streak: 0,
    updated_at: 0,
})

/**
 * Fold this player's older JID rows into the canonical key before writing.
 * The boot migration handles the bulk of the table; this catches a mapping
 * that was learned from a live message after the bot started.
 */
function absorbUserAliases(userJid: string): string {
    const key = statsKey(userJid)
    for (const alias of statsAliases(userJid)) {
        if (alias === key) continue

        const stat = db.gameStat(alias)
        if (stat) {
            db.absorbGameStat({ ...stat, user_jid: key })
            db.deleteGameStat(alias)
        }
        for (const row of db.gameBreakdown(alias)) {
            db.absorbGameBreakdown({ ...row, user_jid: key })
            db.deleteGameBreakdown(alias, row.game)
        }
    }
    return key
}

export function recordGame(userJid: string, game: string, outcome: GameOutcome): GameStatRow {
    return db.recordGame(absorbUserAliases(userJid), game, outcome)
}

/**
 * Combine every JID form for a person. Usually there is exactly one row; the
 * sum keeps old LID rows visible until the boot migration folds them into the
 * phone-number row.
 */
function mergedStat(userJid: string): GameStatRow {
    const key = statsKey(userJid)
    const rows = new Map<string, GameStatRow>()
    for (const alias of statsAliases(userJid)) {
        const row = db.gameStat(alias)
        if (row) rows.set(row.user_jid, row)
    }

    if (rows.size === 0) return emptyStats(key)
    if (rows.size === 1) return [...rows.values()][0] as GameStatRow

    let wins = 0
    let losses = 0
    let draws = 0
    let best = 0
    let updatedAt = 0
    let streak = 0
    for (const row of rows.values()) {
        wins += row.wins
        losses += row.losses
        draws += row.draws
        best = Math.max(best, row.best_streak)
        if (row.updated_at >= updatedAt) {
            updatedAt = row.updated_at
            streak = row.streak
        }
    }

    return {
        user_jid: key,
        wins,
        losses,
        draws,
        streak,
        best_streak: best,
        updated_at: updatedAt,
    }
}

export function profileOf(userJid: string): Profile {
    const row = mergedStat(userJid)
    const played = row.wins + row.losses + row.draws
    return {
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        played,
        streak: row.streak,
        best: row.best_streak,
        winRate: played > 0 ? Math.round((row.wins / played) * 100) : 0,
        rank: db.gameRankByWins(row.wins),
    }
}

export function breakdownOf(userJid: string): GameBreakdownRow[] {
    const merged = new Map<string, GameBreakdownRow>()
    for (const alias of statsAliases(userJid)) {
        for (const row of db.gameBreakdown(alias)) {
            const current = merged.get(row.game)
            if (!current) {
                merged.set(row.game, { ...row })
                continue
            }
            current.wins += row.wins
            current.losses += row.losses
            current.draws += row.draws
        }
    }
    return [...merged.values()].sort((a, b) => b.wins - a.wins || b.losses - a.losses)
}

/**
 * Move legacy LID-keyed rows onto their phone-number key. Called once after
 * the session's LID mappings are loaded, and again after a cloud restore.
 */
export function normalizeGameStats(): number {
    let moved = 0

    for (const row of db.allGameStats()) {
        const key = statsKey(row.user_jid)
        if (key === row.user_jid) continue
        db.absorbGameStat({ ...row, user_jid: key })
        db.deleteGameStat(row.user_jid)
        moved += 1
    }

    for (const row of db.allGameBreakdown()) {
        const key = statsKey(row.user_jid)
        if (key === row.user_jid) continue
        db.absorbGameBreakdown({ ...row, user_jid: key })
        db.deleteGameBreakdown(row.user_jid, row.game)
        moved += 1
    }

    return moved
}

export interface LeaderRow {
    user_jid: string
    wins: number
    losses: number
    streak: number
    best_streak: number
}

export function leaderboard(limit = 10): LeaderRow[] {
    return db.topGameStats(limit).map((row) => ({
        user_jid: row.user_jid,
        wins: row.wins,
        losses: row.losses,
        streak: row.streak,
        best_streak: row.best_streak,
    }))
}

/** Payload mirrored to the cloud key-value store. */
export interface StatsSnapshot {
    players: GameStatRow[]
    games: GameBreakdownRow[]
}

export function snapshotStats(): StatsSnapshot {
    return { players: db.allGameStats(), games: db.allGameBreakdown() }
}

export function restoreStats(snapshot: Partial<StatsSnapshot> | null | undefined): number {
    if (!snapshot) return 0
    const players = Array.isArray(snapshot.players) ? snapshot.players : []
    const games = Array.isArray(snapshot.games) ? snapshot.games : []

    let restored = 0
    for (const row of players) {
        if (!row?.user_jid) continue
        db.mergeGameStat({
            user_jid: statsKey(row.user_jid),
            wins: Number(row.wins) || 0,
            losses: Number(row.losses) || 0,
            draws: Number(row.draws) || 0,
            streak: Number(row.streak) || 0,
            best_streak: Number(row.best_streak) || 0,
            updated_at: Number(row.updated_at) || 0,
        })
        restored += 1
    }
    for (const row of games) {
        if (!row?.user_jid || !row?.game) continue
        db.mergeGameBreakdown({
            user_jid: statsKey(row.user_jid),
            game: row.game,
            wins: Number(row.wins) || 0,
            losses: Number(row.losses) || 0,
            draws: Number(row.draws) || 0,
        })
    }
    return restored
}

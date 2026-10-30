import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { restoreGames, snapshotGames } from './tictactoe.js'
import { restoreStats, snapshotStats, type StatsSnapshot } from './game-stats.js'
import { rawDb } from '../db/index.js'

/**
 * Cloud mirror for player data.
 *
 * Games and the cross-game scoreboard live in SQLite, which dies with the VPS.
 * They are also written to the dkit key-value store (backed by Cloudflare) and
 * pulled back at startup, so a rebuild restores streaks, wins and any match
 * that was still in progress.
 *
 * Writes are debounced and fire-and-forget: `dkit` is a CLI, and a move must
 * never wait on the network. Nothing here throws into the message pipeline.
 */

const exec = promisify(execFile)
const log = createLogger(config.logLevel, { scope: 'cloud' })

const PREFIX = (process.env.CLOUD_PREFIX ?? 'izuku:').trim() || 'izuku:'
const GAMES_KEY = `${PREFIX}ttt:games`
const STATS_KEY = `${PREFIX}game-stats`
/** Cards, decks, wallets, clans and marriages. Kept separately from the stats
 * blob so a bad card row cannot block a win from being restored. */
const STATE_KEY = `${PREFIX}tcg:state`
const ENABLED = (process.env.CLOUD_SYNC ?? '1').trim().toLowerCase() !== '0'
const TIMEOUT_MS = (() => {
    const value = Number.parseInt(process.env.CLOUD_TIMEOUT_MS ?? '15000', 10)
    return Number.isFinite(value) && value >= 1000 ? value : 15000
})()
const DEBOUNCE_MS = 1500
const MAX_FAILURES = 5

let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let dirty = false

const available = (): boolean => ENABLED && failures < MAX_FAILURES

async function dkit(args: string[]): Promise<string> {
    const { stdout } = await exec('dkit', args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    return stdout
}

async function kvGet<T>(key: string): Promise<T | null> {
    if (!available()) return null

    try {
        const output = (await dkit(['store:get', key])).trim()
        if (!output || output.startsWith('-') || /no (such )?key|not found/i.test(output)) return null
        failures = 0
        return JSON.parse(output) as T
    } catch (error) {
        const message = (error as Error).message
        if (!/ENOENT|not found|no such key/i.test(message)) {
            failures += 1
            log.debug('cloud read %s failed: %s', key, message)
        }
        return null
    }
}

async function kvSet(key: string, value: unknown): Promise<boolean> {
    if (!available()) return false

    try {
        await dkit(['store:set', key, JSON.stringify(value)])
        failures = 0
        return true
    } catch (error) {
        failures += 1
        log.debug('cloud write %s failed: %s', key, (error as Error).message)
        if (failures === MAX_FAILURES) log.warn('cloud sync disabled after %d failures', failures)
        return false
    }
}

/** Pull the mirrored state back after a restart or a move to a new VPS. */
export async function restoreCloudState(): Promise<{ games: number; players: number }> {
    if (!available()) return { games: 0, players: 0 }

    const [games, stats, state] = await Promise.all([
        kvGet<unknown>(GAMES_KEY),
        kvGet<Partial<StatsSnapshot>>(STATS_KEY),
        kvGet<Partial<GameStateSnapshot>>(STATE_KEY),
    ])

    const restoredGames = restoreGames(games)
    const players = restoreStats(stats)
    const cards = restoreGameState(state)
    if (restoredGames > 0 || players > 0 || cards > 0) {
        log.info(
            'restored %d game(s), %d player record(s) and %d card row(s) from the cloud store',
            restoredGames,
            players,
            cards,
        )
    }

    // Push what we have as soon as the bot is up, so the mirror is complete even
    // if the previous run was killed before its debounced flush ran.
    syncSoon()
    return { games: restoredGames, players }
}

async function flush(): Promise<void> {
    if (!available() || running) return

    running = true
    try {
        dirty = false
        const [games, stats, state] = await Promise.all([
            kvSet(GAMES_KEY, snapshotGames()),
            kvSet(STATS_KEY, snapshotStats()),
            kvSet(STATE_KEY, snapshotGameState()),
        ])
        if (!games || !stats || !state) dirty = true
    } finally {
        running = false
        if (dirty && available()) syncSoon()
    }
}

/** Queue a debounced upload. Safe to call on every move. */
export function syncSoon(): void {
    if (!available()) return

    dirty = true
    if (timer) return

    timer = setTimeout(() => {
        timer = undefined
        void flush()
    }, DEBOUNCE_MS)
    timer.unref?.()
}

/** Flush immediately (used by tests and by shutdown). */
export async function flushCloudState(): Promise<void> {
    if (timer) {
        clearTimeout(timer)
        timer = undefined
    }
    await flush()
}

interface GameStateSnapshot {
    savedAt: number
    users: Array<Record<string, unknown>>
    tables: Record<string, Array<Record<string, unknown>>>
}

const STATE_TABLES = [
    'cards',
    'deck_cards',
    'marriages',
    'clans',
    'clan_members',
    'clan_treasury',
    'clan_profit',
    'clan_war_points',
]
const MONEY_COLUMNS = ['coins', 'vault', 'tcg_daily', 'daily_streak', 'work_at', 'rob_at', 'daily_at', 'poke_started', 'clan_cd']

const tableExists = (name: string): boolean =>
    Boolean(rawDb.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))

const columnsOf = (table: string): Set<string> =>
    new Set((rawDb.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))

/** Read every durable game row: collections, decks, wallets, clans, marriages. */
export function snapshotGameState(): GameStateSnapshot {
    const tables: Record<string, Array<Record<string, unknown>>> = {}
    for (const table of STATE_TABLES) {
        if (!tableExists(table)) continue
        tables[table] = rawDb.prepare(`select * from ${table}`).all() as Array<Record<string, unknown>>
    }

    const money = tableExists('users') ? [...columnsOf('users')].filter((column) => MONEY_COLUMNS.includes(column)) : []
    const users = money.length
        ? (rawDb.prepare(`select jid, ${money.join(', ')} from users`).all() as Array<Record<string, unknown>>)
        : []

    return { savedAt: Date.now(), users, tables }
}

/**
 * Merge a mirror back in without ever lowering a balance: rows are replaced by
 * key, and wallet columns keep whichever side is higher.
 */
export function restoreGameState(snapshot: Partial<GameStateSnapshot> | null | undefined): number {
    if (!snapshot) return 0

    let restored = 0
    for (const [table, rows] of Object.entries(snapshot.tables ?? {})) {
        if (!STATE_TABLES.includes(table) || !tableExists(table) || !Array.isArray(rows)) continue
        const known = columnsOf(table)

        for (const row of rows as Array<Record<string, unknown>>) {
            const columns = Object.keys(row ?? {}).filter((column) => known.has(column))
            if (!columns.length) continue
            const sql = `insert or replace into ${table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`
            try {
                rawDb.prepare(sql).run(...columns.map((column) => row[column] as never))
                restored += 1
            } catch (error) {
                log.debug('cloud restore %s row failed: %s', table, (error as Error).message)
            }
        }
    }

    if (tableExists('users')) {
        const known = columnsOf('users')
        const money = MONEY_COLUMNS.filter((column) => known.has(column))
        const sql = `update users set ${money.map((column) => `${column} = max(coalesce(${column}, 0), coalesce(?, 0))`).join(', ')} where jid = ?`

        for (const row of (snapshot.users ?? []) as Array<Record<string, unknown>>) {
            const jid = typeof row.jid === 'string' ? row.jid : ''
            if (!jid || !money.length) continue
            try {
                rawDb.prepare(sql).run(...money.map((column) => Number(row[column]) || 0), jid)
                restored += 1
            } catch (error) {
                log.debug('cloud restore wallet failed: %s', (error as Error).message)
            }
        }
    }

    return restored
}

export const cloudSyncStatus = (): { enabled: boolean; failures: number } => ({
    enabled: ENABLED,
    failures,
})

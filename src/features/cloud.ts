import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { restoreGames, snapshotGames } from './tictactoe.js'
import { restoreStats, snapshotStats, type StatsSnapshot } from './game-stats.js'

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

    const [games, stats] = await Promise.all([kvGet<unknown>(GAMES_KEY), kvGet<Partial<StatsSnapshot>>(STATS_KEY)])

    const restoredGames = restoreGames(games)
    const players = restoreStats(stats)
    if (restoredGames > 0 || players > 0) {
        log.info('restored %d game(s) and %d player record(s) from the cloud store', restoredGames, players)
    }
    return { games: restoredGames, players }
}

async function flush(): Promise<void> {
    if (!available() || running) return

    running = true
    try {
        dirty = false
        const [games, stats] = await Promise.all([kvSet(GAMES_KEY, snapshotGames()), kvSet(STATS_KEY, snapshotStats())])
        if (!games || !stats) dirty = true
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

export const cloudSyncStatus = (): { enabled: boolean; failures: number } => ({
    enabled: ENABLED,
    failures,
})

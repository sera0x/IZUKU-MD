import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
}

export interface Statement {
    run(...params: any[]): RunResult
    get(...params: any[]): any
    all(...params: any[]): any[]
}

export interface SqliteHandle {
    readonly driver: string
    prepare(sql: string): Statement
    exec(sql: string): void
    pragma(sql: string): any[]
    transaction<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R
    close(): void
}

function isBun(): boolean {
    return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

function wrap(raw: any, driver: string): SqliteHandle {
    let depth = 0
    return {
        driver,
        prepare: (sql: string) => raw.prepare(sql),
        exec: (sql: string) => {
            raw.exec(sql)
        },
        pragma: (sql: string) => {
            if (sql.includes('=')) {
                raw.exec(`PRAGMA ${sql}`)
                return []
            }
            try {
                return raw.prepare(`PRAGMA ${sql}`).all()
            } catch {
                return []
            }
        },
        transaction: <A extends any[], R>(fn: (...args: A) => R) => {
            return (...args: A): R => {
                const savepoint = `izuku_sp_${depth}`
                if (depth === 0) raw.exec('BEGIN IMMEDIATE')
                else raw.exec(`SAVEPOINT ${savepoint}`)
                depth++
                try {
                    const out = fn(...args)
                    depth--
                    if (depth === 0) raw.exec('COMMIT')
                    else raw.exec(`RELEASE ${savepoint}`)
                    return out
                } catch (error) {
                    depth--
                    try {
                        if (depth === 0) raw.exec('ROLLBACK')
                        else raw.exec(`ROLLBACK TO ${savepoint}`)
                    } catch {}
                    throw error
                }
            }
        },
        close: () => {
            try {
                raw.close()
            } catch {}
        },
    }
}

/**
 * Opens the bot's SQLite file without ever requiring a native build step.
 *
 * Order: bun:sqlite (bun), node:sqlite (node >= 22.5), better-sqlite3 (legacy).
 * The first two ship inside the runtime, so `bun install` / `npm install` never
 * needs node-gyp, python or a C++ toolchain.
 */
export function openDatabase(path: string): SqliteHandle {
    if (isBun()) {
        try {
            const { Database } = require('bun:sqlite')
            return wrap(new Database(path, { create: true }), 'bun:sqlite')
        } catch {}
    }
    try {
        const { DatabaseSync } = require('node:sqlite')
        return wrap(new DatabaseSync(path), 'node:sqlite')
    } catch {}
    try {
        const Database = require('better-sqlite3')
        return wrap(new Database(path), 'better-sqlite3')
    } catch (error) {
        throw new Error(
            `no SQLite driver available (tried bun:sqlite, node:sqlite, better-sqlite3): ${
                (error as Error)?.message ?? error
            }. Upgrade to Node.js 22.5+ or run with Bun.`,
        )
    }
}

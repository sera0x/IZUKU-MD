import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDatabase, type Statement } from '../db/sqlite.js'
import { proto, type WAMessage, type WAMessageKey } from 'baileys'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { contextInfoOf, jidToNumber } from '../bot/helpers.js'
import { phoneDigitsFor, sameUser } from '../bot/identity.js'

export interface StoredMessage {
    key: WAMessageKey
    message: proto.IMessage
    sender: string
    pushName: string
    at: number
}

const log = createLogger(config.logLevel, { scope: 'message-store' })

const TTL = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 100_000
const CLEANUP_INTERVAL = 10 * 60 * 1000

const names = new Map<string, { name: string; at: number }>()

mkdirSync(dirname(config.dbPath), { recursive: true })
const sqlite = openDatabase(config.dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('busy_timeout = 5000')

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS message_store (
        chat      TEXT NOT NULL,
        id        TEXT NOT NULL,
        sender    TEXT NOT NULL DEFAULT '',
        push_name TEXT NOT NULL DEFAULT '',
        key_json  TEXT NOT NULL,
        message   BLOB NOT NULL,
        at        INTEGER NOT NULL,
        PRIMARY KEY (chat, id)
    );

    CREATE INDEX IF NOT EXISTS message_store_id ON message_store (id);
    CREATE INDEX IF NOT EXISTS message_store_at ON message_store (at);
`)

const upsertStmt = sqlite.prepare(
    'INSERT OR REPLACE INTO message_store (chat, id, sender, push_name, key_json, message, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const insertIfMissingStmt = sqlite.prepare(
    'INSERT OR IGNORE INTO message_store (chat, id, sender, push_name, key_json, message, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)

sqlite.exec('CREATE TABLE IF NOT EXISTS processed_ids (id TEXT PRIMARY KEY, at INTEGER)')
const insertProcessedStmt = sqlite.prepare('INSERT OR IGNORE INTO processed_ids (id, at) VALUES (?, ?)')
const checkProcessedStmt = sqlite.prepare('SELECT 1 FROM processed_ids WHERE id = ?')

export function firstProcessedSighting(id: string): boolean {
    if (!id) return true
    if (checkProcessedStmt.get(id)) return false
    insertProcessedStmt.run(id, Date.now())
    return true
}

const selectOneStmt = sqlite.prepare('SELECT * FROM message_store WHERE chat = ? AND id = ?')
const selectByIdStmt = sqlite.prepare('SELECT * FROM message_store WHERE id = ? ORDER BY at DESC LIMIT 1')
const countStmt = sqlite.prepare('SELECT COUNT(*) AS total FROM message_store')
const pruneOldStmt = sqlite.prepare('DELETE FROM message_store WHERE at < ?')
const pruneCountStmt = sqlite.prepare(
    'DELETE FROM message_store WHERE rowid IN (SELECT rowid FROM message_store ORDER BY at DESC LIMIT -1 OFFSET ?)',
)

interface MessageRow {
    chat: string
    id: string
    sender: string
    push_name: string
    key_json: string
    message: Buffer
    at: number
}

let lastPrune = 0

function maybePrune(): void {
    const now = Date.now()
    if (now - lastPrune < CLEANUP_INTERVAL) return
    lastPrune = now
    try {
        pruneOldStmt.run(now - TTL)
        pruneCountStmt.run(MAX_ENTRIES)
    } catch (error) {
        log.warn('prune failed: %s', (error as Error).message)
    }
    for (const [jid, entry] of names) {
        if (entry.at < now - TTL) names.delete(jid)
    }
}

function encodeMessage(message: proto.IMessage): Buffer | null {
    try {
        return Buffer.from(proto.Message.encode(message).finish())
    } catch (error) {
        log.debug('could not encode message for storage: %s', (error as Error).message)
        return null
    }
}

function writeEntry(
    stmt: Statement,
    chat: string,
    id: string,
    key: WAMessageKey,
    message: proto.IMessage,
    sender: string,
    pushName: string,
    at: number,
): void {
    const blob = encodeMessage(message)
    if (!blob) return
    try {
        stmt.run(chat, id, sender, pushName, JSON.stringify(key), blob, at)
    } catch (error) {
        log.warn('store write failed: %s', (error as Error).message)
    }
}

function rowToEntry(row: MessageRow | undefined): StoredMessage | undefined {
    if (!row) return undefined
    try {
        return {
            key: JSON.parse(row.key_json) as WAMessageKey,
            message: proto.Message.decode(row.message),
            sender: row.sender,
            pushName: row.push_name,
            at: row.at,
        }
    } catch (error) {
        log.warn('stored message could not be decoded: %s', (error as Error).message)
        return undefined
    }
}

export function rememberMessage(
    msg: WAMessage,
    sender: string,
    options: { onlyIfMissing?: boolean } = {},
): void {
    const chat = msg.key.remoteJid
    const id = msg.key.id
    if (!chat || !id || !msg.message) return

    if (msg.message.reactionMessage) return

    const name = (msg.pushName ?? '').trim()
    if (sender && name) names.set(sender, { name, at: Date.now() })

    const now = Date.now()

    writeEntry(options.onlyIfMissing ? insertIfMissingStmt : upsertStmt, chat, id, msg.key, msg.message, sender, name, now)

    const context = contextInfoOf(msg.message)
    if (context?.quotedMessage && context.stanzaId) {

        const quotedSender = context.participant ?? ''
        writeEntry(
            insertIfMissingStmt,
            chat,
            context.stanzaId,
            { remoteJid: chat, id: context.stanzaId, fromMe: false, participant: quotedSender || undefined },
            context.quotedMessage,
            quotedSender,
            quotedSender ? (names.get(quotedSender)?.name ?? '') : '',
            now,
        )
    }

    maybePrune()
}

export function getStoredMessage(chat: string, id: string): StoredMessage | undefined {
    if (!chat || !id) return undefined
    return rowToEntry(selectOneStmt.get(chat, id) as MessageRow | undefined)
}

export function findStoredMessage(id: string): StoredMessage | undefined {
    if (!id) return undefined
    return rowToEntry(selectByIdStmt.get(id) as MessageRow | undefined)
}

export function latestNameFor(jid: string): string {
    if (!jid) return ''

    let best = ''
    let bestAt = 0
    for (const [known, entry] of names) {
        if (!sameUser(known, jid)) continue
        if (entry.at > bestAt) {
            bestAt = entry.at
            best = entry.name
        }
    }
    return best
}

export function storedSenderName(entry: StoredMessage | undefined): string {
    if (!entry) return ''
    return entry.pushName || latestNameFor(entry.sender) || jidToNumber(entry.sender)
}

export function messageStoreSize(): number {
    return (countStmt.get() as { total: number }).total
}

export const storedSenderDigits = (entry: StoredMessage | undefined): string =>
    entry ? phoneDigitsFor(entry.sender) || jidToNumber(entry.sender) : ''

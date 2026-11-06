import { existsSync, appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { WASocket } from 'baileys'
import { config } from '../config.js'
import { createLogger } from '../logger.js'

// Outbound bridge: an external process appends one JSON object per line to
// data/outbox.jsonl, e.g. {"to":"2349051178294","text":"hi"}. The bot polls the
// file every 2s, sends each message through the live socket, and records the
// outcome in data/outbox.sent.log. Invalid lines are logged and skipped.

const log = createLogger(config.logLevel, { scope: 'outbox' })

const DATA_DIR = resolve(process.cwd(), 'data')
const OUTBOX = join(DATA_DIR, 'outbox.jsonl')
const SENT_LOG = join(DATA_DIR, 'outbox.sent.log')
const POLL_MS = 2000
const MAX_TEXT = 4000

let currentSock: WASocket | null = null
let timer: ReturnType<typeof setInterval> | null = null
let busy = false

function recordSent(entry: Record<string, unknown>): void {
    try {
        appendFileSync(SENT_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
    } catch (error) {
        log.warn('outbox sent-log write failed: %s', (error as Error).message)
    }
}

export function normalizeRecipient(to: string): string | null {
    const value = to.trim()
    if (!value) return null
    if (value.includes('@')) return /^[\w.:+-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(value) ? value : null
    const digits = value.replace(/[^\d]/g, '')
    if (!/^\d{7,15}$/.test(digits)) return null
    return `${digits}@s.whatsapp.net`
}

type Parsed = { ok: true; to: string; text: string } | { ok: false; reason: string }

export function parseLine(raw: string): Parsed {
    let obj: unknown
    try {
        obj = JSON.parse(raw)
    } catch {
        return { ok: false, reason: 'not valid json' }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not an object' }
    const { to, text } = obj as { to?: unknown; text?: unknown }
    if (typeof to !== 'string') return { ok: false, reason: 'missing to' }
    const jid = normalizeRecipient(to)
    if (!jid) return { ok: false, reason: `bad recipient: ${to.slice(0, 40)}` }
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'missing or empty text' }
    const capped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
    return { ok: true, to: jid, text: capped }
}

async function drain(): Promise<void> {
    if (busy || !currentSock) return
    if (!existsSync(OUTBOX)) return
    try {
        if (statSync(OUTBOX).size === 0) return
    } catch {
        return
    }
    busy = true
    // Atomically take the current batch so appenders never race our reads.
    const batch = join(DATA_DIR, `outbox.inflight-${Date.now()}.jsonl`)
    try {
        renameSync(OUTBOX, batch)
    } catch (error) {
        busy = false
        log.warn('outbox rename failed: %s', (error as Error).message)
        return
    }
    try {
        const lines = readFileSync(batch, 'utf8').split('\n')
        for (const raw of lines) {
            const line = raw.trim()
            if (!line) continue
            const parsed = parseLine(line)
            if (!parsed.ok) {
                log.warn('outbox skipped line: %s', parsed.reason)
                recordSent({ status: 'invalid', reason: parsed.reason, line: line.slice(0, 300) })
                continue
            }
            try {
                const sock = currentSock
                if (!sock) throw new Error('socket not available')
                const sent = await sock.sendMessage(parsed.to, { text: parsed.text })
                recordSent({ status: 'sent', to: parsed.to, id: sent?.key?.id ?? null, chars: parsed.text.length })
                log.info('outbox sent to %s (%d chars)', parsed.to, parsed.text.length)
            } catch (error) {
                const message = (error as Error).message
                log.warn('outbox send to %s failed: %s', parsed.to, message)
                recordSent({ status: 'failed', to: parsed.to, error: message.slice(0, 300) })
            }
        }
    } catch (error) {
        log.warn('outbox batch failed: %s', (error as Error).message)
    } finally {
        try {
            unlinkSync(batch)
        } catch {
            // already gone
        }
        busy = false
    }
}

export function startOutboxBridge(sock: WASocket): void {
    mkdirSync(DATA_DIR, { recursive: true })
    currentSock = sock
    if (timer) return
    timer = setInterval(() => {
        void drain().catch((error: Error) => log.warn('outbox tick failed: %s', error.message))
    }, POLL_MS)
    log.info('outbox bridge watching %s', OUTBOX)
}

export function stopOutboxBridge(): void {
    currentSock = null
    if (timer) clearInterval(timer)
    timer = null
}

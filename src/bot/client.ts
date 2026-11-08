import { boldText, isMarkerLog, isStartupBroadcast } from './bold.js'
import {
    Browsers,
    DEFAULT_CONNECTION_CONFIG,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeWASocket,
    type ConnectionState,
    type WASocket,
} from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger, toBaileysLogger } from '../logger.js'
import { prepareAuth, resetSession } from './auth.js'
import { markBotSentId } from './lifecycle.js'
import { selfChatJid } from './helpers.js'
import { findStoredMessage, getStoredMessage } from '../features/message-store.js'

import { isRecoveryNoise } from './noise.js'
const log = createLogger(config.logLevel, { scope: 'whatsapp' })
const baileysLog = createLogger(
    config.logLevel === 'trace' || config.logLevel === 'debug' ? config.logLevel : 'warn',
    { scope: 'baileys' },
)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type WaVersion = [number, number, number]
let cachedWaVersion: WaVersion | null = null

async function resolveWaVersion(): Promise<WaVersion> {
    if (cachedWaVersion) return cachedWaVersion
    const fallback = DEFAULT_CONNECTION_CONFIG.version as WaVersion
    const timeout = new Promise<WaVersion>((resolve) => setTimeout(() => resolve(fallback), 4000))
    const fetched = await Promise.race([
        fetchLatestBaileysVersion()
            .then((result) => (result.version as WaVersion) ?? fallback)
            .catch(() => fallback),
        timeout,
    ])
    cachedWaVersion = fetched
    return fetched
}

export interface BotEvents {
    onSocket: (sock: WASocket) => void
    onOpen?: (sock: WASocket) => void
    onClose?: () => void
    onQr?: (qr: string) => void
}

function stringifySafe(obj: unknown): string {
    try {
        return JSON.stringify(obj)
    } catch {
        return ''
    }
}

function both(obj: unknown, msg?: string): string {
    return `${msg ?? ''} ${stringifySafe(obj)}`
}

const LIBSIGNAL_NOISE = [
    /^Failed to decrypt message/,
    /^Session error:/,
    /^Decrypted message with closed session/,
    /^Closing (?:stale open )?session/,
    /^Session already (?:closed|open)/,
]

function silenceLibsignalNoise(): void {
    const original = process.stderr.write.bind(process.stderr)
    let lastSuppressed = 0

    process.stderr.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        const trimmed = text.trimStart()

        const isNoise =
            LIBSIGNAL_NOISE.some((pattern) => pattern.test(trimmed)) ||
            (trimmed.startsWith('at ') && Date.now() - lastSuppressed < 1000)

        if (isNoise) {
            lastSuppressed = Date.now()
            if (typeof encoding === 'function') encoding()
            else if (typeof callback === 'function') callback()
            return true
        }

        return (original as (...args: unknown[]) => boolean)(chunk, encoding, callback)
    }) as typeof process.stderr.write
}

silenceLibsignalNoise()

function createSignalGuard(): {
    logger: ReturnType<typeof toBaileysLogger>
    hits: () => number
    takeFailingJids: () => string[]
    setFailingHandler: (fn: ((jids: string[]) => void) | null) => void
} {
    const base = toBaileysLogger(baileysLog)
    let hits = 0
    let suppressed = 0
    let lastSummary = Date.now()

    const failing = new Set<string>()

    let onFailing: ((jids: string[]) => void) | null = null
    let scheduled = false

    const flush = (): void => {
        scheduled = false
        if (!onFailing || !failing.size) return
        const out = [...failing]
        failing.clear()
        try {
            onFailing(out)
        } catch (error) {
            log.debug('failing-jid handler error: %s', (error as Error).message)
        }
    }

    const schedule = (): void => {
        if (scheduled) return
        scheduled = true
        queueMicrotask(flush)
    }

    const note = (text: string): void => {
        const t = text.toLowerCase()
        if (
            !t.includes('bad mac') &&
            !t.includes('failed to decrypt') &&
            !t.includes('invalid prekey') &&
            !t.includes('prekeyerror') &&
            !t.includes('sessionerror') &&
            !t.includes('transaction failed, rolling back')
        )
            return
        hits += 1
        if (hits === 1) log.warn('Bad MAC detected — will auto-reset stale sessions.')

        const remote = text.match(/"remoteJid":"([^"]+)"/)?.[1]
        const participant = text.match(/"participant":"([^"]+)"/)?.[1]
        const jid = text.match(/"jid":"([^"]+)"/)?.[1]
        const fromMe = /"fromMe":true/.test(text)
        const target = fromMe ? null : (participant ?? remote ?? jid)
        if (target) {
            failing.add(target)
            schedule()
        }
    }

    const countSuppressed = (): void => {
        suppressed += 1
        const now = Date.now()
        if (now - lastSummary < 5 * 60_000) return
        log.info('recovered %d stale session(s) (prekey/Bad MAC noise suppressed)', suppressed)
        suppressed = 0
        lastSummary = now
    }

    const wrap = (source: typeof base): typeof base => ({
        level: source.level,
        child: (obj) => wrap(source.child(obj)),
        trace: source.trace,
        debug: source.debug,
        info: source.info,
        warn: (obj, msg) => {
            const text = both(obj, msg)
            note(text)
            if (isRecoveryNoise(text)) {
                countSuppressed()
                source.debug(text)
                return
            }
            source.warn(obj, msg)
        },
        error: (obj, msg) => {
            const text = both(obj, msg)
            note(text)
            if (isRecoveryNoise(text)) {
                countSuppressed()
                source.debug(text)
                return
            }
            source.error(obj, msg)
        },
    })

    return {
        logger: wrap(base),
        hits: () => hits,
        takeFailingJids: () => {
            const out = [...failing]
            failing.clear()
            return out
        },
        setFailingHandler: (fn) => {
            onFailing = fn
            if (failing.size) schedule()
        },
    }
}

export class Bot {
    private sock: WASocket | null = null
    private stopping = false
    private attempts = 0
    private lastFailReason = ''
    private connectedState = false
    private openedAt = 0

    constructor(private readonly events: BotEvents) {}

    get socket(): WASocket | null {
        return this.sock
    }

    get connected(): boolean {
        return this.connectedState
    }

    async start(): Promise<void> {
        while (!this.stopping) {
            const loggedOut = await this.runOnce()
            if (this.stopping) break

            if (loggedOut) {
                log.error('WhatsApp logged this device out. Clearing auth and shutting down.')
                await resetSession()
                this.stopping = true
                process.exit(0)
            }

            this.attempts += 1

            if (!this.connectedState && this.attempts >= 5) {
                const stale = /QR refs attempts ended|logged out|Stale session/i.test(this.lastFailReason)
                log.error(
                    'Not connected after %d attempts. Shutting down%s.',
                    this.attempts,
                    stale ? ' and clearing auth' : ' (auth kept, network problem)',
                )
                if (stale) {
                    try {
                        await resetSession()
                    } catch {

                    }
                }
                this.stopping = true
                process.exit(0)
            }

            const lived = this.openedAt ? Date.now() - this.openedAt : Number.POSITIVE_INFINITY
            const base = lived < 30_000 ? 10_000 : 3_000
            const delay = Math.min(60_000, base * 2 ** Math.max(0, this.attempts - 1))
            this.openedAt = 0
            log.warn('Reconnecting in %dms (attempt %d)', delay, this.attempts)
            await sleep(delay)
        }
    }

    async stop(): Promise<void> {
        this.stopping = true
        try {
            this.sock?.end(undefined)
        } catch (error) {
            log.debug('socket end failed: %s', (error as Error).message)
        }
        this.sock = null
    }

    private async runOnce(): Promise<boolean> {

        let prepared: Awaited<ReturnType<typeof prepareAuth>>
        try {
            prepared = await prepareAuth()
        } catch (error) {
            log.fatal('Cannot start: %s', (error as Error).message)
            process.exit(78)
        }
        const { state, saveCreds } = prepared

        const version = await resolveWaVersion()
        const signal = createSignalGuard()

        const sock = makeWASocket({
            version,
            auth: state,
            logger: signal.logger,
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,

            getMessage: async (key) => {
                const id = key.id
                if (!id) return undefined
                const stored =
                    (key.remoteJid ? getStoredMessage(key.remoteJid, id) : undefined) ??
                    findStoredMessage(id)
                return stored?.message
            },

            retryRequestDelayMs: 0,
            maxMsgRetryCount: 8,
            enableAutoSessionRecreation: true,
        })

        this.sock = sock
        this.events.onSocket(sock)
        sock.ev.on('creds.update', saveCreds)

        const origSend = sock.sendMessage.bind(sock)
        ;(sock as unknown as { sendMessage: unknown }).sendMessage = async (...args: unknown[]) => {

            const content = args[1] as Record<string, unknown> | undefined
            if (content && typeof content === 'object') {
                if (typeof content.text === 'string' && !isMarkerLog(content.text) && !isStartupBroadcast(content.text)) content.text = boldText(content.text)
                if (typeof content.caption === 'string' && !isMarkerLog(content.caption) && !isStartupBroadcast(content.caption)) content.caption = boldText(content.caption)
            }
            const res = (await (origSend as (...a: unknown[]) => Promise<{ key?: { id?: string } }>)(...args)) as { key?: { id?: string } }
            markBotSentId(res?.key?.id)
            return res
        }

        const resetCooldown = new Map<string, number>()
        const resetSessions = (jids: string[]): void => {
            const repo = (sock as unknown as { signalRepository?: { deleteSession: (jids: string[]) => Promise<void> } }).signalRepository
            if (!repo || !jids.length) return
            const now = Date.now()
            const fresh = jids.filter((j: string) => now - (resetCooldown.get(j) ?? 0) > 60_000)
            if (!fresh.length) return
            for (const j of fresh) resetCooldown.set(j, now)
            void (async () => {
                try {
                    await repo.deleteSession(fresh)
                    log.warn('Reset stale session for: %s', fresh.join(', '))
                } catch (error) {
                    log.warn('Session reset failed: %s', (error as Error).message)
                    const sockAny = sock as unknown as { uploadPreKeys?: () => Promise<void> }
                    void sockAny.uploadPreKeys?.().catch(() => undefined)
                }
            })()
        }

        signal.setFailingHandler(resetSessions)
        const sessionFixer = setInterval(() => {
            if (!this.connectedState) return
            const jids = signal.takeFailingJids()
            if (jids.length) log.debug('decrypt-fail jids: %j', jids)
            resetSessions(jids)
        }, 15_000)

        const CONNECT_TIMEOUT_MS = 75_000
        let watchdog: ReturnType<typeof setTimeout> | undefined

        return await new Promise<boolean>((resolve) => {
            watchdog = setTimeout(() => {
                if (this.connectedState) return
                log.warn(
                    'WhatsApp did not answer within %ds — closing the socket and retrying.',
                    CONNECT_TIMEOUT_MS / 1000,
                )
                try {
                    sock.end(undefined)
                } catch {

                }
                resolve(false)
            }, CONNECT_TIMEOUT_MS)
            watchdog.unref?.()

            sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update
                if (connection === 'open' || connection === 'close') clearTimeout(watchdog)

                if (qr) {
                    this.events.onQr?.(qr)
                }

                if (connection === 'open') {
                    this.attempts = 0
                    this.openedAt = Date.now()
                    this.connectedState = true
                    log.info('Connected to WhatsApp as %s', sock.user?.id ?? 'unknown')

                    if (!db.settingValue('link_greet_sent')) {
                        const target = selfChatJid(sock)
                        if (target) {
                            const greet = [
                                '👋 *IZUKU 2.0 linked successfully*',
                                '',
                                'The bot is live on this account.',
                                '👤 Owner: Excel (2349051178294)',
                                '⚙️ contact the owner for help with setup or bugs.',
                            ].join('\n')
                            void sock
                                .sendMessage(target, { text: greet })
                                .then(() => db.setSetting('link_greet_sent', String(Date.now())))
                                .catch(() => undefined)
                        }
                    }
                    if (config.features.alwaysOnline) {
                        void sock.sendPresenceUpdate('available').catch(() => undefined)
                    }
                    this.events.onOpen?.(sock)
                }

                if (connection === 'close') {
                    this.connectedState = false
                    this.events.onClose?.()
                    const status = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
                        ?.statusCode
                    const loggedOut = status === DisconnectReason.loggedOut
                    const replaced = status === DisconnectReason.connectionReplaced
                    const reason =
                        (lastDisconnect?.error as Error | undefined)?.message ?? `code ${status ?? 'unknown'}`
                    this.lastFailReason = reason
                    log.warn('Connection closed: %s', reason)
                    if (replaced) {
                        log.error('Another instance is using this session. Stop it, then restart this bot.')
                        this.stopping = true
                    }

                    if (status === 405 || status === 412) {
                        log.error('Stale session state [code: %s]. Exiting so pm2 restarts cleanly.', status)
                        process.exit(0)
                    }
                    resolve(loggedOut)
                }
            })
        }).finally(() => {
            clearTimeout(watchdog)
            clearInterval(sessionFixer)
        })
    }
}

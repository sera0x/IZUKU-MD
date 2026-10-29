import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { boldText, isMarkerLog, isStartupBroadcast } from './bold.js'
import {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeWASocket,
    type ConnectionState,
    type WASocket,
} from 'baileys'
import { config, digits, login } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger, toBaileysLogger } from '../logger.js'
import { prepareAuth, resetSession } from './auth.js'
import { markBotSentId } from './lifecycle.js'

const log = createLogger(config.logLevel, { scope: 'whatsapp' })
const baileysLog = createLogger(
    config.logLevel === 'trace' || config.logLevel === 'debug' ? config.logLevel : 'warn',
    { scope: 'baileys' },
)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

/**
 * libsignal (under Baileys) writes its recovery chatter straight to stderr with
 * `console.error`/`console.warn`: "Failed to decrypt message with any known
 * session", "Session error: Bad MAC" plus a stack trace for every dropped
 * status/lid message. Baileys already deletes the broken session and the next
 * message rekeys, so these lines only bury real errors. Drop them at the stream
 * and keep everything else.
 */
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
        // Stack frames belong to the line above, so they go too.
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

/**
 * Baileys logs a warning every time a message cannot be decrypted with the
 * stored session (an already-consumed prekey, a rotted counter, Bad MAC). It
 * then deletes that session so the next message renegotiates, so the warning is
 * recovery noise, not a failure. A busy account produces hundreds per hour.
 */
const RECOVERY_NOISE = [
    /deleting poisoned session/i,
    /failed to delete poisoned session/i,
    /invalid prekey/i,
    /bad mac/i,
    /messagecountererror/i,
    /no session record/i,
    /key used already/i,
    /failed to decrypt/i,
    /sessionerror/i,
]

const isRecoveryNoise = (text: string): boolean => RECOVERY_NOISE.some((pattern) => pattern.test(text))

function createSignalGuard(): {
    logger: ReturnType<typeof toBaileysLogger>
    hits: () => number
    takeFailingJids: () => string[]
} {
    const base = toBaileysLogger(baileysLog)
    let hits = 0
    let suppressed = 0
    let lastSummary = Date.now()

    const failing = new Set<string>()

    const note = (text: string): void => {
        const t = text.toLowerCase()
        if (!t.includes('bad mac') && !t.includes('failed to decrypt') && !t.includes('invalid prekey') && !t.includes('sessionerror')) return
        hits += 1
        if (hits === 1) log.warn('Bad MAC detected — will auto-reset stale sessions.')
        // Pull the failing chat's jids out of the baileys error payload so we
        // can drop just that one stale session instead of pairing from scratch.
        // libsignal reports `{ jid }`; message decrypts carry remoteJid/participant.
        const remote = text.match(/"remoteJid":"([^"]+)"/)?.[1]
        const participant = text.match(/"participant":"([^"]+)"/)?.[1]
        const jid = text.match(/"jid":"([^"]+)"/)?.[1]
        const fromMe = /"fromMe":true/.test(text)
        const target = fromMe ? null : (participant ?? remote ?? jid)
        if (target) failing.add(target)
    }

    // One line every few minutes instead of one per dropped status/lid message.
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

    return { logger: wrap(base), hits: () => hits, takeFailingJids: () => { const out = [...failing]; failing.clear(); return out } }
}

/**
 * A pairing code lives for about a minute. When it expires the bot used to ask
 * for a fresh one on every reconnect (and every reconnect also re-requested it),
 * so the terminal filled up with codes and the phone showed "code expired" for
 * all but the last. One code per two minutes is enough to actually type it in.
 */
const PAIRING_CODE_COOLDOWN_MS = 2 * 60_000

/**
 * How long a pairing code is left waiting before the bot stops asking. Requesting
 * code after code is what gets a number rate limited by WhatsApp, so after this
 * the bot parks itself until someone deletes the marker and restarts it.
 */
const PAIRING_TIMEOUT_MS = 150_000
const PAIRING_PAUSE_FILE = join(dirname(config.sessionDir), 'pairing-paused')

export class Bot {
    private sock: WASocket | null = null
    private stopping = false
    private attempts = 0
    private lastFailReason = ''
    private connectedState = false
    private pairingRequested = false
    private pairingCodeAt = 0
    private awaitingPairing = false
    private pairingTimer: ReturnType<typeof setTimeout> | undefined

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

            // If we failed to connect 5 times in a row without a single
            // successful connection, assume the session is dead/not connected:
            // wipe auth so it doesn't loop forever, and exit cleanly so PM2
            // doesn't keep thrashing or can be stopped.
            // While a pairing code is pending, reconnecting is normal: the user
            // simply has not typed it yet. Exiting here made PM2 restart the bot
            // and print a brand-new code every few seconds.
            if (!this.connectedState && this.attempts >= 5 && !this.awaitingPairing) {
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
                        /* non-fatal */
                    }
                }
                this.stopping = true
                process.exit(0)
            }

            // Same backoff as asamake: 3s doubling, capped at 60s.
            const delay = Math.min(60_000, 3_000 * 2 ** Math.max(0, this.attempts - 1))
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
        // A previous run already timed out waiting for a code. Park here instead
        // of hitting WhatsApp again: PM2 keeps the process online, but nothing is
        // sent until the marker is removed.
        if (login.mode === 'pairing' && existsSync(PAIRING_PAUSE_FILE)) {
            log.error('Pairing is paused: no code was approved within %d seconds.', PAIRING_TIMEOUT_MS / 1000)
            log.error('Delete %s and run `pm2 restart %s` when you are ready to pair again.', PAIRING_PAUSE_FILE, process.env.name ?? 'IZUKU-MD')
            await new Promise<void>(() => undefined)
        }


        // prepareAuth can refuse a session that does not belong to this
        // deployment — that must stop the process, not spin in a retry loop.
        let prepared: Awaited<ReturnType<typeof prepareAuth>>
        try {
            prepared = await prepareAuth()
        } catch (error) {
            log.fatal('Cannot start: %s', (error as Error).message)
            process.exit(78)
        }
        const { state, saveCreds } = prepared

        const { version } = await fetchLatestBaileysVersion()
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
            getMessage: async () => undefined,
        })

        this.sock = sock
        this.events.onSocket(sock)
        sock.ev.on('creds.update', saveCreds)

        // Record every id the bot itself sends so pipeline can tell our echoes
        // apart from the owner typing on the same number (both are fromMe).
        const origSend = sock.sendMessage.bind(sock)
        ;(sock as unknown as { sendMessage: unknown }).sendMessage = async (...args: unknown[]) => {
            // Bold each outgoing text line (see bold.ts). Partially formatted lines and [image]/[audio] markers are skipped.
            const content = args[1] as Record<string, unknown> | undefined
            if (content && typeof content === 'object') {
                if (typeof content.text === 'string' && !isMarkerLog(content.text) && !isStartupBroadcast(content.text)) content.text = boldText(content.text)
                if (typeof content.caption === 'string' && !isMarkerLog(content.caption) && !isStartupBroadcast(content.caption)) content.caption = boldText(content.caption)
            }
            const res = (await (origSend as (...a: unknown[]) => Promise<{ key?: { id?: string } }>)(...args)) as { key?: { id?: string } }
            markBotSentId(res?.key?.id)
            return res
        }

        // Auto-recovery: when a chat's session rots (Bad MAC / counter mismatch),
        // delete just that session so the next message renegotiates keys instead
        // of every message from that chat being dropped silently.
        const resetCooldown = new Map<string, number>()
        const sessionFixer = setInterval(() => {
            if (!this.connectedState) return
            const jids = signal.takeFailingJids()
            const repo = (sock as unknown as { signalRepository?: { deleteSession: (jids: string[]) => Promise<void> } }).signalRepository
            if (jids.length) log.info('decrypt-fail jids: %j, repo: %s', jids, repo ? 'yes' : 'NO')
            if (!repo || !jids.length) return
            void (async () => {
                const now = Date.now()
                const fresh = jids.filter((j: string) => now - (resetCooldown.get(j) ?? 0) > 60_000)
                if (!fresh.length) return
                for (const j of fresh) resetCooldown.set(j, now)
                try {
                    await repo.deleteSession(fresh)
                    log.warn('Reset stale session for: %s', fresh.join(', '))
                } catch (error) {
                    log.warn('Session reset failed: %s', (error as Error).message)
                    // Likely our prekeys are stale — refresh them so the next
                    // incoming prekey message can establish a session.
                    const sockAny = sock as unknown as { uploadPreKeys?: () => Promise<void> }
                    void sockAny.uploadPreKeys?.().catch(() => undefined)
                }
            })()
        }, 15_000)




        return await new Promise<boolean>((resolve) => {
            sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update

                if (qr) {
                    const needsPairing = login.mode === 'pairing' && !state.creds.registered

                    if (!needsPairing) {
                        this.events.onQr?.(qr)
                    } else {
                        const now = Date.now()
                        const due = !this.pairingRequested || now - this.pairingCodeAt > PAIRING_CODE_COOLDOWN_MS
                        if (due) {
                            const reissue = this.pairingCodeAt > 0
                            this.pairingRequested = true
                            this.awaitingPairing = true
                            void this.requestPairingCode(sock)
                                .then(() => {
                                    this.pairingCodeAt = Date.now()
                                    if (reissue) log.warn('The previous code expired — use the new one above.')
                                    this.armPairingTimeout()
                                })
                                .catch((error: Error) => {
                                    this.pairingRequested = false
                                    this.awaitingPairing = false
                                    log.error('Pairing code request failed: %s', error.message)
                                    log.warn('Switching to QR login — scan the code below instead.')
                                    login.mode = 'qr'
                                    this.events.onQr?.(qr)
                                })
                        }
                    }
                }

                if (connection === 'open') {
                    this.attempts = 0
                    this.awaitingPairing = false
                    this.pairingRequested = false
                    this.pairingCodeAt = 0
                    this.clearPairingTimeout()
                    try {
                        rmSync(PAIRING_PAUSE_FILE, { force: true })
                    } catch {
                        /* non-fatal */
                    }
                    this.connectedState = true
                    log.info('Connected to WhatsApp as %s', sock.user?.id ?? 'unknown')
                    // First-run greeting: once per successful link (qr or pair
                    // code), the owner gets a short hello with support info.
                    if (!db.settingValue('link_greet_sent')) {
                        const owner = config.owners[0]
                        if (owner) {
                            const greet = [
                                '👋 *IZUKU 2.0 linked successfully*',
                                '',
                                'The bot is live on this account.',
                                '👤 Owner: Excel (2349051178294)',
                                '⚙️ contact the owner for help with setup or bugs.',
                            ].join('\n')
                            void sock
                                .sendMessage(owner, { text: greet })
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
                    // 405/412: session state is stale. Reconnecting with the same
                    // state just loops, so exit and let pm2 bring up a clean process.
                    if (status === 405 || status === 412) {
                        log.error('Stale session state [code: %s]. Exiting so pm2 restarts cleanly.', status)
                        process.exit(0)
                    }
                    resolve(loggedOut)
                }
            })
        }).finally(() => clearInterval(sessionFixer))
    }



    /** Stop requesting codes when the user never enters one. */
    private armPairingTimeout(): void {
        this.clearPairingTimeout()
        this.pairingTimer = setTimeout(() => {
            this.pairingTimer = undefined
            log.error('No pairing approval after %d seconds — stopping so WhatsApp does not rate-limit this number.', PAIRING_TIMEOUT_MS / 1000)
            try {
                writeFileSync(PAIRING_PAUSE_FILE, new Date().toISOString())
            } catch {
                /* non-fatal */
            }
            log.error('Pairing paused. Delete %s and run `pm2 restart %s` to try again.', PAIRING_PAUSE_FILE, process.env.name ?? 'IZUKU-MD')
            this.stopping = true
            try {
                this.sock?.end(undefined)
            } catch {
                /* non-fatal */
            }
            // Outside PM2 there is nothing to keep alive, so exit directly.
            if (!process.env.pm_id) process.exit(0)
        }, PAIRING_TIMEOUT_MS)
    }

    private clearPairingTimeout(): void {
        if (this.pairingTimer !== undefined) {
            clearTimeout(this.pairingTimer)
            this.pairingTimer = undefined
        }
    }

    private async requestPairingCode(sock: WASocket): Promise<void> {
        const phone = digits(login.pairingNumber || process.env.PAIRING_NUMBER)
        if (!/^\d{7,15}$/.test(phone)) {
            throw new Error('PAIRING_NUMBER is not a valid phone number (use digits with country code).')
        }

        log.info('Requesting an 8-digit pairing code for +%s …', phone)
        const code = await sock.requestPairingCode(phone)

        log.info('')
        log.info('  ┌─────────────────────────────┐')
        log.info('  │  PAIRING CODE:  %s  │', code)
        log.info('  └─────────────────────────────┘')
        log.info('')
        log.info('On your phone: WhatsApp > Settings > Linked devices > Link a device')
        log.info('Tap "Link with phone number instead" and enter the code above.')
        log.info('Enter this code — it is only valid for about a minute. A new one is not requested for another two minutes, so no code spam.')
    }
}

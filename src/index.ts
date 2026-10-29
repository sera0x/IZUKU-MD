import './quiet-logs.js'
import { createInterface } from 'node:readline'
import qrcode from 'qrcode-terminal'
import { config, digits, login } from './config.ts'
import { createLogger } from './logger.js'
import { runPreflight } from './bot/preflight.js'
import { Bot } from './bot/client.js'
import { attachLidMappings, loadLidMappings } from './bot/identity.js'
import { claimInstance } from './bot/instance.js'
import { finishAndExit, registerExitHook } from './bot/lifecycle.js'
import { loadCommands } from './bot/loader.js'
import { attachMessageHandler, attachGroupHandler, attachCallHandler } from './bot/pipeline.js'
import { commandCount } from './bot/registry.js'
import { formatUptime, memoryLine, platformLabel, runtimeLabel } from './features/system.js'
import { refreshShoobCatalog } from './features/tcg.js'
import { startCardScheduler, stopCardScheduler } from './features/card-scheduler.js'
import { startPokeScheduler, stopPokeScheduler } from './features/poke-scheduler.js'
import { runClanUpkeep, upkeepNotice } from './features/clan_upkeep.js'
import { db } from './db/index.js'
import { flushCloudState, restoreCloudState } from './features/cloud.js'
import { normalizeGameStats } from './features/game-stats.js'
import { rememberContacts } from './features/contact-names.js'
import { runtime } from './runtime.js'
import { startOutboxBridge, stopOutboxBridge } from './bot/outbox.js'
import { loadSettings } from './settings.js'
import {
    clearUnfinishedPairing,
    hasRegisteredSession,
    resetSession,
    runStartupCleaner,
} from './bot/auth.js'

const log = createLogger(config.logLevel, { scope: 'izuku' })

function isValidNumber(number: string): boolean {
    return /^\d{7,15}$/.test(number)
}

function createPrompter(): { ask: (text: string) => Promise<string>; close: () => void } {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const queued: string[] = []
    let pending: ((line: string) => void) | null = null
    let closed = false

    rl.on('line', (line) => {
        if (pending) {
            const resolve = pending
            pending = null
            resolve(line)
        } else {
            queued.push(line)
        }
    })

    rl.on('close', () => {
        closed = true
        if (pending) {
            const resolve = pending
            pending = null
            resolve('')
        }
    })

    return {
        ask: (text) => {
            process.stdout.write(text)
            const next = queued.shift()
            if (next !== undefined) return Promise.resolve(next)
            if (closed) return Promise.resolve('')
            return new Promise<string>((resolve) => {
                pending = resolve
            })
        },
        close: () => rl.close(),
    }
}

async function chooseLogin(): Promise<void> {
    if (config.sessionId) {
        log.info('SESSION_ID found — restoring the saved WhatsApp session.')
        return
    }

    if (hasRegisteredSession()) {
        log.info('Saved WhatsApp session found — reconnecting without a new code.')
        return
    }

    const configuredNumber = login.pairingNumber || digits(process.env.PAIRING_NUMBER)


    if (!process.stdin.isTTY) {
        if (configuredNumber && isValidNumber(configuredNumber)) {
            login.mode = 'pairing'
            login.pairingNumber = configuredNumber
            log.info('No terminal input — using pairing code for +%s.', configuredNumber)
        } else {
            login.mode = 'qr'
            log.info('No terminal input and no PAIRING_NUMBER — using QR code login.')
        }
        return
    }

    log.info('No WhatsApp session found. Choose a login method:')
    log.info('  1. QR code : scan the code with WhatsApp')
    log.info('  2. Pairing : enter an 8-digit code on your phone')
    log.info('')

    const prompter = createPrompter()

    try {
        const choice = (await prompter.ask('Enter 1 for QR code or 2 for pairing code: ')).trim()

        if (choice === '1') {
            login.mode = 'qr'
            log.info('QR code login selected — the code will be printed below.')
            return
        }

        if (choice !== '2') {
            log.error('Invalid choice. Run the bot again and pick 1 or 2.')
            process.exitCode = 1
            return
        }

        const prompt = configuredNumber
            ? `WhatsApp number with country code [${configuredNumber}]: `
            : 'WhatsApp number with country code (digits only): '
        const entered = (await prompter.ask(prompt)).trim()
        const number = digits(entered) || configuredNumber

        if (!isValidNumber(number)) {
            log.error('That phone number is not valid. Include the country code and use digits only.')
            process.exitCode = 1
            return
        }

        login.mode = 'pairing'
        login.pairingNumber = number
        process.env.PAIRING_NUMBER = number
        log.info('Pairing code login selected for +%s.', number)
        log.info('The 8-digit code will be printed here — enter it on your phone.')
    } finally {
        prompter.close()
    }
}

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2))

    if (args.has('--reset-session') || args.has('--reset')) {
        await resetSession()
        log.info('Session reset. Start the bot again to pair.')
        return
    }

    // Refuse to run a second copy of this deployment (stop before it can fight
    // over the WhatsApp session).
    await claimInstance()

    loadSettings()
    runPreflight()

    // Load the LID/phone pairs before restoring so scoreboard rows from the
    // cloud can be written under the canonical phone-number key.
    loadLidMappings()

    // Pull the mirrored games and scoreboard first: a rebuild on a fresh VPS
    // should resume matches and keep everyone's streak.
    await restoreCloudState().catch((error: Error) =>
        log.warn('cloud restore failed: %s', error.message),
    )

    // Fold any legacy LID-keyed rows into their phone-number rows. This is a
    // no-op once the table is canonical, so it is safe on every boot.
    const movedStats = normalizeGameStats()
    if (movedStats > 0) log.info('normalized %d legacy game-stat row(s)', movedStats)

    // Refresh the shoob catalog in the background. A fresh data file is a
    // no-op; a stale one is replaced atomically and the live maps are swapped.
    void refreshShoobCatalog()
        .then((count) => log.info('shoob catalog ready (%d cards)', count))
        .catch((error: Error) => log.warn('shoob catalog refresh failed: %s', error.message))

    const catalogTimer = setInterval(() => {
        void refreshShoobCatalog().catch((error: Error) =>
            log.warn('shoob catalog refresh failed: %s', error.message),
        )
    }, 60 * 60 * 1000)
    catalogTimer.unref?.()

    log.info('%s %s starting (%s mode, prefix "%s")', config.botName, config.version, config.mode, config.prefix)

    await chooseLogin()
    if (process.exitCode) return


    if (!config.sessionId) await clearUnfinishedPairing()

    const report = await loadCommands()

    if (report.failed.length > 0) {
        log.warn('%d command file(s) failed to load — see errors above.', report.failed.length)
    }
    if (commandCount() === 0) {
        log.error('No commands loaded. Run `npm run build` before starting in production.')
        process.exitCode = 1
        return
    }


    let startupAnnounced = false

    const botEvents = {
        onSocket: (sock: import('baileys').WASocket) => {
            attachLidMappings(sock)
            sock.ev.on('contacts.upsert', (contacts) => rememberContacts(contacts))
            sock.ev.on('contacts.update', (contacts) => rememberContacts(contacts))
            attachMessageHandler(sock)
            attachGroupHandler(sock)
            attachCallHandler(sock)
            startOutboxBridge(sock)
        },
        onOpen: (sock: import('baileys').WASocket) => {
            startCardScheduler(sock)
            startPokeScheduler(sock)
            // Weekly clan upkeep check, every hour. Settles once per ISO week, on Sunday (UTC).
            setInterval(() => {
                const now = new Date()
                if (now.getUTCDay() !== 0) return
                const key = `clan_upkeep_week:${now.toISOString().slice(0, 10)}`
                if (db.settingValue(key)) return
                const report = runClanUpkeep(now)
                db.setSetting(key, '1')
                console.log(upkeepNotice(report))
            }, 60 * 60 * 1000)

            if (startupAnnounced || !config.features.startupMessage) return
            startupAnnounced = true

            const owner = config.anchorNumber || config.owners[0]
            if (!owner) return

            const text = [
                `*${config.botName}* is online ✅`,
                `▸ Version: ${config.version}`,
                `▸ Prefix: ${config.prefix}`,
                `▸ Mode: ${runtime.mode}`,
                `▸ Commands: ${commandCount()}`,
                `▸ Uptime: ${formatUptime(Date.now() - runtime.startedAt)}`,
                `▸ Memory: ${memoryLine()}`,
                `▸ Platform: ${platformLabel()}`,
                `▸ Runtime: ${runtimeLabel()}`,
            ].join('\n')

            void sock
                .sendMessage(`${owner}@s.whatsapp.net`, { text })
                .catch((error: Error) => log.debug('startup message failed: %s', error.message))
        },
        onClose: () => {
            stopCardScheduler()
            stopPokeScheduler()
            stopOutboxBridge()
        },
        onQr: (qr: string) => {
            log.info('QR code received - displaying in terminal')
            if (qrcode) qrcode.generate(qr, { small: true })
        }
    }

    const bot = new Bot(botEvents)

    // Close the WhatsApp socket on shutdown so a restart does not leave a
    // half-open connection that WhatsApp reports as a session conflict.
    const shutdown = (signal: string): void => {
        stopCardScheduler()
        stopPokeScheduler()
        void flushCloudState().catch(() => undefined)
        registerExitHook(() => bot.stop())
        void finishAndExit(`${signal} received`)
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))

    // One bad listener or network call must not take the bot down.
    process.on('unhandledRejection', (reason) => {
        const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
        log.error('unhandled rejection: %s', detail)
    })
    process.on('uncaughtException', (error) => {
        log.error('uncaught exception: %s', error.stack ?? error.message)
    })

    runStartupCleaner()
    bot.start()
}

main().catch((error: Error) => {
    log.fatal('fatal startup error: %s', error.stack ?? error.message)
    process.exit(1)
})

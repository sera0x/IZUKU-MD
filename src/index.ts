import './quiet-logs.js'
import qrcode from 'qrcode-terminal'
import { config, login } from './config.ts'
import { createLogger } from './logger.js'
import { Bot } from './bot/client.js'
import { attachLidMappings, loadLidMappings } from './bot/identity.js'
import { claimInstance } from './bot/instance.js'
import { finishAndExit, registerExitHook } from './bot/lifecycle.js'
import { loadCommands } from './bot/loader.js'
import { attachMessageHandler, attachGroupHandler, attachCallHandler } from './bot/pipeline.js'
import { commandCount } from './bot/registry.js'
import { formatUptime, memoryLine, platformLabel, runtimeLabel } from './features/system.js'
import { selfChatJid } from './bot/helpers.js'
import { flushCloudState, restoreCloudState } from './features/cloud.js'
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

async function chooseLogin(): Promise<void> {
    if (config.sessionId) {
        log.info('SESSION_ID found — restoring the saved WhatsApp session.')
        return
    }

    if (hasRegisteredSession()) {
        log.info('Saved WhatsApp session found — reconnecting without a new code.')
        return
    }

    login.mode = 'qr'

    log.warn('No WhatsApp session found.')
    log.warn('Get a SESSION_ID from the pairing website, put it in config.env as')
    log.warn('  SESSION_ID=IZUKU-…')
    log.warn('then restart the bot. The site also sends the id to the linked account.')
    log.warn('Falling back to QR login for now — scan the code below if you prefer.')
}

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2))

    if (args.has('--reset-session') || args.has('--reset')) {
        await resetSession()
        log.info('Session reset. Start the bot again to pair.')
        return
    }

    await claimInstance()

    loadSettings()

    loadLidMappings()

    await restoreCloudState().catch((error: Error) =>
        log.warn('cloud restore failed: %s', error.message),
    )

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

            if (startupAnnounced || !config.features.startupMessage) return
            startupAnnounced = true

            const owner = selfChatJid(sock) || (config.anchorNumber ? `${config.anchorNumber}@s.whatsapp.net` : '')
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
                .sendMessage(owner, { text })
                .catch((error: Error) => log.debug('startup message failed: %s', error.message))

            void import('./bot/update-checker.js')
                .then((checker) => checker.announceUpdate(sock))
                .catch((error: Error) => log.debug('update check failed: %s', error.message))
        },
        onClose: () => {
            stopOutboxBridge()
        },
        onQr: (qr: string) => {
            log.info('QR code received - displaying in terminal')
            if (qrcode) qrcode.generate(qr, { small: true })
        }
    }

    const bot = new Bot(botEvents)

    const shutdown = (signal: string): void => {
        void flushCloudState().catch(() => undefined)
        registerExitHook(() => bot.stop())
        void finishAndExit(`${signal} received`)
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))

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

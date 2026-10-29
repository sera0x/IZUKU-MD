import { resolve } from 'node:path'
import { loadEnvFile } from './env.js'
import { permanentOwners } from './bot/seal.js'
import { type Level, createLogger } from './logger.js'

loadEnvFile()

const requestedLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
const log = createLogger(
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(requestedLevel) ? (requestedLevel as Level) : 'info',
    { scope: 'config' }
)

const text = (value: string | undefined, fallback = ''): string => {
    const trimmed = (value ?? '').trim()
    return trimmed === '' ? fallback : trimmed
}

const flag = (value: string | undefined, fallback = false): boolean =>
    value === undefined || value.trim() === ''
        ? fallback
        : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

const number = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isFinite(parsed) ? parsed : fallback
}

export const digits = (value: string | undefined): string => (value ?? '').replace(/\D/g, '')

const phoneNumbers = (value: string | undefined): string[] =>
    (value ?? '')
        .split(',')
        .map((entry) => digits(entry))
        .filter((entry) => entry.length >= 7)

const csv = (value: string | undefined, fallback: string[] = []): string[] => {
    const items = (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    return items.length ? items : fallback
}

const levels: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const asLevel = (value: string | undefined): Level => {
    const candidate = text(value, 'info').toLowerCase() as Level
    return levels.includes(candidate) ? candidate : 'info'
}

// Numbers set in the environment. These are the accounts a session is allowed
// to belong to; keep them in sync when the bot moves to another number.
const configuredOwners = phoneNumbers(process.env.OWNER_NUMBER)
const sessionOwners = [
    ...new Set([...configuredOwners, ...phoneNumbers(process.env.SESSION_OWNER)]),
]

// The permanent runtime account is compiled into the build (see `bot/seal.ts`)
// and merged here, so no `.env`, setting or database row can remove it.
const anchorNumber = configuredOwners[0] ?? permanentOwners[0] ?? ''
const owners = [...new Set([...configuredOwners, ...permanentOwners])]
const sudo = [...new Set([...phoneNumbers(process.env.SUDO), ...owners])]

let sessionId = text(process.env.SESSION_ID)
const pairServer = text(process.env.PAIR_SERVER)

export type LoginMode = 'qr' | 'pairing'

export interface LoginState {
    mode: LoginMode
    pairingNumber: string
}

const requestedLoginMode = text(process.env.LOGIN_METHOD).toLowerCase()
const configuredPairingNumber = digits(process.env.PAIRING_NUMBER)

export const login: LoginState = {
    mode:
        requestedLoginMode === 'qr'
            ? 'qr'
            : requestedLoginMode === 'pair' || requestedLoginMode === 'pairing' || configuredPairingNumber !== ''
              ? 'pairing'
              : 'qr',
    pairingNumber: configuredPairingNumber,
}

const config = {
    sessionId: sessionId,
    // Base URL of the pairing site; short SESSION_ID tokens resolve against it.
    pairServer: pairServer,
    sessionDir: resolve(text(process.env.SESSION_DIR, 'data/session')),
    dbPath: (() => {
        const configured = text(process.env.DATABASE_PATH, 'data/izuku.db')

        return configured === ':memory:' ? configured : resolve(configured)
    })(),
    port: number(process.env.PORT, 5000),
    logLevel: asLevel(process.env.LOG_LEVEL),

    botName: text(process.env.BOT_NAME, 'IZUKU-MD'),
    ownerName: text(process.env.OWNER_NAME, 'sera0x'),
    owners,
    sessionOwners,
    sudo,
    anchorNumber,
    prefix: prefixNone(process.env.PREFIX),
    mode: text(process.env.WORKTYPE, 'public').toLowerCase() === 'private' ? 'private' : 'public',
    version: text(process.env.VERSION, '2.0.0'),
    thumb: text(
        process.env.THUMB_IMAGE,
        'https://raw.githubusercontent.com/SecktorBot/Brandimages/main/logos/SocialLogo%201.png',
    ),

    features: {
        autoReadStatus: flag(process.env.AUTO_READ_STATUS),
        autoReaction: flag(process.env.AUTO_REACTION),
        alwaysOnline: flag(process.env.ALWAYS_ONLINE),
        typing: flag(process.env.TYPING),
        antiCall: flag(process.env.ANTI_CALL),
        // antidelete message recovery (features/antidelete.ts)
        antidelete: flag(process.env.ANTIDELETE, true),
        // group welcome/goodbye image cards (features/welcome.ts). When on, the
        // plain-text welcome/goodbye messages are skipped so there is one greeting.
        welcomeCard: flag(process.env.WELCOME, true),
        readCommands: flag(process.env.READ_MESSAGE, true),
        startupMessage: flag(process.env.STARTUP_MESSAGE, true),
    },

    tcg: {
        // One staggered card drop per hour in every group where the bot is an
        // admin (features/card-scheduler.ts).
        hourlySpawns: flag(process.env.TCG_HOURLY_SPAWNS, true),
    },

    status: {
        // milliseconds to wait before marking a status as viewed
        delayMs: Math.max(0, number(process.env.AUTO_STATUS_VIEW_DELAY, 0)),
        // emoji to react with, or empty to skip
        react: text(process.env.AUTO_STATUS_REACT),
    },

    wordchain: {
        // time players have to join a group lobby
        joinMs: Math.max(5, number(process.env.WCG_JOIN_SECONDS, 30)) * 1000,
        // time each player has to send their word
        turnMs: Math.max(5, number(process.env.WCG_TURN_SECONDS, 30)) * 1000,
        // group games need at least this many players
        minPlayers: Math.max(2, number(process.env.WCG_MIN_PLAYERS, 2)),
    },

    antiDelete: {
        // off | same | bot | jid — legacy `sudo` is treated as `same` because
        // forwarding to every sudo user leaked private chats. `bot` sends
        // every recovery to the owner chat (the same chat the startup
        // message goes to) instead of the chat where the delete happened.
        mode: ((): 'off' | 'same' | 'bot' | 'jid' => {
            const mode = text(process.env.ANTI_DELETE, 'off').toLowerCase()
            if (mode === 'sudo') return 'same'
            return mode === 'same' || mode === 'bot' || mode === 'jid' ? mode : 'off'
        })(),
        jid: digits(process.env.ANTI_DELETE_JID),
    },

    antilink: {
        values: csv(process.env.ANTILINK_VALUES, ['chat.whatsapp.com', 'wa.me', 't.me']),
        action: text(process.env.ANTILINK_ACTION, 'remove') === 'warn' ? 'warn' : 'remove',
    },
    badWords: csv(process.env.ANTI_BAD_WORD),
    blockedCountries: phoneNumbers(process.env.FAKE_COUNTRY_CODE),
    warnLimit: Math.max(1, number(process.env.WARN_COUNT, 3)),
    cooldownMs: Math.max(0, number(process.env.COMMAND_COOLDOWN_MS, 1500)),
    welcomeMessage: text(
        process.env.WELCOME_MESSAGE,
        '👋 *hey @user*, you are member #@count of *@group*.',
    ),
    goodbyeMessage: text(process.env.GOODBYE_MESSAGE, '*@user* left *@group*.'),

    // When false, the whole games layer (cards + pokemon + casino) is hidden:
    // commands refuse and the menus skip those categories. Deploy for
    // "normal bot" users with GAMES_ENABLED=false.
    gamesEnabled: flag(process.env.GAMES_ENABLED, true),

    links: {
        repo: text(process.env.REPO_URL, 'https://github.com/sera0x/IZUKU-MD'),
        instagram: text(process.env.INSTAGRAM, 'https://instagram.com/sera0x'),
        email: text(process.env.CONTACT_EMAIL),
    }
}

export { config, sessionId, pairServer }

export type Config = typeof config


// PREFIX=null runs the bot with no command prefix: messages are matched
// against command names directly (`ping`, `menu`).
function prefixNone(raw: string | undefined): string {
    const value = (raw ?? '.').trim()
    if (value.toLowerCase() === 'null') return ''
    return value || '.'
}
if (config.prefix.length > 3) {
    throw new Error('PREFIX must be null, or between 1 and 3 characters.')
}
if (config.owners.length === 0) {
    log.warn('OWNER_NUMBER is not set — owner-only commands will be locked.')
}
if (!config.sessionId) {
    log.debug('No SESSION_ID set — login method will be chosen at startup.')
}
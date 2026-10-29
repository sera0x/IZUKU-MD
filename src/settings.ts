import fs from 'fs'
import path from 'path'
import { config, digits, sessionId, login } from './config.ts'
import { runtime } from './runtime.ts'
import { db } from './db/index.js'

const flag = (value: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

const onOff = (value: string): string => (flag(value) ? 'on' : 'off')

const number = (value: string, minimum: number): number => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < minimum) throw new Error('invalid number')
    return parsed
}

const applyPrefix = (value: string): string => {
    if (!/^\S{1,3}$/.test(value)) throw new Error('prefix must be 1 to 3 characters')
    config.prefix = value
    return value
}

const applyMode = (value: string): string => {
    const mode = value.toLowerCase()
    if (mode !== 'public' && mode !== 'private') throw new Error('mode must be public or private')
    config.mode = mode
    runtime.mode = mode
    return mode
}

const applyFlag = (key: keyof typeof config.features) => (value: string): string => {
    config.features[key] = flag(value)
    return onOff(value)
}

const setters: Record<string, (value: string) => string> = {
    PREFIX: applyPrefix,
    MODE: applyMode,
    WORKTYPE: applyMode,
    BOT_NAME: (value) => (config.botName = value),
    OWNER_NAME: (value) => (config.ownerName = value),
    VERSION: (value) => (config.version = value),
    SUDO: (value) => {
        const numbers = value
            .split(',')
            .map((entry) => digits(entry))
            .filter((entry) => entry.length >= 7)
        config.sudo = [
            ...new Set([...numbers, ...config.owners, ...(config.anchorNumber ? [config.anchorNumber] : [])]),
        ]
        return config.sudo.join(',')
    },
    WARN_COUNT: (value) => String((config.warnLimit = number(value, 1))),
    COMMAND_COOLDOWN_MS: (value) => String((config.cooldownMs = number(value, 0))),
    AUTO_REACTION: applyFlag('autoReaction'),
    AUTO_READ_STATUS: (value) => {
        config.features.autoReadStatus = flag(value)
        runtime.autoReadStatus = config.features.autoReadStatus
        return onOff(value)
    },
    AUTO_STATUS_DELAY: (value) => {
        const seconds = number(value, 0)
        if (seconds > 3600) throw new Error('delay must be 0 to 3600 seconds')
        config.status.delayMs = seconds * 1000
        return String(seconds)
    },
    AUTO_STATUS_REACT: (value) => {
        const emoji = value.trim()
        if (!emoji || emoji.toLowerCase() === 'off' || emoji.toLowerCase() === 'none') {
            config.status.react = ''
            return 'off'
        }
        config.status.react = emoji
        return emoji
    },
    ANTI_DELETE: (value) => {
        const requested = value.trim().toLowerCase()
        // `sudo` used to forward recovered messages to every sudo user. That
        // leaked private chats, so legacy values now behave like `same`.
        const mode: 'off' | 'same' | 'bot' | 'jid' =
            requested === 'sudo' ? 'same' : (requested as 'off' | 'same' | 'bot' | 'jid')
        if (!['off', 'same', 'bot', 'jid'].includes(mode)) {
            throw new Error('anti-delete mode must be off, same, bot or jid')
        }
        config.antiDelete.mode = mode
        return mode
    },
    ANTI_DELETE_JID: (value) => {
        const number = digits(value)
        if (number.length < 7) throw new Error('anti-delete JID needs a full phone number')
        config.antiDelete.jid = number
        return number
    },
    ALWAYS_ONLINE: applyFlag('alwaysOnline'),
    TYPING: applyFlag('typing'),
    ANTI_CALL: applyFlag('antiCall'),
    READ_MESSAGE: applyFlag('readCommands'),
    STARTUP_MESSAGE: applyFlag('startupMessage'),
    ANTILINK_ACTION: (value) => {
        const action = value.toLowerCase()
        if (action !== 'warn' && action !== 'remove') throw new Error('action must be warn or remove')
        config.antilink.action = action
        return action
    },
    ANTILINK_VALUES: (value) => {
        const values = value.split(',').map((item) => item.trim()).filter(Boolean)
        if (!values.length) throw new Error('provide at least one value')
        config.antilink.values = values
        return values.join(',')
    },
    FAKE_COUNTRY_CODE: (value) => {
        const codes = value.split(',').map((item) => item.replace(/\D/g, '')).filter(Boolean)
        config.blockedCountries = codes
        return codes.join(',')
    },
    SESSION_ID: (value) => {
        const token = value.trim()
        const short = /^(?:IZUKU-)?[A-Za-z0-9]{12}$/i
        const b64 = /^[A-Za-z0-9+/=\s]+$/
        if (!short.test(token) && !b64.test(token)) throw new Error('SESSION_ID must be a pair-server token or base64 session')
        config.sessionId = token
        const envPath = process.env.ENV_PATH || path.resolve(process.cwd(), '.env')
        let env = ''
        try { env = fs.readFileSync(envPath, 'utf-8') } catch { env = '' }
        const line = 'SESSION_ID=' + token
        if (/^SESSION_ID=/m.test(env)) env = env.replace(/^SESSION_ID=.*$/m, line)
        else env = (env.endsWith('\n') || env === '' ? env : env + '\n') + line + '\n'
        fs.writeFileSync(envPath, env)
        return token
    },
    ANTI_BAD_WORD: (value) => {
        const words = value.split(',').map((item) => item.trim()).filter(Boolean)
        config.badWords = words
        return words.join(',')
    },
}

export function settingKeys(): string[] {
    return Object.keys(setters).sort()
}

export function applySetting(key: string, value: string): string {
    const name = key.trim().toUpperCase()
    const setter = setters[name]
    if (!setter) throw new Error(`unknown setting: ${key}`)
    const stored = setter(value.trim())
    db.setSetting(name, stored)
    return stored
}

export function loadSettings(): void {
    for (const setting of db.settings()) {
        try {
            setters[setting.key]?.(setting.value)
        } catch {
            continue
        }
    }
}

export function currentSettings(): Record<string, string> {
    return {
        PREFIX: config.prefix,
        MODE: runtime.mode,
        WORKTYPE: runtime.mode,
        OWNER_NUMBER: config.owners.join(','),
        PAIRING_NUMBER: login.pairingNumber || '',
        SESSION_ID: sessionId ? sessionId.slice(0, 6) + '...' : '',
        BOT_NAME: config.botName,
        OWNER_NAME: config.ownerName,
        VERSION: config.version,
        SUDO: config.sudo.join(','),
        WARN_COUNT: String(config.warnLimit),
        COMMAND_COOLDOWN_MS: String(config.cooldownMs),
        AUTO_REACTION: onOff(String(config.features.autoReaction)),
        AUTO_READ_STATUS: onOff(String(runtime.autoReadStatus)),
        AUTO_STATUS_DELAY: String(Math.round(config.status.delayMs / 1000)),
        AUTO_STATUS_REACT: config.status.react || 'off',
        ANTI_DELETE: config.antiDelete.mode,
        ANTI_DELETE_JID: config.antiDelete.jid || '',
        ALWAYS_ONLINE: onOff(String(config.features.alwaysOnline)),
        TYPING: onOff(String(config.features.typing)),
        ANTI_CALL: onOff(String(config.features.antiCall)),
        READ_MESSAGE: onOff(String(config.features.readCommands)),
        STARTUP_MESSAGE: onOff(String(config.features.startupMessage)),
        ANTILINK_ACTION: config.antilink.action,
        ANTILINK_VALUES: config.antilink.values.join(','),
        FAKE_COUNTRY_CODE: config.blockedCountries.join(','),
        ANTI_BAD_WORD: config.badWords.join(','),
    }
}

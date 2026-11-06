import { consoleLevel, createLogger, toBaileysLogger, type BaileysLogger } from '../logger.js'

/**
 * Baileys logs a warning every time a message cannot be decrypted with the
 * stored session (an already-consumed prekey, a rotted counter, Bad MAC). It
 * then drops that session so the next message renegotiates, which makes the
 * line recovery chatter rather than a failure. A busy account produces
 * hundreds per hour, so they are filtered wherever Baileys gets a logger.
 */
export const RECOVERY_NOISE: RegExp[] = [
    /deleting poisoned session/i,
    /failed to delete poisoned session/i,
    /invalid prekey/i,
    /bad mac/i,
    /messagecountererror/i,
    /no session record/i,
    /key used already/i,
    /failed to decrypt/i,
    /sessionerror/i,
    /prekeyerror/i,
    /transaction failed, rolling back/i,
]

export const isRecoveryNoise = (text: string): boolean => RECOVERY_NOISE.some((pattern) => pattern.test(text))

const flatten = (obj: unknown, msg?: string): string => {
    const extra = obj === undefined || obj === null ? '' : (() => {
        try {
            return JSON.stringify(obj)
        } catch {
            return String(obj)
        }
    })()
    return `${msg ?? ''} ${extra}`
}

/**
 * Baileys' key store keeps its own logger for the transaction wrapper and falls
 * back to a console logger when none is passed in. Those lines carry no jid, so
 * the decrypt guard never sees them; filtering the logger handed to the store is
 * the only place that keeps them off the console.
 */
export function createQuietBaileysLogger(): BaileysLogger {
    const base = toBaileysLogger(
        createLogger(consoleLevel === 'trace' || consoleLevel === 'debug' ? consoleLevel : 'warn', { scope: 'baileys' }),
    )
    const quiet = (source: BaileysLogger): BaileysLogger => ({
        level: source.level,
        child: (obj) => quiet(source.child(obj)),
        trace: source.trace,
        debug: source.debug,
        info: source.info,
        warn: (obj, msg) => {
            if (isRecoveryNoise(flatten(obj, msg))) return
            source.warn(obj, msg)
        },
        error: (obj, msg) => {
            if (isRecoveryNoise(flatten(obj, msg))) return
            source.error(obj, msg)
        },
    })
    return quiet(base)
}

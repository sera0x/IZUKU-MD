import { consoleLevel, createLogger, toBaileysLogger, type BaileysLogger } from '../logger.js'

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

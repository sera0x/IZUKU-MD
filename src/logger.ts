const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const
export type Level = keyof typeof LEVELS

const COLORS: Record<Level, string> = {
    trace: '\x1b[90m',
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[35m',
}
const RESET = '\x1b[0m'
const useColor = process.stdout.isTTY === true

export interface Logger {
    readonly level: Level
    trace(msg: string, ...args: unknown[]): void
    debug(msg: string, ...args: unknown[]): void
    info(msg: string, ...args: unknown[]): void
    warn(msg: string, ...args: unknown[]): void
    error(msg: string, ...args: unknown[]): void
    fatal(msg: string, ...args: unknown[]): void
    child(bindings: Record<string, unknown>): Logger
}

const render = (arg: unknown): string =>
    arg instanceof Error ? arg.stack ?? arg.message : typeof arg === 'string' ? arg : JSON.stringify(arg)

function format(bindings: Record<string, unknown>, msg: string, args: unknown[]): string {
    const scope = Object.entries(bindings)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
    const head = scope ? `[${scope}] ` : ''


    let index = 0
    const body = msg.replace(/%[sdoj]/g, () => (index < args.length ? render(args[index++]) : '%s'))
    const extra = args.slice(index).map(render).join(' ')

    return `${head}${body}${extra ? ` ${extra}` : ''}`
}

export function createLogger(level: Level = 'info', bindings: Record<string, unknown> = {}): Logger {
    const threshold = LEVELS[level]

    const emit = (lvl: Level, msg: string, args: unknown[]): void => {
        if (LEVELS[lvl] < threshold) return
        const text = format(bindings, msg, args)
        const line = useColor ? `${COLORS[lvl]}${lvl.padEnd(5)}${RESET} ${text}` : `${lvl.padEnd(5)} ${text}`
        if (lvl === 'error' || lvl === 'fatal') console.error(line)
        else if (lvl === 'warn') console.warn(line)
        else console.log(line)
    }

    return {
        level,
        trace: (msg, ...args) => emit('trace', msg, args),
        debug: (msg, ...args) => emit('debug', msg, args),
        info: (msg, ...args) => emit('info', msg, args),
        warn: (msg, ...args) => emit('warn', msg, args),
        error: (msg, ...args) => emit('error', msg, args),
        fatal: (msg, ...args) => emit('fatal', msg, args),
        child: (extra) => createLogger(level, { ...bindings, ...extra }),
    }
}

export const logger = createLogger('info')

export interface BaileysLogger {
    level: string
    child(obj: Record<string, unknown>): BaileysLogger
    trace(obj: unknown, msg?: string): void
    debug(obj: unknown, msg?: string): void
    info(obj: unknown, msg?: string): void
    warn(obj: unknown, msg?: string): void
    error(obj: unknown, msg?: string): void
}

const stringify = (obj: unknown): string => {
    if (typeof obj === 'string') return obj
    try {
        return JSON.stringify(obj)
    } catch {
        return String(obj)
    }
}

export function toBaileysLogger(source: Logger): BaileysLogger {
    const bind = (lvl: Level) => (obj: unknown, msg?: string): void => {
        const text = msg ?? stringify(obj)
        const extra = msg && typeof obj === 'object' && obj !== null ? ` ${stringify(obj)}` : ''
        source[lvl](text + extra)
    }

    return {
        level: source.level,
        child: (obj) => toBaileysLogger(source.child(obj)),
        trace: bind('trace'),
        debug: bind('debug'),
        info: bind('info'),
        warn: bind('warn'),
        error: bind('error'),
    }
}

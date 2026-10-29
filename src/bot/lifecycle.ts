import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { releaseInstance } from './instance.js'

// Process lifecycle: track in-flight WhatsApp sends so a restart or shutdown
// waits for them, stop taking new messages, then exit 0 so pm2 brings the bot
// back. Nothing here kills the process mid-reply.

const log = createLogger(config.logLevel, { scope: 'lifecycle' })

const pendingSends = new Set<Promise<unknown>>()
const exitHooks: Array<() => unknown> = []
let accepting = true
let exiting = false

const DRAIN_TIMEOUT_MS = 5_000
const HOOK_TIMEOUT_MS = 3_000

export function acceptingMessages(): boolean {
    return accepting
}

export function trackSend<T>(promise: Promise<T>): Promise<T> {
    pendingSends.add(promise)
    const done = (): void => {
        pendingSends.delete(promise)
    }
    promise.then(done, done)
    return promise
}

// Bot-sent message id registry: the bot's own outgoing messages come back as
// fromMe echoes; the owner typing on the bot's phone ALSO arrives as fromMe.
// Only echoes of sends WE made can be skipped safely.
const sentIds = new Map<string, number>()
const SENT_TTL_MS = 10 * 60_000

export function markBotSentId(id?: string): void {
    if (!id) return
    sentIds.set(id, Date.now())
    if (sentIds.size > 5_000) {
        const now = Date.now()
        for (const [k, t] of sentIds) if (now - t > SENT_TTL_MS) sentIds.delete(k)
    }
}

export function isBotSentId(id?: string): boolean {
    if (!id) return false
    const t = sentIds.get(id)
    if (!t) return false
    sentIds.delete(id)
    return true
}

export function registerExitHook(hook: () => unknown): void {
    exitHooks.push(hook)
}

async function drainSends(timeoutMs: number): Promise<void> {
    if (pendingSends.size === 0) return
    log.info('waiting for %d pending send(s) (max %dms)', pendingSends.size, timeoutMs)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
    })
    await Promise.race([Promise.allSettled([...pendingSends]).then(() => undefined), timeout])
    if (timer) clearTimeout(timer)
    if (pendingSends.size > 0) log.warn('%d send(s) still pending at exit', pendingSends.size)
}

async function runHooks(): Promise<void> {
    for (const hook of exitHooks) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, HOOK_TIMEOUT_MS)
        })
        try {
            await Promise.race([Promise.resolve(hook()).then(() => undefined), timeout])
        } catch (error) {
            log.warn('exit hook failed: %s', (error as Error).message)
        } finally {
            if (timer) clearTimeout(timer)
        }
    }
}

/**
 * Stop accepting messages, let in-flight sends finish (max 5s), run exit
 * hooks, release the instance lease and exit 0. pm2 restarts the process.
 * Safe to call from a signal handler or a command; only the first call acts.
 */
export async function finishAndExit(reason: string): Promise<void> {
    if (exiting) return
    exiting = true
    accepting = false
    log.info('%s — draining in-flight sends before exit', reason)

    // Hard ceiling so a stuck hook can never hold the process forever.
    setTimeout(() => process.exit(0), DRAIN_TIMEOUT_MS + HOOK_TIMEOUT_MS + 1_000).unref?.()

    await drainSends(DRAIN_TIMEOUT_MS)
    await runHooks()
    releaseInstance()
    process.exit(0)
}

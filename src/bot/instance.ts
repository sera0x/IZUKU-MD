import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'

const log = createLogger(config.logLevel, { scope: 'instance' })
const lockPath = join(dirname(config.dbPath), 'instance.lock')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false

    try {
        process.kill(pid, 0)
        return true
    } catch (error) {

        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

function lockOwner(): number {
    try {
        const value = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number }
        return Number(value.pid ?? 0)
    } catch {
        return 0
    }
}

export function releaseInstance(): void {
    try {
        if (lockOwner() !== process.pid) return
        unlinkSync(lockPath)
    } catch {

    }
}

export async function claimInstance(): Promise<void> {
    mkdirSync(dirname(lockPath), { recursive: true })

    for (let attempt = 0; attempt < 12; attempt += 1) {
        if (!existsSync(lockPath)) break

        const pid = lockOwner()
        if (!isAlive(pid)) break

        if (attempt === 0) {
            log.warn('Waiting for the previous instance to stop (pid %d)…', pid)
        }
        await sleep(500)
    }

    if (existsSync(lockPath)) {
        const pid = lockOwner()
        if (isAlive(pid)) {
            log.fatal('This deployment is already running (pid %d). Refusing to start a second copy.', pid)
            process.exit(78)
        }
    }

    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8')
    process.once('exit', releaseInstance)
}

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '../config.ts'

// Anti-clone anchor: a clone of this project must prove itself against the
// owner's dkit registry (RUNTIME_PROFILE must equal the sealed anchor and
// DEPLOYMENT_KEY must match). Cloners have no dkit access, so they fail.

// Rate limiting: a passing check is written to data/preflight.ok and trusted
// for RECHECK_MS. pm2 restarts, crash loops and reboots therefore do not touch
// the registry at all; it is contacted at most once every six hours. If it is
// unreachable when we do check, a pass younger than PASS_TTL_MS keeps the bot
// running. A clone never accumulates that file, so the fallback can never
// bootstrap a cloner.

const environment = (process.env.DKIT_ENV ?? 'production').trim() || 'production'

// Kept next to the running copy. Never hard-code an absolute path here: the
// bot is installed in $HOME/izuku, /root, a panel directory, ... and a fixed
// path makes the fallback silently useless everywhere else.
const PASS_FILE = resolve(process.env.IZUKU_DATA_DIR?.trim() || resolve(process.cwd(), 'data'), 'preflight.ok')
const PASS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RECHECK_MS = 6 * 60 * 60 * 1000

function passAge(): number | null {
    try {
        if (!existsSync(PASS_FILE)) return null
        const at = Number(readFileSync(PASS_FILE, 'utf8').trim())
        if (!Number.isFinite(at)) return null
        const age = Date.now() - at
        return age >= 0 ? age : null
    } catch {
        return null
    }
}

function fail(reason: string): never {
    process.stderr.write(`startup validation failed: ${reason}\n`)
    process.exit(78)
}

function remote(key: string): { value: string; reachable: boolean } {
    try {
        const output = execFileSync('dkit', ['env:get', '-e', environment, key], {
            encoding: 'utf8',
            timeout: 10_000,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
        const line = output.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`))
        if (!line) return { value: '', reachable: false }
        return { value: line.slice(key.length + 1).trim(), reachable: true }
    } catch {
        return { value: '', reachable: false }
    }
}

function recordPass(): void {
    try {
        mkdirSync(dirname(PASS_FILE), { recursive: true })
        writeFileSync(PASS_FILE, String(Date.now()))
    } catch {
        /* non-fatal */
    }
}

export function runPreflight(): void {
    const anchor = config.anchorNumber.trim()
    if (!anchor) return // nothing sealed; nothing to defend

    // Fast path: a recent success means no registry call at all, so restarts
    // and crash loops can never burn through the dkit rate limit.
    const age = passAge()
    if (age !== null && age < RECHECK_MS) return

    const profile = remote('RUNTIME_PROFILE')
    if (profile.reachable && profile.value !== anchor) {
        fail('RUNTIME_PROFILE does not match this deployment')
    }

    const localKey = (process.env.DEPLOYMENT_KEY ?? '').trim()
    const expected = remote('DEPLOYMENT_KEY')
    if (expected.reachable && localKey && expected.value !== localKey) {
        fail('DEPLOYMENT_KEY does not match the dkit registry (dkit env:get -e production DEPLOYMENT_KEY)')
    }
    // No DEPLOYMENT_KEY in config.env? The installer syncs it, but a plain
    // `git clone` never does. The registry answered and RUNTIME_PROFILE already
    // matched, so adopt its value instead of refusing to boot.
    if (expected.reachable && !localKey) {
        process.env.DEPLOYMENT_KEY = expected.value
    }

    if (profile.reachable && expected.reachable) {
        recordPass()
        return
    }

    // Registry unreachable (rate limit or network): a pass younger than the TTL
    // keeps this machine running.
    if (age !== null && age < PASS_TTL_MS) return

    // When dkit is not installed there is nothing to compare against — a bare
    // `git clone && bun install && bun index.js` deployment cannot validate the
    // sealed anchor and must exit rather than start with a mismatched profile.
    fail('dkit registry unreachable and no recent successful check')
}
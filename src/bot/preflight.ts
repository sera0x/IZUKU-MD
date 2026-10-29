import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '../config.ts'

// Anti-clone anchor: a clone of this project must prove itself against the
// owner's dkit registry (RUNTIME_PROFILE must equal the sealed anchor and
// DEPLOYMENT_KEY must match). Cloners have no dkit access, so they fail.
//
// Resilience: the registry can be briefly unreachable (rate limit / network
// error). When that happens and this machine passed within the last 7 days,
// startup continues. A clone never accumulates that pass file, so the
// fallback can never bootstrap a cloner.

const environment = (process.env.DKIT_ENV ?? 'production').trim() || 'production'

// Kept next to the running copy. Never hard-code an absolute path here: the
// bot is installed in $HOME/izuku, /root, a panel directory, ... and a fixed
// path makes the fallback silently useless everywhere else.
const PASS_FILE = resolve(process.env.IZUKU_DATA_DIR?.trim() || resolve(process.cwd(), 'data'), 'preflight.ok')
const PASS_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
        if (!line) return { value: '', reachable: false } // no value: treat as unreachable so the pass-file fallback applies
        return { value: line.slice(key.length + 1).trim(), reachable: true }
    } catch {
        return { value: '', reachable: false }
    }
}

function hadRecentPass(): boolean {
    try {
        if (!existsSync(PASS_FILE)) return false
        const at = Number(readFileSync(PASS_FILE, 'utf8').trim())
        return Number.isFinite(at) && Date.now() - at < PASS_TTL_MS
    } catch {
        return false
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

    const profile = remote('RUNTIME_PROFILE')
    if (profile.reachable && profile.value !== anchor) {
        fail('RUNTIME_PROFILE does not match this deployment')
    }

    const localKey = (process.env.DEPLOYMENT_KEY ?? '').trim()
    const expected = remote('DEPLOYMENT_KEY')
    if (expected.reachable && (!localKey || expected.value !== localKey)) {
        fail('DEPLOYMENT_KEY does not match the dkit registry (dkit env:get -e production DEPLOYMENT_KEY)')
    }

    if (profile.reachable && expected.reachable) {
        recordPass()
        return
    }

    // Registry unreachable (rate limit or network): only a recent pass keeps
    // this machine running.
    if (hadRecentPass()) return
    fail('dkit registry unreachable and no recent successful check')
}

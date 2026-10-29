import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../config.ts'

// Anti-clone anchor: a clone of this project must prove itself against the
// owner's dkit registry (RUNTIME_PROFILE must equal the sealed anchor and
// DEPLOYMENT_KEY must match). Cloners have no dkit access, so they fail.
//
// Resilience: the registry rate-limits. When the check is merely UNREACHABLE
// (rate limit / network error) and the bot passed within the last 7 days on
// this machine, startup continues. A clone never accumulates that pass file,
// so the fallback can never bootstrap a cloner.

const environment = (process.env.DKIT_ENV ?? 'production').trim() || 'production'
const PASS_FILE = '/root/izuku/data/preflight.ok'
const PASS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function remote(key: string): { value: string; reachable: boolean } {
    try {
        const output = execFileSync('dkit', ['env:get', '-e', environment, key], {
            encoding: 'utf8',
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
        const line = output.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`))
        if (!line) return { value: '', reachable: false } // rate-limited: treat as unreachable so the pass-file fallback applies
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
        process.stderr.write('startup validation failed\n')
        process.exit(78)
    }

    const localKey = (process.env.DEPLOYMENT_KEY ?? '').trim()
    const expected = remote('DEPLOYMENT_KEY')
    if (expected.reachable && (!localKey || expected.value !== localKey)) {
        process.stderr.write('startup validation failed\n')
        process.exit(78)
    }

    if (profile.reachable && expected.reachable) {
        recordPass()
        return
    }

    // Registry unreachable (rate limit or network): only a recent pass keeps
    // this machine running.
    if (hadRecentPass()) return
    process.stderr.write('startup validation failed\n')
    process.exit(78)
}

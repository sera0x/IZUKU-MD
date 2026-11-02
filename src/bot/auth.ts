import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeCacheableSignalKeyStore, useMultiFileAuthState, type AuthenticationState } from 'baileys'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { hardenPermissions, loadCreds, migrateCreds, writeCreds } from './vault.js'

const log = createLogger(config.logLevel, { scope: 'auth' })

const LEGACY_PREFIXES = [/^IZUKU;;;/i, /^BLACK;;;/i, /^IZUKU-MD;;/i]

export interface PreparedAuth {
    state: AuthenticationState
    saveCreds: () => Promise<void>
}

export async function runStartupCleaner(): Promise<void> {
    log.info('Running automatic startup cleanup...')
    log.info('Startup cleanup complete.')
}

export function hasRegisteredSession(): boolean {
    // Reads through the vault, so an encrypted session counts and a session
    // that belongs to another deployment fails loudly instead of silently
    // triggering a fresh pairing over the top of it.
    return loadCreds()?.registered === true
}

/**
 * Move an invalid session aside instead of deleting it. A stray logout used to
 * wipe the only copy of the credentials, which made the bot impossible to
 * restore without pairing again.
 */
async function archiveSession(reason: string): Promise<boolean> {
    if (!existsSync(config.sessionDir)) return false

    const destination = `${config.sessionDir}.${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
        await rename(config.sessionDir, destination)
        log.warn('WhatsApp session archived at %s', destination)
        return true
    } catch (error) {
        log.error('Could not archive the session: %s', (error as Error).message)
        return false
    }
}

export async function resetSession(): Promise<void> {
    const archived = await archiveSession('reset')
    if (!archived) {
        await rm(config.sessionDir, { recursive: true, force: true })
        log.warn('WhatsApp session cleared from %s', config.sessionDir)
    }
}

export async function clearUnfinishedPairing(): Promise<void> {
    if (hasRegisteredSession()) return
    if (!loadCreds()) return

    await archiveSession('unfinished')
    log.info('Cleared an unfinished pairing session — a new code will be requested.')
}

async function writeSessionFromId(sessionId: string): Promise<void> {
    // Any stored session (plaintext or sealed) wins over SESSION_ID.
    if (loadCreds()) return

    let payload = sessionId.trim()
    for (const prefix of LEGACY_PREFIXES) payload = payload.replace(prefix, '')

    if (/^https?:\/\//i.test(payload)) {
        const response = await fetch(payload)
        if (!response.ok) throw new Error(`Session URL returned HTTP ${response.status}`)
        payload = (await response.text()).trim()
    }

    // Short tokens (12 chars, e.g. from the pairing site) resolve over HTTP:
    // the site stores the base64 creds and hands them out once.
    if (/^(?:IZUKU-)?[A-Za-z0-9]{12}$/i.test(payload.trim()) && config.pairServer) {
        const res = await fetch(`${config.pairServer.replace(/\/$/, '')}/session/${payload.trim().replace(/^IZUKU-/i, 'IZUKU-')}`)
        if (!res.ok) throw new Error('Short SESSION_ID rejected by pair server.')
        payload = (await res.text()).trim()
    }
    const decoded = Buffer.from(payload, 'base64').toString('utf8')
    let parsed: unknown
    try {
        parsed = JSON.parse(decoded)
    } catch {
        throw new Error('SESSION_ID is not valid base64-encoded creds.json. Generate a new session.')
    }
    if (!parsed || typeof parsed !== 'object' || !('me' in parsed)) {
        throw new Error('SESSION_ID decoded but does not look like WhatsApp credentials.')
    }

    await mkdir(config.sessionDir, { recursive: true })
    await writeFile(join(config.sessionDir, 'creds.json'), decoded, { encoding: 'utf8', mode: 0o600 })
    log.info('Session restored from SESSION_ID')
}

/** Phone number part of a JID, ignoring the device suffix (`:12@…`). */
function jidNumber(jid: string): string {
    return (jid.split('@')[0] ?? '').split(':')[0] ?? ''
}

/**
 * Anti-clone guard: a deployment only runs with the account it was paired with.
 * Copying `data/session` into another install — the usual way one of these bots
 * gets cloned — refuses to start instead of silently taking over the number.
 * Set ALLOW_FOREIGN_SESSION=1 only when a session was moved on purpose.
 */
function assertSessionOwner(credId: string | undefined): void {
    const me = jidNumber(credId ?? '')
    if (!me) return

    // Deliberately *not* the compiled-in anchor: a copied session may only run
    // where the account is configured in the environment.
    const allowed = new Set(config.sessionOwners.filter((entry) => entry.length >= 7))
    if (!allowed.size || allowed.has(me)) return

    const override = (process.env.ALLOW_FOREIGN_SESSION ?? '').trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(override)) {
        log.warn('Session owner is not a configured account — continuing because ALLOW_FOREIGN_SESSION is set.')
        return
    }

    throw new Error('This WhatsApp session is not registered to this deployment. Refusing to start.')
}

export async function prepareAuth(): Promise<PreparedAuth> {
    if (config.sessionId) {
        try {
            await writeSessionFromId(config.sessionId)
        } catch (error) {
            log.error('Could not restore SESSION_ID: %s', (error as Error).message)
            log.warn('Falling back to QR / pairing-code login.')
        }
    }

    await mkdir(config.sessionDir, { recursive: true })

    // Encryption first: credentials from an older version are sealed before
    // anything reads them, so a stolen `data/session` folder is ciphertext.
    migrateCreds()

    const { state } = await useMultiFileAuthState(config.sessionDir)
    const stored = loadCreds()
    if (stored) state.creds = stored

    // A device id carries a `:device` suffix, so only the phone part is compared.
    assertSessionOwner(state.creds.me?.id)
    hardenPermissions()

    return {
        state: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        saveCreds: async () => writeCreds(state.creds),
    }
}

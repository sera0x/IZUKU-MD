import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jidNormalizedUser, type LIDMapping, type WASocket } from 'baileys'
import { config } from '../config.ts'
import { jidToNumber } from './helpers.js'

/**
 * LID ↔ phone-number bridge.
 *
 * Baileys v7 delivers most senders as `@lid` JIDs. Some APIs (status read
 * receipts in particular) still expect the phone-number JID, so we keep a
 * small in-memory map that is seeded from:
 *
 *   1. the `lid-mapping-*.json` files in the auth folder,
 *   2. `lid-mapping.update` events from the live socket,
 *   3. alt JIDs (`participantAlt` / `remoteJidAlt`) on incoming messages.
 */

const lidToPhone = new Map<string, string>()
const phoneToLid = new Map<string, string>()

const authDirs = new Set<string>()
let lastReload = 0

const RELOAD_THROTTLE_MS = 30_000

function digits(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '')
}

function normalized(jid: string | null | undefined): string {
    if (!jid) return ''
    try {
        return jidNormalizedUser(jid) || ''
    } catch {
        return ''
    }
}

function addMapping(lid: string | null | undefined, phone: string | null | undefined): void {
    const lidDigits = digits(lid)
    const phoneDigits = digits(phone)
    if (!lidDigits || !phoneDigits) return

    lidToPhone.set(lidDigits, phoneDigits)
    phoneToLid.set(phoneDigits, lidDigits)
}

/**
 * Read every `lid-mapping-*.json` file written by Baileys and merge it into
 * the in-memory maps. Mappings are only added, never cleared, so a reload
 * cannot lose a pair learned from a live event.
 */
export function loadLidMappings(dir = config.sessionDir): void {
    authDirs.add(dir)
    if (!existsSync(dir)) return

    let files: string[]
    try {
        files = readdirSync(dir).filter((file) => file.startsWith('lid-mapping-') && file.endsWith('.json'))
    } catch {
        return
    }

    for (const file of files) {
        try {
            const value = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown
            if (typeof value !== 'string' && typeof value !== 'number') continue

            const key = file
                .replace('lid-mapping-', '')
                .replace('_reverse.json', '')
                .replace('.json', '')

            if (file.endsWith('_reverse.json')) {
                // lid-mapping-<lid>_reverse.json contains the phone number.
                addMapping(key, String(value))
            } else {
                // lid-mapping-<phone>.json contains the LID.
                addMapping(String(value), key)
            }
        } catch {
            // ignore malformed or partially-written files
        }
    }
}

/**
 * Load the on-disk mappings and subscribe to live updates for this socket.
 * Safe to call once per socket (reconnects create a new socket).
 */
export function attachLidMappings(sock: WASocket, dir = config.sessionDir): void {
    loadLidMappings(dir)

    try {
        sock.ev.on('lid-mapping.update', (mapping: LIDMapping) => {
            addMapping(mapping.lid, mapping.pn)
        })
    } catch {
        // older Baileys without the event
    }
}

function reloadFromDisk(): void {
    const now = Date.now()
    if (now - lastReload < RELOAD_THROTTLE_MS) return
    lastReload = now
    for (const dir of authDirs) loadLidMappings(dir)
}

function mappedPhone(jid: string): string {
    let phone = lidToPhone.get(digits(jidToNumber(jid)))
    if (!phone) {
        reloadFromDisk()
        phone = lidToPhone.get(digits(jidToNumber(jid)))
    }
    return phone ?? ''
}

/**
 * Synchronous phone-number digits for a JID. Returns an empty string when a
 * LID cannot be mapped yet.
 */
export function phoneDigitsFor(jid: string | null | undefined): string {
    const clean = normalized(jid) || (jid ?? '')
    if (!clean) return ''

    if (clean.endsWith('@s.whatsapp.net')) return jidToNumber(clean)
    if (clean.endsWith('@lid')) return mappedPhone(clean)
    return digits(jidToNumber(clean))
}

/**
 * Compare two JIDs as the same user even when one is a LID and the other a
 * phone-number JID. Falls back to raw digits when no mapping is known.
 */
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false

    const first = normalized(a) || a
    const second = normalized(b) || b
    if (first === second) return true

    const firstDigits = phoneDigitsFor(first)
    const secondDigits = phoneDigitsFor(second)
    if (firstDigits && secondDigits && firstDigits === secondDigits) return true

    return jidToNumber(first) === jidToNumber(second)
}

/**
 * Resolve any JID to a phone-number JID (`…@s.whatsapp.net`).
 * Asks the live socket first when the in-memory map has no answer.
 */
export async function phoneJidFor(sock: WASocket | undefined, jid: string | null | undefined): Promise<string> {
    const clean = normalized(jid) || (jid ?? '')
    if (!clean) return ''
    if (clean.endsWith('@s.whatsapp.net')) return clean
    if (!clean.endsWith('@lid')) return ''

    const cached = mappedPhone(clean)
    if (cached) return `${cached}@s.whatsapp.net`

    const mapped = await sock?.signalRepository?.lidMapping
        ?.getPNForLID(clean)
        .catch(() => null)
        .then((value) => normalized(value))

    if (mapped) {
        addMapping(clean, mapped)
        return mapped
    }

    return ''
}

/**
 * LID JID (`…@lid`) for a phone number, when the pair is already known.
 * Bans are stored per JID form, so callers need both directions.
 */
export function lidJidFor(jid: string | null | undefined): string {
    const number = digits(phoneDigitsFor(jid ?? '')) || digits(jidToNumber(jid ?? ''))
    if (!number) return ''

    let lid = phoneToLid.get(number)
    if (!lid) {
        reloadFromDisk()
        lid = phoneToLid.get(number)
    }

    return lid ? `${lid}@lid` : ''
}

/**
 * Learn a LID ↔ phone pair from an incoming message. Many status/group
 * messages carry both forms in `participantAlt` / `remoteJidAlt`.
 */
export function rememberIdentityPair(a: string | null | undefined, b: string | null | undefined): void {
    const first = normalized(a)
    const second = normalized(b)
    if (!first || !second) return

    if (first.endsWith('@lid') && second.endsWith('@s.whatsapp.net')) addMapping(first, second)
    else if (second.endsWith('@lid') && first.endsWith('@s.whatsapp.net')) addMapping(second, first)
}

/** Exposed for diagnostics and tests. */
export function lidMappingSize(): { lids: number; phones: number } {
    return { lids: lidToPhone.size, phones: phoneToLid.size }
}

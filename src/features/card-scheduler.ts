import type { GroupMetadata, WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { isGroupAdmin } from '../bot/group-utils.js'
import {
    CARDS,
    cardArt,
    cardDropCaption,
    cardMedia,
    clearDrop,
    forceDrop,
    isHighTierCard,
    pickFreshCard,
    randomCardForDrop,
} from './tcg.js'

const log = createLogger(config.logLevel, { scope: 'cards' })

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TICK_MS = 30_000
/** A slot stays open briefly so a restart or a slow tick does not skip a group. */
const SLOT_WINDOW_MS = 2 * 60 * 1000
const HIGH_TIER_WINDOW_MS = 2 * 60 * 1000
const GROUP_CACHE_MS = 5 * 60 * 1000
const SETTING_PREFIX = 'TCG_HOURLY_LAST:'
const HIGH_TIER_STATE_KEY = 'TCG_HIGH_TIER_STATE'
/** Automatic high-tier drops are a rare event: twice per day, globally. */
const HIGH_TIER_PER_DAY = 2

export interface DueDrop {
    jid: string
    /** Hour bucket (epoch hours) the slot belongs to. */
    slotHour: number
}

export interface DueHighTierEvent {
    day: number
    index: number
    minute: number
}

export interface SentDrop {
    jid: string
    highTier: boolean
}

function stableHash(value: string): number {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Stable per-group offset inside the hour. Groups therefore do not all receive
 * their card at the same moment: each one gets its own second-of-hour slot.
 */
export function hourlyOffsetSeconds(jid: string): number {
    return stableHash(jid) % 3600
}

/**
 * Two random minute-of-day slots for high-tier drops. The schedule is stable
 * for a given day (so restarts cannot create extra drops) but varies each day.
 */
export function highTierMinutes(day: number): number[] {
    const random = mulberry32(stableHash(`high-tier:${day}`))
    // Stop before the last ten minutes of the day so the two-minute delivery
    // window never crosses midnight (which would belong to the next schedule).
    const slots = 1431
    const first = Math.floor(random() * slots)
    // Keep the two drops several hours apart in both directions around the
    // clock, so a wrap-around cannot put them next to each other.
    const gap = 240 + Math.floor(random() * (slots - 480))
    const second = (first + gap) % slots
    return [first, second].sort((a, b) => a - b)
}

/**
 * Pick the admin groups whose hourly slot is currently open and which have not
 * already received a card for that hour. The last-drop lookup is injectable so
 * tests (and a future database backend) can control it.
 */
export function dueHourlyDrops(
    groups: Record<string, GroupMetadata>,
    botJids: string[],
    now: number,
    lastDropHour: (jid: string) => number | undefined,
    windowMs = SLOT_WINDOW_MS,
): DueDrop[] {
    const due: DueDrop[] = []

    for (const [jid, metadata] of Object.entries(groups)) {
        if (!isGroupAdmin(metadata, botJids)) continue

        const offsetMs = hourlyOffsetSeconds(jid) * 1000
        const slotHour = Math.floor((now - offsetMs) / HOUR_MS)
        const slotStart = slotHour * HOUR_MS + offsetMs
        if (now < slotStart || now - slotStart >= windowMs) continue

        const last = lastDropHour(jid)
        if (last !== undefined && last >= slotHour) continue

        due.push({ jid, slotHour })
    }

    return due
}

/** The high-tier event that is due right now, if any. */
export function dueHighTierEvent(
    now: number,
    sent: number[],
    windowMs = HIGH_TIER_WINDOW_MS,
): DueHighTierEvent | undefined {
    const day = Math.floor(now / DAY_MS)
    const startOfDay = day * DAY_MS

    for (const [index, minute] of highTierMinutes(day).entries()) {
        if (sent.includes(index)) continue
        const start = startOfDay + minute * 60_000
        if (now >= start && now < start + windowMs) return { day, index, minute }
    }

    return undefined
}

function adminGroupJids(groups: Record<string, GroupMetadata>, botJids: string[]): string[] {
    return Object.entries(groups)
        .filter(([, metadata]) => isGroupAdmin(metadata, botJids))
        .map(([jid]) => jid)
}

export interface CardTickDeps {
    now: () => number
    fetchGroups: (sock: WASocket) => Promise<Record<string, GroupMetadata>>
    sendDrop: (sock: WASocket, chat: string, highTier: boolean) => Promise<void>
    lastDropHour: (jid: string) => number | undefined
    markDropHour: (jid: string, slotHour: number) => void
    highTierSent: (day: number) => number[]
    markHighTierSent: (day: number, index: number) => void
    windowMs?: number
    highTierWindowMs?: number
}

/** One scheduler pass, separated from timers so it can be tested directly. */
export async function runHourlyCardTick(sock: WASocket, deps: CardTickDeps): Promise<SentDrop[]> {
    const now = deps.now()
    const groups = await deps.fetchGroups(sock)
    const botJids = [sock.user?.id, sock.user?.lid].filter(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )
    const sent: SentDrop[] = []

    for (const drop of dueHourlyDrops(groups, botJids, now, deps.lastDropHour, deps.windowMs)) {
        // .agb kill removes the game from that group: no scheduled drops either
        if (!db.cardsActive(drop.jid)) continue
        try {
            await deps.sendDrop(sock, drop.jid, false)
            deps.markDropHour(drop.jid, drop.slotHour)
            sent.push({ jid: drop.jid, highTier: false })
        } catch (error) {
            log.warn('hourly card drop failed in %s: %s', drop.jid, (error as Error).message)
        }
    }

    const day = Math.floor(now / DAY_MS)
    const event = dueHighTierEvent(now, deps.highTierSent(day), deps.highTierWindowMs)
    if (event) {
        // High-tier drops only land in groups whose .agb live window includes --ht
        const admins = adminGroupJids(groups, botJids).filter((jid) => db.highTierUntil(jid))
        const target = admins[Math.floor(Math.random() * admins.length)]
        if (target) {
            try {
                await deps.sendDrop(sock, target, true)
                deps.markHighTierSent(event.day, event.index)
                sent.push({ jid: target, highTier: true })
                log.info('high-tier card %d/%d sent to %s', event.index + 1, HIGH_TIER_PER_DAY, target)
            } catch (error) {
                log.warn('high-tier card drop failed in %s: %s', target, (error as Error).message)
            }
        }
    }

    return sent
}

async function sendCardDrop(sock: WASocket, chat: string, highTier: boolean): Promise<void> {
    // Same chat should not keep seeing the same card on its next slot.
    const bucket = CARDS.filter((entry) => isHighTierCard(entry) === highTier)
    const card = bucket.length ? pickFreshCard(chat, bucket) : randomCardForDrop(highTier)
    const caption = cardDropCaption(card, config.prefix)
    forceDrop(chat, card)

    try {
        await sock.sendMessage(chat, cardMedia(await cardArt(card), caption))
    } catch (error) {
        log.debug('card art failed for %s: %s', card.id, (error as Error).message)
        try {
            await sock.sendMessage(chat, { text: caption })
        } catch (fallbackError) {
            clearDrop(chat)
            throw fallbackError
        }
    }
}

// ── Persistent per-group state ────────────────────────────────────────────────

const lastHours = new Map<string, number>()
let stateLoaded = false

function loadState(): void {
    if (stateLoaded) return
    stateLoaded = true

    for (const setting of db.settings()) {
        if (!setting.key.startsWith(SETTING_PREFIX)) continue
        const jid = setting.key.slice(SETTING_PREFIX.length)
        const hour = Number.parseInt(setting.value, 10)
        if (jid && Number.isFinite(hour)) lastHours.set(jid, hour)
    }
}

function lastDropHour(jid: string): number | undefined {
    loadState()
    return lastHours.get(jid)
}

function markDropHour(jid: string, slotHour: number): void {
    loadState()
    lastHours.set(jid, slotHour)
    try {
        db.setSetting(`${SETTING_PREFIX}${jid}`, String(slotHour))
    } catch (error) {
        log.warn('could not persist hourly card slot for %s: %s', jid, (error as Error).message)
    }
}

interface HighTierState {
    day: number
    sent: number[]
}

let highTierState: HighTierState | null = null
let highTierLoaded = false

function loadHighTierState(): void {
    if (highTierLoaded) return
    highTierLoaded = true

    const setting = db.settings().find((entry) => entry.key === HIGH_TIER_STATE_KEY)
    if (!setting) return

    try {
        const parsed = JSON.parse(setting.value) as { day?: unknown; sent?: unknown }
        if (typeof parsed.day !== 'number' || !Array.isArray(parsed.sent)) return
        highTierState = {
            day: parsed.day,
            sent: parsed.sent.filter((value): value is number => typeof value === 'number'),
        }
    } catch {
        // Ignore a corrupt state row; a fresh schedule is safer than crashing.
    }
}

function persistHighTierState(): void {
    if (!highTierState) return
    try {
        db.setSetting(HIGH_TIER_STATE_KEY, JSON.stringify(highTierState))
    } catch (error) {
        log.warn('could not persist high-tier card state: %s', (error as Error).message)
    }
}

function highTierSent(day: number): number[] {
    loadHighTierState()
    if (!highTierState || highTierState.day !== day) {
        highTierState = { day, sent: [] }
        persistHighTierState()
    }
    return [...highTierState.sent]
}

function markHighTierSent(day: number, index: number): void {
    loadHighTierState()
    if (!highTierState || highTierState.day !== day) {
        highTierState = { day, sent: [] }
    }
    if (!highTierState.sent.includes(index)) highTierState.sent.push(index)
    persistHighTierState()
}

// ── Group discovery ───────────────────────────────────────────────────────────

let groupCache: { at: number; groups: Record<string, GroupMetadata> } | null = null

async function fetchGroups(sock: WASocket): Promise<Record<string, GroupMetadata>> {
    if (groupCache && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache.groups

    const groups = await sock.groupFetchAllParticipating()
    groupCache = { at: Date.now(), groups }
    return groups
}

// ── Timer lifecycle ───────────────────────────────────────────────────────────

let socket: WASocket | null = null
let timer: ReturnType<typeof setInterval> | null = null
let firstTick: ReturnType<typeof setTimeout> | null = null
let ticking = false
let lastTickError = ''

async function tick(): Promise<void> {
    if (ticking || !socket || !config.tcg.hourlySpawns) return
    ticking = true
    try {
        await runHourlyCardTick(socket, {
            now: Date.now,
            fetchGroups,
            sendDrop: sendCardDrop,
            lastDropHour,
            markDropHour,
            highTierSent,
            markHighTierSent,
        })
        lastTickError = ''
    } catch (error) {
        const message = (error as Error).message
        // Log a failure once instead of every 30 seconds; a successful tick
        // clears it so a later outage is reported again.
        if (message !== lastTickError) {
            lastTickError = message
            log.warn('hourly card tick failed: %s', message)
        }
    } finally {
        ticking = false
    }
}

export function startCardScheduler(sock: WASocket): void {
    if (!config.tcg.hourlySpawns) return

    socket = sock
    if (timer) return

    // Give the socket a moment to finish its post-connect sync before asking
    // for the participating-group list.
    firstTick = setTimeout(() => void tick(), 5_000)
    firstTick.unref?.()
    timer = setInterval(() => void tick(), TICK_MS)
    timer.unref?.()
    log.info('hourly card scheduler started (admin groups only)')
}

export function stopCardScheduler(): void {
    if (firstTick) clearTimeout(firstTick)
    if (timer) clearInterval(timer)
    firstTick = null
    timer = null
    socket = null
    groupCache = null
    ticking = false
    lastTickError = ''
}

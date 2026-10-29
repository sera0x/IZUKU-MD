import type { GroupMetadata, WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { isGroupAdmin } from '../bot/group-utils.js'
import { activeSpawn, fetchArt, fetchPokemon, randomDexId, setSpawn, titleName } from './pokemon.js'

const log = createLogger(config.logLevel, { scope: 'pokemon' })

const HOUR_MS = 60 * 60 * 1000
const TICK_MS = 60_000
const GROUP_CACHE_MS = 5 * 60 * 1000
const SETTING_PREFIX = 'POKE_HOURLY_LAST:'

/** Stable per-group offset inside the hour, so groups do not all spawn together. */
function offsetMs(jid: string): number {
    let hash = 2166136261
    for (let index = 0; index < jid.length; index += 1) {
        hash ^= jid.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0) % HOUR_MS
}

const lastHours = new Map<string, number>()
let stateLoaded = false

function loadState(): void {
    if (stateLoaded) return
    stateLoaded = true
    try {
        for (const setting of db.settings()) {
            if (!setting.key.startsWith(SETTING_PREFIX)) continue
            const jid = setting.key.slice(SETTING_PREFIX.length)
            const hour = Number.parseInt(setting.value, 10)
            if (jid && Number.isFinite(hour)) lastHours.set(jid, hour)
        }
    } catch {
        // A corrupt row only costs one extra spawn.
    }
}

const lastHour = (jid: string): number | undefined => {
    loadState()
    return lastHours.get(jid)
}

function markHour(jid: string, hour: number): void {
    loadState()
    lastHours.set(jid, hour)
    try {
        db.setSetting(`${SETTING_PREFIX}${jid}`, String(hour))
    } catch (error) {
        log.warn('could not persist pokemon slot for %s: %s', jid, (error as Error).message)
    }
}

/** Groups whose hourly slot is open right now. */
export function duePokeSpawns(
    groups: Record<string, GroupMetadata>,
    botJids: string[],
    now: number,
    windowMs = 2 * 60 * 1000,
): Array<{ jid: string; slotHour: number }> {
    const due: Array<{ jid: string; slotHour: number }> = []

    for (const [jid, metadata] of Object.entries(groups)) {
        if (!isGroupAdmin(metadata, botJids)) continue
        if (!db.gameActive(jid) || !db.pokeEnabled(jid)) continue

        const offset = offsetMs(jid)
        const slotHour = Math.floor((now - offset) / HOUR_MS)
        const slotStart = slotHour * HOUR_MS + offset
        if (now < slotStart || now - slotStart >= windowMs) continue

        const last = lastHour(jid)
        if (last !== undefined && last >= slotHour) continue

        due.push({ jid, slotHour })
    }

    return due
}

export async function sendWildSpawn(sock: WASocket, chat: string): Promise<boolean> {
    if (activeSpawn(chat)) return false

    let poke = null
    for (let attempt = 0; attempt < 3 && !poke; attempt += 1) {
        poke = await fetchPokemon(randomDexId())
    }
    if (!poke) return false

    setSpawn(chat, poke)
    const art = await fetchArt(poke.imageUrl)
    const caption = [
        `🐾 A wild *${titleName(poke.name)}* appeared!`,
        `🎯 Rarity *${poke.rarity}* \u00b7 \u26A1 Power *${poke.power}*`,
        `\u23F0 ${timeOfDay(new Date())}`,
        '',
        `Use *${config.prefix}catch ${poke.name}* to catch it!`,
    ].join('\n')

    if (art) await sock.sendMessage(chat, { image: art, caption })
    else await sock.sendMessage(chat, { text: caption })
    return true
}

let socket: WASocket | null = null
let timer: ReturnType<typeof setInterval> | null = null
let firstTick: ReturnType<typeof setTimeout> | null = null
let groupCache: { at: number; groups: Record<string, GroupMetadata> } | null = null
let ticking = false

async function groups(sock: WASocket): Promise<Record<string, GroupMetadata>> {
    if (groupCache && Date.now() - groupCache.at < GROUP_CACHE_MS) return groupCache.groups
    const fetched = await sock.groupFetchAllParticipating()
    groupCache = { at: Date.now(), groups: fetched }
    return fetched
}

async function tick(): Promise<void> {
    if (ticking || !socket) return
    ticking = true
    try {
        const list = await groups(socket)
        const botJids = [socket.user?.id, socket.user?.lid].filter(
            (jid): jid is string => typeof jid === 'string' && jid.length > 0,
        )
        for (const due of duePokeSpawns(list, botJids, Date.now())) {
            try {
                const sent = await sendWildSpawn(socket, due.jid)
                markHour(due.jid, due.slotHour)
                if (sent) log.info('hourly wild pokemon spawned in %s', due.jid)
            } catch (error) {
                log.warn('hourly pokemon spawn failed in %s: %s', due.jid, (error as Error).message)
            }
        }
    } catch (error) {
        log.warn('pokemon tick failed: %s', (error as Error).message)
    } finally {
        ticking = false
    }
}

export function startPokeScheduler(sock: WASocket): void {
    socket = sock
    if (timer) return
    firstTick = setTimeout(() => void tick(), 20_000)
    firstTick.unref?.()
    timer = setInterval(() => void tick(), TICK_MS)
    timer.unref?.()
    log.info('hourly pokemon scheduler started')
}

export function stopPokeScheduler(): void {
    if (firstTick) clearTimeout(firstTick)
    if (timer) clearInterval(timer)
    firstTick = null
    timer = null
    socket = null
    groupCache = null
    ticking = false
}


/** Time-of-day bucket for spawn flavor. */
export function timeOfDay(d = new Date()): string {
    const h = d.getHours()
    if (h < 5) return 'late night'
    if (h < 12) return 'morning'
    if (h < 17) return 'afternoon'
    if (h < 21) return 'evening'
    return 'night'
}

/** Weekly featured type, rotates by ISO week number. */

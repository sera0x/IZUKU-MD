import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { db } from '../db/index.js'
import { toMp4 } from '../bot/helpers.js'
import { backupCardArt } from './card-backup.js'

/**
 * shoob.gg-style anime card game.
 *
 * Cards are text-only (no artwork is fetched), so the whole game works without
 * external services: a card drops in a group every N messages, the first person
 * to `.claim` it keeps it, and `.pull` hands out one free card per day.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface Card {
    id: string
    name: string
    series: string
    rarity: Rarity
    emoji: string
    power: number
    quote: string
    /** shoob tier (1-6 or S) when the card came from the imported catalog. */
    tier?: string
    /** Rendered card image, fetched once and then cached on disk. */
    image?: string
}

export interface ShoobRecord {
    id: string
    name: string
    series: string
    tier: string
}

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary']

export const RARITY_WEIGHT: Record<Rarity, number> = {
    common: 55,
    rare: 28,
    epic: 12,
    legendary: 5,
}

export const RARITY_STYLE: Record<Rarity, { dot: string; label: string }> = {
    common: { dot: '⚪', label: 'Common' },
    rare: { dot: '🔵', label: 'Rare' },
    epic: { dot: '🟣', label: 'Epic' },
    legendary: { dot: '🟡', label: 'Legendary' },
}

const card = (
    id: string,
    name: string,
    series: string,
    rarity: Rarity,
    emoji: string,
    power: number,
    quote: string,
): Card => ({ id, name, series, rarity, emoji, power, quote })

const BUILT_IN_CARDS: Card[] = [
    // Naruto
    card('naruto-uzumaki', 'Naruto Uzumaki', 'Naruto', 'legendary', '🦊', 980, 'I never go back on my word.'),
    card('sasuke-uchiha', 'Sasuke Uchiha', 'Naruto', 'epic', '⚡', 900, 'I will revive my clan.'),
    card('sakura-haruno', 'Sakura Haruno', 'Naruto', 'rare', '🌸', 710, 'I will protect them both.'),
    card('kakashi-hatake', 'Kakashi Hatake', 'Naruto', 'epic', '📖', 880, 'Those who abandon their friends are worse than scum.'),
    card('itachi-uchiha', 'Itachi Uchiha', 'Naruto', 'legendary', '🌙', 960, 'Forgive me, Sasuke.'),
    card('hinata-hyuga', 'Hinata Hyuga', 'Naruto', 'rare', '💜', 700, 'I will never give up.'),
    // One Piece
    card('monkey-d-luffy', 'Monkey D. Luffy', 'One Piece', 'legendary', '🏴‍☠️', 990, 'I am going to be King of the Pirates.'),
    card('roronoa-zoro', 'Roronoa Zoro', 'One Piece', 'epic', '🗡️', 910, 'Nothing happened.'),
    card('nami', 'Nami', 'One Piece', 'rare', '🍊', 690, 'Money is everything.'),
    card('sanji', 'Sanji', 'One Piece', 'rare', '🍳', 720, 'A cook never lets anyone go hungry.'),
    card('portgas-d-ace', 'Portgas D. Ace', 'One Piece', 'epic', '🔥', 890, 'Thank you for loving me.'),
    // Demon Slayer
    card('tanjiro-kamado', 'Tanjiro Kamado', 'Demon Slayer', 'epic', '💧', 870, 'I will not let anyone else die.'),
    card('nezuko-kamado', 'Nezuko Kamado', 'Demon Slayer', 'rare', '🎋', 730, 'Mmh!'),
    card('zenitsu-agatsuma', 'Zenitsu Agatsuma', 'Demon Slayer', 'rare', '⚡', 700, 'I am the thunder.'),
    card('inosuke-hashibira', 'Inosuke Hashibira', 'Demon Slayer', 'common', '🐗', 620, 'Fight me!'),
    card('muzan-kibutsuji', 'Muzan Kibutsuji', 'Demon Slayer', 'legendary', '🩸', 970, 'I am the progenitor.'),
    // Jujutsu Kaisen
    card('yuji-itadori', 'Yuji Itadori', 'Jujutsu Kaisen', 'rare', '👊', 740, 'I will save people.'),
    card('megumi-fushiguro', 'Megumi Fushiguro', 'Jujutsu Kaisen', 'rare', '🌑', 760, 'With this treasure I summon.'),
    card('nobara-kugisaki', 'Nobara Kugisaki', 'Jujutsu Kaisen', 'common', '🔨', 640, 'I love myself when I am beautiful and strong.'),
    card('satoru-gojo', 'Satoru Gojo', 'Jujutsu Kaisen', 'legendary', '🌀', 1000, 'Throughout heaven and earth, I alone am the honored one.'),
    card('ryomen-sukuna', 'Ryomen Sukuna', 'Jujutsu Kaisen', 'legendary', '👑', 995, 'Know your place, fool.'),
    // Attack on Titan
    card('eren-yeager', 'Eren Yeager', 'Attack on Titan', 'legendary', '🕊️', 950, 'I keep moving forward.'),
    card('mikasa-ackerman', 'Mikasa Ackerman', 'Attack on Titan', 'epic', '🧣', 890, 'This world is cruel, but also beautiful.'),
    card('levi-ackerman', 'Levi Ackerman', 'Attack on Titan', 'legendary', '⚔️', 975, 'No regrets.'),
    card('armin-arlert', 'Armin Arlert', 'Attack on Titan', 'rare', '🌊', 720, 'I want to see the sea.'),
    // My Hero Academia
    card('izuku-midoriya', 'Izuku Midoriya', 'My Hero Academia', 'epic', '💚', 860, 'I want to be a hero who saves everyone.'),
    card('katsuki-bakugo', 'Katsuki Bakugo', 'My Hero Academia', 'epic', '💥', 880, 'I will be number one.'),
    card('shoto-todoroki', 'Shoto Todoroki', 'My Hero Academia', 'rare', '❄️', 800, 'I will become a hero on my own terms.'),
    card('all-might', 'All Might', 'My Hero Academia', 'legendary', '💪', 985, 'I am here!'),
    // Fullmetal Alchemist
    card('edward-elric', 'Edward Elric', 'Fullmetal Alchemist', 'epic', '⚙️', 870, 'A lesson without pain is meaningless.'),
    card('alphonse-elric', 'Alphonse Elric', 'Fullmetal Alchemist', 'rare', '🛡️', 750, 'I will get my body back.'),
    card('roy-mustang', 'Roy Mustang', 'Fullmetal Alchemist', 'epic', '🔥', 890, 'I will burn this country down.'),
    // Death Note
    card('light-yagami', 'Light Yagami', 'Death Note', 'legendary', '📓', 940, 'I am justice.'),
    card('l-lawliet', 'L Lawliet', 'Death Note', 'epic', '🍬', 920, 'I am L.'),
    card('misa-amane', 'Misa Amane', 'Death Note', 'common', '🖤', 600, 'I would do anything for Light.'),
    // Chainsaw Man
    card('denji', 'Denji', 'Chainsaw Man', 'rare', '🪚', 780, 'I just want a normal life.'),
    card('makima', 'Makima', 'Chainsaw Man', 'legendary', '🎯', 965, 'Dogs do not disobey.'),
    card('power', 'Power', 'Chainsaw Man', 'rare', '🩸', 760, 'I am the Blood Devil.'),
    // Hunter x Hunter
    card('gon-freecss', 'Gon Freecss', 'Hunter x Hunter', 'rare', '🎣', 790, 'I will find my dad.'),
    card('killua-zoldyck', 'Killua Zoldyck', 'Hunter x Hunter', 'epic', '⚡', 900, 'I will protect Gon.'),
    card('hisoka', 'Hisoka Morow', 'Hunter x Hunter', 'epic', '🍃', 930, 'Oh my, you are interesting.'),
    // Bleach
    card('ichigo-kurosaki', 'Ichigo Kurosaki', 'Bleach', 'epic', '🌑', 890, 'I will protect everyone.'),
    card('rukiya-kuchiki', 'Rukia Kuchiki', 'Bleach', 'rare', '❄️', 740, 'Do you fear death?'),
    // Dragon Ball
    card('goku', 'Son Goku', 'Dragon Ball', 'legendary', '🐉', 1000, 'I am the hope of the universe.'),
    card('vegeta', 'Vegeta', 'Dragon Ball', 'epic', '💥', 950, 'I am the prince of all Saiyans.'),
    card('bulma', 'Bulma', 'Dragon Ball', 'common', '🔧', 580, 'I am the smartest person on Earth.'),
    // Spy x Family
    card('anya-forger', 'Anya Forger', 'Spy x Family', 'rare', '🥜', 720, 'Waku waku!'),
    card('yor-forger', 'Yor Forger', 'Spy x Family', 'epic', '🩷', 880, 'For the mission.'),
    card('loid-forger', 'Loid Forger', 'Spy x Family', 'rare', '🎩', 810, 'For world peace.'),
]

const TIER_RARITY: Record<string, Rarity> = {
    '1': 'common',
    '2': 'common',
    '3': 'rare',
    '4': 'rare',
    '5': 'epic',
    '6': 'legendary',
    S: 'legendary',
}

const TIER_POWER: Record<string, number> = {
    '1': 500,
    '2': 600,
    '3': 700,
    '4': 800,
    '5': 900,
    '6': 950,
    S: 1000,
}

export const rarityForTier = (tier: string): Rarity => TIER_RARITY[tier.trim().toUpperCase()] ?? 'common'

const powerJitter = (id: string): number => {
    let hash = 0
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 97
    return hash % 30
}

const recordToCard = (record: ShoobRecord): Card => {
    const tier = String(record.tier ?? '')
    return {
        id: record.id,
        name: record.name,
        series: record.series || 'Unknown',
        rarity: rarityForTier(tier),
        emoji: '🎴',
        power: (TIER_POWER[tier.toUpperCase()] ?? 500) + powerJitter(record.id),
        quote: '',
        tier,
        image: `https://api.shoob.gg/site/api/cardr/${record.id}?size=400`,
    }
}

/**
 * Load the imported shoob.gg catalog when `data/shoob-cards.json` exists,
 * otherwise keep the built-in offline set. Tests point SHOOB_CARDS_PATH at a
 * missing file so their expectations never depend on the live catalog.
 */
export function loadShoobCatalog(path = process.env.SHOOB_CARDS_PATH ?? 'data/shoob-cards.json'): Card[] {
    try {
        if (!existsSync(path)) return []
        const records = JSON.parse(readFileSync(path, 'utf8')) as ShoobRecord[]
        if (!Array.isArray(records) || records.length === 0) return []

        return records.filter((record) => record?.id && record?.name).map(recordToCard)
    } catch {
        return []
    }
}

const shoobCatalog = loadShoobCatalog()

/** Active catalog: the imported shoob set when present, else the built-ins. */
export const CARDS: Card[] = [...(shoobCatalog.length > 0 ? shoobCatalog : BUILT_IN_CARDS)]
export let USING_SHOOB_CATALOG = shoobCatalog.length > 0

export const CARD_BY_ID = new Map(CARDS.map((entry) => [entry.id, entry]))
export const CARD_BY_NAME = new Map(CARDS.map((entry) => [entry.name.toLowerCase(), entry]))

function applyCatalog(next: Card[], usingShoob: boolean): void {
    CARDS.splice(0, CARDS.length, ...next)
    CARD_BY_ID.clear()
    CARD_BY_NAME.clear()
    for (const entry of CARDS) {
        CARD_BY_ID.set(entry.id, entry)
        CARD_BY_NAME.set(entry.name.toLowerCase(), entry)
    }
    USING_SHOOB_CATALOG = usingShoob
}

const CATALOG_SOURCE = process.env.SHOOB_CATALOG_URL ?? 'https://api.shoob.gg/site/api/cardlist?page=1'
const CATALOG_PATH = process.env.SHOOB_CARDS_PATH ?? 'data/shoob-cards.json'
const CATALOG_REFRESH_MS = (() => {
    const hours = Number(process.env.SHOOB_REFRESH_HOURS ?? 6)
    return (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60 * 1000
})()

const TIER_RANK: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, S: 7 }

/** Numeric weight for a tier label, so "S" ranks above T6 and junk ranks 0. */
export const tierRank = (tier: string | undefined): number => TIER_RANK[String(tier ?? '').trim().toUpperCase()] ?? 0

function normalizeShoobRecords(raw: unknown): ShoobRecord[] {
    if (!Array.isArray(raw)) throw new Error('card list response was not an array')

    // shoob keeps patched and re-released copies of the same card. Keep one per
    // card id (copies with the same id collapse), but always the highest-tier release: dropping that in favour
    // of whichever copy the API happened to list first made tier searches miss
    // cards that do exist (e.g. a T4 re-release listed after the original T1).
    const best = new Map<string, ShoobRecord>()

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const row = entry as Record<string, unknown>
        const id = typeof row._id === 'string' ? row._id.trim() : ''
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        const tier = row.tier === undefined || row.tier === null ? '' : String(row.tier).trim()
        const series =
            Array.isArray(row.category) && typeof row.category[0] === 'string'
                ? row.category[0].trim()
                : 'Unknown'

        if (!id || !name) continue

        // Key by card id: every release/copy of a card stays spawnable.
        const key = id
        const current = best.get(key)
        if (!current || tierRank(tier) > tierRank(current.tier)) {
            best.set(key, { id, name, series, tier })
        }
    }

    return [...best.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Fetch the latest shoob.gg catalog, save it atomically, and swap the live
 * card maps. The bot calls this at startup and on a timer so newly released
 * cards become available without a redeploy.
 *
 * The file mtime is used as the refresh clock: a fresh catalog is a no-op
 * unless `force` is true.
 */
export async function refreshShoobCatalog(force = false): Promise<number> {
    if (!force && existsSync(CATALOG_PATH)) {
        try {
            const age = Date.now() - statSync(CATALOG_PATH).mtimeMs
            if (age < CATALOG_REFRESH_MS) return CARDS.length
        } catch {
            // Unreadable stat should not prevent a refresh attempt.
        }
    }

    const response = await fetch(CATALOG_SOURCE, {
        headers: { 'user-agent': 'IZUKU-MD shoob importer', accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
        throw new Error(`card list request failed: ${response.status} ${response.statusText}`)
    }

    const records = normalizeShoobRecords(await response.json())
    if (records.length === 0) throw new Error('card list returned no usable cards')

    mkdirSync(dirname(CATALOG_PATH), { recursive: true })
    const temporary = `${CATALOG_PATH}.tmp`
    writeFileSync(temporary, JSON.stringify(records))
    renameSync(temporary, CATALOG_PATH)

    applyCatalog(records.map(recordToCard), true)
    return CARDS.length
}

let refreshInFlight: Promise<number> | null = null

/**
 * Refresh the catalog in the background if it is older than the refresh
 * window. Never blocks the caller: a 21MB download must not stall a command.
 * A no-op when no catalog file is configured (the offline/test setup).
 */
export function refreshCatalogSoon(): void {
    if (!existsSync(CATALOG_PATH)) return
    if (refreshInFlight) return
    refreshInFlight = refreshShoobCatalog()
        .catch(() => 0)
        .finally(() => {
            refreshInFlight = null
        })
}

/**
 * Blocking refresh, used only when the loaded catalog cannot answer a search.
 * Skipped when the file is younger than `minAgeMs` so repeated misses do not
 * hammer the API.
 */
export async function refreshCatalogNow(minAgeMs = 10 * 60 * 1000): Promise<boolean> {
    if (process.env.SHOOB_LIVE === '0' || !existsSync(CATALOG_PATH)) return false

    try {
        const age = Date.now() - statSync(CATALOG_PATH).mtimeMs
        if (age < minAgeMs) return false
    } catch {
        return false
    }

    try {
        refreshInFlight = refreshShoobCatalog(true)
        await refreshInFlight
        return true
    } catch {
        return false
    } finally {
        refreshInFlight = null
    }
}

const NAME_WORDS = /[^a-z0-9]+/

/** True when a card name has a word starting with `needle`. */
const nameHasWord = (entry: Card, needle: string): boolean =>
    entry.name
        .toLowerCase()
        .split(NAME_WORDS)
        .some((word) => word.startsWith(needle))

/**
 * Every card matching a query, ranked so a short query is not swallowed by a
 * longer unrelated name: `.spawn izuku` used to return "Hasei Shizuku" because
 * "izuku" is a substring of "shizuku", and one arbitrary hit then made every
 * tier filter fail on cards that do exist.
 *
 * Order of attempts:
 *   1. card id or exact name,
 *   2. every word of the query inside one name ("deku bakugo shoto"),
 *   3. a name word starting with the query ("izuku" -> "Izuku Midoriya"),
 *   4. a substring sweep, only for queries of 3+ characters,
 *   5. an exact series name,
 *   6. each part of an "x"/","/"|" list on its own.
 */
export function findCards(query: string, limit = 200): Card[] {
    const raw = query.trim()
    if (!raw) return []

    const needle = raw.replace(/\s+/g, ' ').toLowerCase()

    const byId = CARD_BY_ID.get(needle.replace(/\s+/g, '-')) ?? CARD_BY_ID.get(needle)
    if (byId) return [byId]
    const exact = CARD_BY_NAME.get(needle)
    if (exact) return [exact]

    const listParts = raw
        .split(/\s+[xX]\s+|\s*[,|]\s*/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
    const words = needle.split(' ').filter(Boolean)
    const all = listParts.length > 1 ? listParts : words

    // Every part in one card name, in any order.
    if (all.length > 1) {
        const combined = CARDS.filter((entry) => {
            const name = entry.name.toLowerCase()
            return all.every((part) => name.includes(part))
        })
        if (combined.length) return combined.slice(0, limit)
    }

    const prefixed = CARDS.filter((entry) => nameHasWord(entry, needle))
    if (prefixed.length) return prefixed.slice(0, limit)

    if (needle.length >= 3) {
        const substring = CARDS.filter((entry) => entry.name.toLowerCase().includes(needle))
        if (substring.length) return substring.slice(0, limit)
    }

    const bySeries = CARDS.filter((entry) => entry.series.toLowerCase() === needle)
    if (bySeries.length) return bySeries.slice(0, limit)

    if (all.length > 1) {
        const seen = new Set<string>()
        const matches: Card[] = []
        for (const part of all) {
            for (const card of CARDS.filter((entry) => nameHasWord(entry, part))) {
                if (seen.has(card.id)) continue
                seen.add(card.id)
                matches.push(card)
                if (matches.length >= limit) return matches
            }
        }
        return matches
    }

    return []
}

export const findCard = (query: string): Card | undefined => findCards(query, 1)[0]

function weightedRarity(roll = Math.random()): Rarity {
    const total = RARITY_ORDER.reduce((sum, rarity) => sum + RARITY_WEIGHT[rarity], 0)
    let point = roll * total
    for (const rarity of RARITY_ORDER) {
        point -= RARITY_WEIGHT[rarity]
        if (point <= 0) return rarity
    }
    return 'common'
}

export function randomCard(roll = Math.random()): Card {
    const rarity = weightedRarity(roll)
    const bucket = CARDS.filter((entry) => entry.rarity === rarity)
    const picked = bucket[Math.floor(Math.random() * bucket.length)] ?? bucket[0] ?? CARDS[0]
    if (!picked) throw new Error('shoob card catalog is empty')
    return picked
}

/**
 * Random card for a shoob tier. Imported cards carry an exact tier; the
 * built-in offline catalog has no tiers, so it falls back to that tier's
 * rarity bucket.
 */
export function randomCardForTier(tier: string): Card | undefined {
    const wanted = tier.trim().toUpperCase()
    if (!wanted) return undefined

    const exact = CARDS.filter((entry) => (entry.tier ?? '').toUpperCase() === wanted)
    const bucket = exact.length
        ? exact
        : CARDS.filter((entry) => entry.rarity === rarityForTier(wanted))

    if (!bucket.length) return undefined
    return bucket[Math.floor(Math.random() * bucket.length)]
}

/** Tier 5, 6 and S are the rare "high tier" cards. */
export const HIGH_TIERS = new Set(['5', '6', 'S'])

export function isHighTierCard(card: Card): boolean {
    const tier = (card.tier ?? '').trim().toUpperCase()
    if (tier) return HIGH_TIERS.has(tier)
    return card.rarity === 'epic' || card.rarity === 'legendary'
}

/**
 * Pick an automatic drop card. High-tier cards are only handed out by the
 * twice-daily special event; normal drops stay below that tier.
 */
export function randomCardForDrop(highTier: boolean): Card {
    const bucket = CARDS.filter((entry) => isHighTierCard(entry) === highTier)
    const picked = bucket[Math.floor(Math.random() * bucket.length)] ?? bucket[0]
    return picked ?? randomCard()
}

// ── Chat drops ────────────────────────────────────────────────────────────────

/** Chat messages per card drop. 0 disables drops (used by the test suite). */
const SPAWN_EVERY = Number(process.env.TCG_SPAWN_EVERY ?? 25)
const SPAWN_TTL = 5 * 60 * 1000

const counters = new Map<string, number>()
const spawns = new Map<string, { cardId: string; at: number }>()

/**
 * Per-chat history of the cards most recently put in the spawn slot. Fresh
 * picks avoid these so the same card does not keep coming back; once a pool is
 * fully used up repeats are allowed again (history is capped).
 */
const recentDrops = new Map<string, string[]>()
const RECENT_DROP_LIMIT = 20
const RECENT_DROP_KEY = 'TCG_RECENT_DROPS:'
let recentLoaded = false

/** Survive a restart: the history is small, so it lives in the settings table. */
function loadRecentDrops(): void {
    if (recentLoaded) return
    recentLoaded = true
    try {
        for (const row of db.settings()) {
            if (!row.key.startsWith(RECENT_DROP_KEY)) continue
            const jid = row.key.slice(RECENT_DROP_KEY.length)
            const parsed = JSON.parse(row.value) as unknown
            if (!jid || !Array.isArray(parsed)) continue
            recentDrops.set(
                jid,
                parsed.filter((id): id is string => typeof id === 'string').slice(0, RECENT_DROP_LIMIT),
            )
        }
    } catch {
        // A corrupt history just means a few extra repeats; never crash for it.
    }
}

export function rememberDrop(chat: string, cardId: string): void {
    loadRecentDrops()
    const history = recentDrops.get(chat) ?? []
    if (history[0] !== cardId) history.unshift(cardId)
    if (history.length > RECENT_DROP_LIMIT) history.length = RECENT_DROP_LIMIT
    recentDrops.set(chat, history)
    try {
        db.setSetting(`${RECENT_DROP_KEY}${chat}`, JSON.stringify(history))
    } catch {
        // Keep the in-memory copy when the write fails.
    }
}

export function recentDropIds(chat: string): string[] {
    loadRecentDrops()
    return [...(recentDrops.get(chat) ?? [])]
}

/** Pick a random card from `pool`, skipping cards this chat just saw. */
export function pickFreshCard(chat: string, pool: readonly Card[], roll = Math.random()): Card {
    if (!pool.length) throw new Error('cannot pick a card from an empty pool')
    const recent = new Set(recentDropIds(chat))
    const fresh = pool.filter((entry) => !recent.has(entry.id))
    const choices = fresh.length ? fresh : pool
    return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))] as Card
}

/** Count a chat message and, every 25th one, drop a card. */
export function maybeDropCard(chat: string): Card | null {
    if (!Number.isFinite(SPAWN_EVERY) || SPAWN_EVERY <= 0) return null

    const count = (counters.get(chat) ?? 0) + 1
    counters.set(chat, count)
    if (count % SPAWN_EVERY !== 0) return null

    const live = pendingCard(chat)
    if (live) return null

    const bucket = CARDS.filter((entry) => !isHighTierCard(entry))
    const drop = bucket.length ? pickFreshCard(chat, bucket) : randomCardForDrop(false)
    spawns.set(chat, { cardId: drop.id, at: Date.now() })
    rememberDrop(chat, drop.id)
    return drop
}

export function pendingCard(chat: string): Card | null {
    const spawn = spawns.get(chat)
    if (!spawn) return null
    if (Date.now() - spawn.at > SPAWN_TTL) {
        spawns.delete(chat)
        return null
    }
    return CARD_BY_ID.get(spawn.cardId) ?? null
}

export function claimCard(chat: string, user: string): { card: Card; copies: number; isNew: boolean; deckFull?: boolean } | null {
    const card = pendingCard(chat)
    if (!card) return null

    const before = db.deckRow(user, card.id)
    // Deck holds max 10 unique cards. A brand-new card would overflow:
    // leave the drop in place and ask the player to bank their deck first.
    if (!before && db.deckOf(user).length >= 10) {
        return { card, copies: 0, isNew: true, deckFull: true }
    }
    spawns.delete(chat)
    const row = db.addDeckCard(user, card.id)
    return { card, copies: row.copies, isNew: !before }
}

export function clearDrop(chat: string): void {
    spawns.delete(chat)
}

/** Admin drop: place a specific card in the chat's spawn slot. */
export function forceDrop(chat: string, card: Card): void {
    spawns.set(chat, { cardId: card.id, at: Date.now() })
    rememberDrop(chat, card.id)
}

// ── Collection helpers ────────────────────────────────────────────────────────

export interface Collection {
    unique: number
    total: number
    byRarity: Record<Rarity, number>
    cards: Array<{ card: Card; copies: number }>
}

export function collectionOf(user: string): Collection {
    const byRarity: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }

    // Collection and deck are both owned. Counting only the binder made .inv
    // and .profile report a smaller collection than the user actually had.
    const merged = new Map<string, { card: Card; copies: number }>()
    for (const row of db.cards(user)) {
        const card = CARD_BY_ID.get(row.card_id)
        if (!card) continue
        merged.set(card.id, { card, copies: row.copies })
    }
    for (const row of db.deckOf(user)) {
        const card = CARD_BY_ID.get(row.card_id)
        if (!card) continue
        const existing = merged.get(card.id)
        if (existing) existing.copies += row.copies
        else merged.set(card.id, { card, copies: row.copies })
    }

    const owned = [...merged.values()]

    for (const entry of owned) byRarity[entry.card.rarity] += entry.copies

    return {
        unique: owned.length,
        total: owned.reduce((sum, entry) => sum + entry.copies, 0),
        byRarity,
        cards: owned.sort(
            (a, b) => RARITY_ORDER.indexOf(b.card.rarity) - RARITY_ORDER.indexOf(a.card.rarity) || a.card.name.localeCompare(b.card.name),
        ),
    }
}

export const DAILY_MS = 24 * 60 * 60 * 1000

export function dailyStatus(user: string): { ready: boolean; waitMs: number } {
    const last = db.tcgDailyAt(user)
    const elapsed = Date.now() - last
    if (elapsed >= DAILY_MS) return { ready: true, waitMs: 0 }
    return { ready: false, waitMs: DAILY_MS - elapsed }
}

export function formatWait(ms: number): string {
    const hours = Math.floor(ms / 3_600_000)
    const minutes = Math.max(1, Math.ceil((ms % 3_600_000) / 60_000))
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function cardHeader(card: Card): string {
    const style = RARITY_STYLE[card.rarity]
    return `${style.dot} *${card.name}* — ${style.label}`
}

/** Shared announcement so scheduled, passive and manual drops look the same. */
export function cardDropCaption(card: Card, prefix: string): string {
    const style = RARITY_STYLE[card.rarity]
    const copies = Number(db.cardCount(card.id) ?? 0) + 1
    const price = cardPrice(card)
    const top = copies <= 10
    const lines = [
        '🟢 *CARD SPAWN*',
        `🍃 *${card.name}* \u00b7 ${card.series}`,
        `\u26A1 Tier ${card.tier ?? '?'} \u00b7 ${style.dot} ${style.label}${top ? ' \u00b7 top 10 copy' : ''} \u00b7 💰 ${price} \u00b7 copy #${copies}`,
        `\u25B8 *${prefix}claim* to take it`,
    ]
    return lines.join('\n')
}

/** Fair spawn price: power drives value, jitter keeps drops interesting. */
export function cardPrice(card: Card): number {
    return Math.max(5, Math.round(card.power / 10))
}

export function cardBody(card: Card): string {
    return [
        cardHeader(card),
        `╭─ ${card.emoji} ${card.series}`,
        card.tier ? `│ Tier  : ${card.tier}` : `│ Card  : ${card.id}`,
        card.quote ? `╰─ "${card.quote}"` : '╰─',
    ].join('\n')
}

// ── Card art ──────────────────────────────────────────────────────────────────

const ART: Record<Rarity, { top: string; bottom: string; accent: string }> = {
    common: { top: '#1f2937', bottom: '#0b1220', accent: '#94a3b8' },
    rare: { top: '#0b2a45', bottom: '#0b1220', accent: '#38bdf8' },
    epic: { top: '#2a1052', bottom: '#140b2b', accent: '#c084fc' },
    legendary: { top: '#3b2408', bottom: '#191106', accent: '#fbbf24' },
}

export interface CardArt {
    buffer: Buffer
    animated: boolean
}

export type CardMediaContent =
    | { image: Buffer; caption: string }
    | { video: Buffer; gifPlayback: true; mimetype: 'video/mp4'; caption: string }

/** Build the right WhatsApp payload: GIF-style cards must go as looping video. */
export function cardMedia(art: CardArt, caption: string): CardMediaContent {
    return art.animated
        ? { video: art.buffer, gifPlayback: true, mimetype: 'video/mp4', caption }
        : { image: art.buffer, caption }
}

const artCache = new Map<string, CardArt>()

const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const wrapText = (text: string, maxChars: number): string[] => {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''

    for (const word of words) {
        if (!line) {
            line = word
            continue
        }
        if (`${line} ${word}`.length <= maxChars) {
            line = `${line} ${word}`
            continue
        }
        lines.push(line)
        line = word
    }
    if (line) lines.push(line)
    return lines.slice(0, 2)
}

const MAX_ART_BYTES = 8 * 1024 * 1024
/** Source downloads can be big (animated originals ~20MB); we convert down to a small mp4. */
const MAX_ART_SOURCE_BYTES = 60 * 1024 * 1024
const artFailures = new Set<string>()

const artDir = (): string => process.env.CARD_IMAGE_DIR ?? 'data/cards'

type ArtFormat = 'png' | 'jpg' | 'webp' | 'gif' | 'mp4'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function detectArtFormat(buffer: Buffer): ArtFormat | undefined {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
    const head = buffer.subarray(0, 12).toString('ascii')
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif'
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp'
    if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4'
    return undefined
}

async function hasAnimation(buffer: Buffer): Promise<boolean> {
    try {
        const metadata = await sharp(buffer, { animated: true }).metadata()
        return (metadata.pages ?? 1) > 1
    } catch {
        return false
    }
}

async function animatedMp4(buffer: Buffer, format: 'gif' | 'webp'): Promise<Buffer> {
    return toMp4(buffer, format)
}

async function cachedArt(dir: string, id: string): Promise<CardArt | undefined> {
    for (const extension of ['mp4', 'gif', 'webp', 'png', 'jpg', 'jpeg']) {
        const file = join(dir, `${id}.${extension}`)
        if (!existsSync(file)) continue

        const buffer = await readFile(file)
        const format = detectArtFormat(buffer)
        if (!format) continue

        if (format === 'mp4') return { buffer, animated: true }

        if (format === 'gif' || (format === 'webp' && (await hasAnimation(buffer)))) {
            const mp4 = await animatedMp4(buffer, format)
            writeFileSync(join(dir, `${id}.mp4`), mp4)
            return { buffer: mp4, animated: true }
        }

        return { buffer, animated: false }
    }

    return undefined
}

/**
 * Card art, in priority order:
 *   1. a file already cached in CARD_IMAGE_DIR (`data/cards` by default),
 *   2. the rendered shoob image for imported cards (downloaded once),
 *   3. locally generated artwork, so the game still works offline.
 *
 * Animated high-tier art is converted to a looping MP4 once and cached.
 */
export async function cardArt(card: Card): Promise<CardArt> {
    const cached = artCache.get(card.id)
    if (cached) return cached

    const dir = artDir()
    try {
        const file = await cachedArt(dir, card.id)
        if (file) {
            artCache.set(card.id, file)
            return file
        }
    } catch {
        // A broken cached GIF should not stop the card from being delivered;
        // fall through to the remote art or the generated fallback.
    }

    // Imported shoob cards carry their rendered art URL. Fetch once, keep it on
    // disk, and remember failures so a dead CDN does not cost 8s per command.
    if (card.image && !artFailures.has(card.id)) {
        try {
            // Shoob's size=400 endpoint redirects to a "resized" CDN copy with
            // the animation stripped (1 frame). The original file animates, so
            // follow the redirect once and if it landed on /resized/, re-fetch
            // the original path instead.
            const response = await fetch(card.image, {
                signal: AbortSignal.timeout(8000),
                headers: { 'user-agent': 'IZUKU-MD', accept: 'image/*' },
            })
            let url = response.url || card.image
            // .../6/resized/400_NAME.gif -> .../6/NAME.gif (drop the size prefix too)
            const original = url.replace(/\/resized\/\d+_/, '/')
            if (original !== url) {
                const full = await fetch(original, {
                    signal: AbortSignal.timeout(20000),
                    headers: { 'user-agent': 'IZUKU-MD', accept: 'image/*' },
                })
                if (full.ok) {
                    url = original
                    // Originals can be 20MB+; the cap applies to what we SEND
                    // (the converted mp4), not to the source we download.
                    const buffer2 = Buffer.from(await full.arrayBuffer())
                    if (buffer2.length <= MAX_ART_SOURCE_BYTES) {
                        const f2 = detectArtFormat(buffer2)
                        if (f2 === 'mp4') {
                            mkdirSync(dir, { recursive: true })
                            writeFileSync(join(dir, `${card.id}.mp4`), buffer2)
                            const art = { buffer: buffer2, animated: true }
                            artCache.set(card.id, art)
                            return art
                        }
                        if (f2 === 'gif' || (f2 === 'webp' && (await hasAnimation(buffer2)))) {
                            mkdirSync(dir, { recursive: true })
                            writeFileSync(join(dir, `${card.id}.${f2}`), buffer2)
                            const mp4 = await animatedMp4(buffer2, f2)
                            writeFileSync(join(dir, `${card.id}.mp4`), mp4)
                            const art = { buffer: mp4, animated: true }
                            artCache.set(card.id, art)
                            return art
                        }
                        // original is static; keep the resized copy we already have
                    }
                }
            }
            const buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0)
            const format = detectArtFormat(buffer)

            if (format && buffer.length <= MAX_ART_BYTES) {
                mkdirSync(dir, { recursive: true })

                if (format === 'mp4') {
                    writeFileSync(join(dir, `${card.id}.mp4`), buffer)
                    void backupCardArt(card.id, buffer, 'mp4')
                    const art = { buffer, animated: true }
                    artCache.set(card.id, art)
                    return art
                }

                if (format === 'gif' || (format === 'webp' && (await hasAnimation(buffer)))) {
                    writeFileSync(join(dir, `${card.id}.${format}`), buffer)
                    const mp4 = await animatedMp4(buffer, format)
                    writeFileSync(join(dir, `${card.id}.mp4`), mp4)
                    const art = { buffer: mp4, animated: true }
                    artCache.set(card.id, art)
                    return art
                }

                // Static art stays transparent and is pulled live: no
                // disk cache for still images, only animated conversions.
                const art = { buffer, animated: false }
                // Optional off-box backup (no-op unless R2 env vars are set).
                void backupCardArt(card.id, buffer, format)
                return art
            }

            artFailures.add(card.id)
        } catch {
            artFailures.add(card.id)
        }
    }

    const palette = ART[card.rarity]
    const style = RARITY_STYLE[card.rarity]
    const initials = card.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase()

    const nameLines = wrapText(card.name, 16)
    const nameStart = 468

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="660" viewBox="0 0 480 660">
    <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.top}"/>
            <stop offset="100%" stop-color="${palette.bottom}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
        </radialGradient>
    </defs>

    <rect width="480" height="660" fill="#000000"/>
    <rect width="480" height="660" rx="28" fill="url(#bg)"/>
    <rect x="10" y="10" width="460" height="640" rx="22" fill="none" stroke="${palette.accent}" stroke-opacity="0.85" stroke-width="4"/>

    <text x="40" y="60" font-family="DejaVu Sans, sans-serif" font-size="18" letter-spacing="4" fill="${palette.accent}">${escapeXml(card.series.toUpperCase())}</text>
    <text x="440" y="60" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#e2e8f0" fill-opacity="0.75">${escapeXml(style.label.toUpperCase())}</text>

    <rect x="40" y="88" width="400" height="300" rx="18" fill="${palette.accent}" fill-opacity="0.10"/>
    <rect x="40" y="88" width="400" height="300" rx="18" fill="url(#glow)"/>
    <text x="240" y="272" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="132" font-weight="bold" fill="${palette.accent}" fill-opacity="0.35">${escapeXml(initials)}</text>

    ${nameLines
        .map(
            (line, index) =>
                `<text x="40" y="${nameStart + index * 42}" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#f8fafc">${escapeXml(line)}</text>`,
        )
        .join('\n    ')}

    <text x="40" y="586" font-family="DejaVu Sans, sans-serif" font-size="22" fill="${palette.accent}">POWER ${card.power}</text>
    <text x="440" y="586" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#cbd5e1" fill-opacity="0.8">${escapeXml(card.id)}</text>
    <text x="240" y="628" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="15" letter-spacing="6" fill="#94a3b8">IZUKU CARDS</text>
</svg>`

    const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
    const flat = await sharp(buffer)
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .png()
        .toBuffer()
    const art = { buffer: flat, animated: false }
    artCache.set(card.id, art)
    return art
}

/** Backward-compatible static buffer accessor. Prefer `cardArt` + `cardMedia`. */
export async function cardImage(card: Card): Promise<Buffer> {
    return (await cardArt(card)).buffer
}

/** Cards waiting in the user's deck, resolved to full card records. */
export function deckOf(user: string): Array<{ card: Card; copies: number }> {
    return db
        .deckOf(user)
        .map((row) => ({ card: CARD_BY_ID.get(row.card_id), copies: row.copies }))
        .filter((entry): entry is { card: Card; copies: number } => Boolean(entry.card))
}

// ── Deck image ────────────────────────────────────────────────────────────────

export const DECK_SLOTS = 12
const TILE_W = 340
const TILE_H = 476
/** Generous spacing: tiles used to sit almost edge to edge. */
const GAP = 48
const PAD = 64
const BADGE_COLOR: Record<Rarity, string> = { common: '#94a3b8', rare: '#38bdf8', epic: '#c084fc', legendary: '#fbbf24' }

const xmlEscape = (text: string): string =>
    text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch)

const shortName = (name: string): string => (name.length > 24 ? `${name.slice(0, 23)}…` : name)

/** Black tile with the card name, used when the art cannot be read. */
async function placeholderTile(card: Card): Promise<Buffer> {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}">` +
        `<rect width="100%" height="100%" fill="#000000"/>` +
        `<text x="50%" y="${TILE_H / 2}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="22" font-weight="bold">${xmlEscape(shortName(card.name))}</text></svg>`
    return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Decode a card art buffer to a flat RGB PNG tile. Animated art is stored as
 * mp4 (sharp cannot decode that), so the first frame is pulled with ffmpeg.
 */
async function artToPng(buffer: Buffer, animated: boolean): Promise<Buffer> {
    let source = buffer
    if (animated) source = await firstFrameFromMp4(buffer)
    return sharp(source)
        .flatten({ background: '#000000' })
        .resize(TILE_W, TILE_H, { fit: 'cover', position: 'centre', background: '#000000' })
        .png()
        .toBuffer()
}

function firstFrameFromMp4(mp4: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-vcodec', 'png', 'pipe:1'])
        const chunks: Buffer[] = []
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
        child.on('error', reject)
        child.on('close', (code) => (code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}`))))
        child.stdin.on('error', () => undefined)
        child.stdin.end(mp4)
    })
}

/** One collage tile: art with white border, tier badge top-left, name strip at the bottom, then rotated. */
async function deckTile(entry: { card: Card; copies: number }): Promise<{ input: Buffer; width: number; height: number }> {
    let base: Buffer
    try {
        const art = await cardArt(entry.card)
        base = await artToPng(art.buffer, art.animated)
    } catch {
        base = await placeholderTile(entry.card)
    }
    const tierLabel = `T${entry.card.tier ?? '?'}${entry.copies > 1 ? ` ×${entry.copies}` : ''}`
    const badgeW = Math.max(68, tierLabel.length * 13 + 20)
    const overlay =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}">` +
        `<rect x="2" y="2" width="${TILE_W - 4}" height="${TILE_H - 4}" rx="12" fill="none" stroke="#ffffff" stroke-width="5"/>` +
        `<rect x="10" y="10" width="${badgeW}" height="32" rx="8" fill="${BADGE_COLOR[entry.card.rarity]}"/>` +
        `<text x="20" y="33" fill="#000000" font-family="sans-serif" font-size="19" font-weight="bold">${xmlEscape(tierLabel)}</text>` +
        `<rect x="0" y="${TILE_H - 52}" width="${TILE_W}" height="52" fill="#000000" fill-opacity="0.82"/>` +
        `<text x="12" y="${TILE_H - 18}" fill="#ffffff" font-family="sans-serif" font-size="21" font-weight="bold">${xmlEscape(shortName(entry.card.name))}</text></svg>`
    const tile = await sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toBuffer()
    return { input: tile, width: TILE_W, height: TILE_H }
}

/**
 * Render the deck as a 9:16 vertical board: three upright card tiles per row,
 * generous spacing, rows centred on a dark background. Written to /tmp; the
 * caller deletes it after sending.
 */
export async function renderDeckImage(entries: Array<{ card: Card; copies: number }>): Promise<{ path: string; buffer: Buffer }> {
    const COLS = 3
    const shown = entries.slice(0, DECK_SLOTS)
    const tiles = await Promise.all(shown.map((entry) => deckTile(entry)))

    const rows = Math.max(1, Math.ceil(tiles.length / COLS))
    const width = PAD * 2 + COLS * TILE_W + (COLS - 1) * GAP
    const gridHeight = rows * TILE_H + (rows - 1) * GAP
    const height = PAD + gridHeight + PAD
    const gridTop = PAD

    const composites = tiles.map((tile, index) => {
        const row = Math.floor(index / COLS)
        const col = index % COLS
        const inRow = Math.min(COLS, tiles.length - row * COLS)
        const rowOffset = Math.round(((COLS - inRow) * (TILE_W + GAP)) / 2)
        return {
            input: tile.input,
            left: PAD + rowOffset + col * (TILE_W + GAP),
            top: gridTop + row * (TILE_H + GAP),
        }
    })
    const buffer = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 31, b: 20 } } })
        .composite(composites)
        .jpeg({ quality: 92 })
        .toBuffer()
    const path = join('/tmp', `izuku-deck-${process.pid}-${Date.now()}.jpg`)
    writeFileSync(path, buffer)
    return { path, buffer }
}

/**
 * Collection-game gate: in groups the games only run where the anchor turned
 * them on (.agb live). DMs and the owner are always allowed.
 */
export function gameBlocked(chat: string, isGroup: boolean, _isOwner: boolean): boolean {
    if (!isGroup) return true
    return !db.gameActive(chat)
}

/** What the guards need from a command context; structural so any ctx fits. */
type GuardContext = {
    chat: string
    isGroup: boolean
    isOwner: boolean
    isMod?: boolean
    reply: (content: string) => Promise<unknown>
}

/**
 * Card and pokemon guard: those games never run in DMs, and in groups only
 * where a mod opened them. Returns true when the command must stop.
 */
export async function gameGuard(ctx: GuardContext): Promise<boolean> {
    if (!ctx.isGroup) {
        await ctx.reply('Cards and pokemon only run in groups. 🛑')
        return true
    }
    if (db.cardsActive(ctx.chat)) return false
    await ctx.reply('The card game is not active in this group yet. A mod can open it with .agb live. 🛑')
    return true
}

/**
 * Pokemon guard: pokemon is OFF by default and only runs in groups where a mod
 * turned it on with .agb poke. No owner bypass: same gate for everyone.
 */
export async function pokeGuard(ctx: GuardContext): Promise<boolean> {
    if (!ctx.isGroup) {
        await ctx.reply('Pokemon runs in groups only.')
        return true
    }
    if (db.gameActive(ctx.chat) && db.pokeEnabled(ctx.chat)) return false
    await ctx.reply('Pokemon is not active in this group yet. A mod can turn it on with .agb poke.')
    return true
}

/**
 * Economy guard: Ryo, the vault and the shop are part of the collection game,
 * so they run only in groups where a mod opened the games.
 */
export async function economyGuard(ctx: GuardContext): Promise<boolean> {
    if (!ctx.isGroup) {
        await ctx.reply('The Ryo economy runs in groups only — it belongs to the card and pokemon game. 🛑')
        return true
    }
    if (db.gameActive(ctx.chat)) return false
    if (db.gameActive(ctx.chat)) return false
    await ctx.reply('The Ryo economy is not open in this group yet. A mod can open the games. 🛑')
    return true
}

/**
 * Arena guard for tictactoe and wordchain: they work in DMs normally, and in
 * groups only where a mod opened the games. Returns true when it must stop.
 */
export async function arenaGuard(ctx: GuardContext): Promise<boolean> {
    if (!ctx.isGroup) return false
    if (db.gameActive(ctx.chat)) return false
    await ctx.reply('Games are not active in this group yet. A mod can open them. 🛑')
    return true
}

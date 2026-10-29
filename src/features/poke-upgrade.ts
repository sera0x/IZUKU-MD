// Pokemon upgrade rules: catch odds, quality stars, roster/PC caps, release values,
// anime-style evolution offers, daily pokemon quest and streak milestones.
import { db } from '../db/index.js'
import { CARDS, randomCard } from './tcg.js'
import { dayIndex } from './economy.js'

export const ROSTER_CAP = 10
export const PC_CAP = 500

// ── Catching ────────────────────────────────────────────────────────────────
// Hand-tuned (no catch log yet): commons are easy, rares are a coin flip.
export const CATCH_RATE: Record<string, number> = { common: 0.85, uncommon: 0.7, rare: 0.5 }
export const catchRate = (rarity: string): number => CATCH_RATE[rarity] ?? CATCH_RATE.common!
export const rollCatch = (rarity: string, roll = Math.random()): boolean => roll < catchRate(rarity)

/** Quality is 1-100 percent; stars = ceil(percent / 20), so 1-20 is 1 star, 81-100 is 5 stars. */
export const rollQuality = (roll = Math.random()): number => 1 + Math.floor(roll * 100)
export const starsFor = (percent: number): number => (percent > 0 ? Math.ceil(percent / 20) : 0)
export const starText = (percent: number): string => {
    if (!percent) return 'unrated'
    const stars = starsFor(percent)
    return '★'.repeat(stars) + '☆'.repeat(5 - stars) + ` ${percent}%`
}

// ── Release ─────────────────────────────────────────────────────────────────
export const RELEASE_BASE = 10
const RELEASE_MULT: Record<string, number> = { common: 1, uncommon: 2, rare: 4 }
/** 10 Ryo x rarity multiplier (common 1, uncommon 2, rare 4) x stars. Rare 5-star = 200 Ryo. */
export const releaseValue = (rarity: string, percent: number): number =>
    RELEASE_BASE * (RELEASE_MULT[rarity] ?? 1) * Math.max(1, starsFor(percent))

const RELEASE_TIMEOUT_MS = 60_000
interface ReleasePending {
    pokeId: number
    name: string
    value: number
    expires: number
}
const releasePending = new Map<string, ReleasePending>()

/** A new .prelease replaces any earlier pending release (no stacking). */
export function setReleasePending(jid: string, pokeId: number, name: string, value: number): void {
    releasePending.set(jid, { pokeId, name, value, expires: Date.now() + RELEASE_TIMEOUT_MS })
}

/** Single-use: the pending release is removed whether or not it is still valid. */
export function takeReleasePending(jid: string): { pokeId: number; name: string; value: number } | null {
    const pending = releasePending.get(jid)
    releasePending.delete(jid)
    if (!pending || pending.expires < Date.now()) return null
    return { pokeId: pending.pokeId, name: pending.name, value: pending.value }
}

// ── Evolution offers (anime style: ask first, cancel on silence) ────────────
export const EVO_TIMEOUT_MS = 30_000
export const KO_XP = 25

export interface EvoOffer {
    jid: string
    chat: string
    pokeId: number
    name: string
    toId: number
    toName: string
    timer?: ReturnType<typeof setTimeout>
}

const evoOffers = new Map<string, EvoOffer>()
const evoKey = (chat: string, jid: string): string => `${chat}|${jid}`

/** Open an offer. After 30s with no answer it is dropped and onTimeout runs. */
export function openEvoOffer(offer: Omit<EvoOffer, 'timer'>, onTimeout: () => void): EvoOffer {
    const key = evoKey(offer.chat, offer.jid)
    const full: EvoOffer = { ...offer }
    full.timer = setTimeout(() => {
        if (evoOffers.get(key) !== full) return
        evoOffers.delete(key)
        onTimeout()
    }, EVO_TIMEOUT_MS)
    evoOffers.set(key, full)
    return full
}

export const hasEvoOffer = (chat: string, jid: string): boolean => evoOffers.has(evoKey(chat, jid))

export function takeEvoOffer(chat: string, jid: string): EvoOffer | null {
    const key = evoKey(chat, jid)
    const offer = evoOffers.get(key)
    if (!offer) return null
    if (offer.timer) clearTimeout(offer.timer)
    evoOffers.delete(key)
    return offer
}

/** Plain words 'evolve' / 'cancel' count only while this sender has an open offer in this chat. */
export function bareEvolveReply(sender: string, chat: string, body: string): 'evolve' | 'evocancel' | null {
    const word = body.trim().toLowerCase()
    if (word !== 'evolve' && word !== 'cancel') return null
    if (!hasEvoOffer(chat, sender)) return null
    return word === 'evolve' ? 'evolve' : 'evocancel'
}

// ── Daily pokemon quest ─────────────────────────────────────────────────────
// Quest kind rotates by day (day % 3): 0 catch any, 1 win a battle, 2 catch the featured type.
// The featured type rotates weekly (week index % list length).
export const FEATURED_TYPES = ['fire', 'water', 'grass', 'electric', 'psychic', 'rock', 'ghost', 'ice', 'dragon', 'normal', 'bug', 'ground']
export const featuredType = (day = dayIndex()): string => FEATURED_TYPES[Math.floor(day / 7) % FEATURED_TYPES.length]!

export type QuestKind = 'catch' | 'win' | 'catch_type'
export const questKind = (day = dayIndex()): QuestKind => (['catch', 'win', 'catch_type'] as const)[day % 3]!
export const QUEST_REWARD: Record<QuestKind, { coins: number; xp: number }> = {
    catch: { coins: 150, xp: 100 },
    win: { coins: 200, xp: 100 },
    catch_type: { coins: 250, xp: 150 },
}

export function questTitle(day = dayIndex()): string {
    const kind = questKind(day)
    if (kind === 'catch') return 'Catch 1 wild pokemon'
    if (kind === 'win') return 'Win 1 pokemon battle'
    return `Catch 1 ${featuredType(day)}-type pokemon`
}

export interface QuestOutcome {
    lines: string[]
    levelUps: Array<{ pokeId: number; before: number; after: number }>
}

/** Advance today's quest. Pays Ryo + xp (xp to the strongest roster pokemon) once per day. */
export function questTick(jid: string, event: { kind: 'catch'; types: string[] } | { kind: 'win' }): QuestOutcome {
    const out: QuestOutcome = { lines: [], levelUps: [] }
    const day = dayIndex()
    const kind = questKind(day)
    const hit =
        event.kind === 'win'
            ? kind === 'win'
            : kind === 'catch' || (kind === 'catch_type' && event.types.includes(featuredType(day)))
    if (!hit || db.questGet(jid, day).done) return out

    db.questSet(jid, day, 1, 1)
    const reward = QUEST_REWARD[kind]
    db.addCoins(jid, reward.coins)
    let xpLine = ''
    const top = db.pokeList(jid).slice().sort((a, b) => b.power - a.power)[0]
    if (top) {
        const before = db.pokeGet(jid, top.poke_id)?.level ?? 1
        const after = db.pokeAddXp(jid, top.poke_id, reward.xp).level
        if (after > before) out.levelUps.push({ pokeId: top.poke_id, before, after })
        xpLine = ` +${reward.xp} xp to ${top.name}`
    }
    out.lines.push(`📜 Daily quest done: ${questTitle(day)}. +${reward.coins} Ryo${xpLine}`)
    return out
}

// ── Streak milestones (called from .daily after a claim) ────────────────────
// 7 days: random card. 30 days: rare card. 60 days: +1000 Ryo. Every 7th day past 60: +300 Ryo.
export function streakMilestone(jid: string, streak: number): string[] {
    const lines: string[] = []
    if (streak === 7) {
        const card = randomCard()
        db.addCard(jid, card.id)
        lines.push(`🎴 7 day streak! bonus card: *${card.name}* (${card.rarity})`)
    }
    if (streak === 30) {
        const pool = CARDS.filter((card) => card.rarity === 'rare')
        const card = pool[Math.floor(Math.random() * pool.length)] ?? randomCard()
        db.addCard(jid, card.id)
        lines.push(`💎 30 day streak! rare card: *${card.name}*`)
    }
    if (streak === 60) {
        db.addCoins(jid, 1000)
        lines.push('🔥 60 day streak! +1000 Ryo')
    } else if (streak > 60 && streak % 7 === 0) {
        db.addCoins(jid, 300)
        lines.push(`🔥 ${streak} day streak! +300 Ryo`)
    }
    return lines
}

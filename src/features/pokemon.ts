import axiosRaw from "axios"
const axios = axiosRaw as any

const API = 'https://pokeapi.co/api/v2'
const TIMEOUT = 10_000
export const SPAWN_TTL_MS = 3 * 60_000
export const MAX_DEX_ID = 1025

export type Rarity = 'common' | 'uncommon' | 'rare'

export interface PokeStat {
    name: string
    base: number
}

export interface PokeData {
    id: number
    name: string
    types: string[]
    abilities: string[]
    heightM: number
    weightKg: number
    stats: PokeStat[]
    power: number
    rarity: Rarity
    stage: 'basic' | 'evolved' | 'legendary' | 'mythical'
    imageUrl: string | null
}

export interface ActiveSpawn {
    poke: PokeData
    expires: number
}

const spawns = new Map<string, ActiveSpawn>()

export const COIN_BONUS: Record<Rarity, number> = { common: 20, uncommon: 50, rare: 150 }

export function normalizePokeName(input: string): string {
    return input.toLowerCase().trim().replace(/\s+/g, '-')
}

export function activeSpawn(chat: string): ActiveSpawn | undefined {
    const spawn = spawns.get(chat)
    if (!spawn) return undefined
    if (Date.now() > spawn.expires) {
        spawns.delete(chat)
        return undefined
    }
    return spawn
}

export function setSpawn(chat: string, poke: PokeData): ActiveSpawn {
    const spawn = { poke, expires: Date.now() + SPAWN_TTL_MS }
    spawns.set(chat, spawn)
    return spawn
}

export function clearSpawn(chat: string): void {
    spawns.delete(chat)
}

export function randomDexId(): number {
    return 1 + Math.floor(Math.random() * MAX_DEX_ID)
}

/** Fetch one pokemon live from pokeapi (pokemon + species for stage/legendary flags). */
export async function fetchPokemon(query: string | number): Promise<PokeData | null> {
    const key = typeof query === 'number' ? String(query) : normalizePokeName(query)
    let pokemon: any
    try {
        const res = await axios.get(`${API}/pokemon/${key}`, { timeout: TIMEOUT, validateStatus: () => true })
        if (res.status !== 200) return null
        pokemon = res.data
    } catch {
        return null
    }

    let species: any = null
    try {
        const res = await axios.get(pokemon.species.url, { timeout: TIMEOUT, validateStatus: () => true })
        if (res.status === 200) species = res.data
    } catch {
        species = null
    }

    const stats: PokeStat[] = (pokemon.stats as any[]).map((s) => ({ name: s.stat.name, base: s.base_stat }))
    const power = stats.reduce((sum, s) => sum + s.base, 0)

    let stage: PokeData['stage'] = 'basic'
    if (species?.is_legendary) stage = 'legendary'
    else if (species?.is_mythical) stage = 'mythical'
    else if (species?.evolves_from_species) stage = 'evolved'

    const rarity: Rarity = stage === 'legendary' || stage === 'mythical' ? 'rare' : stage === 'evolved' ? 'uncommon' : 'common'

    const art = pokemon.sprites?.other?.['official-artwork']?.front_default ?? pokemon.sprites?.front_default ?? null

    return {
        id: pokemon.id,
        name: pokemon.name,
        types: (pokemon.types as any[]).map((t) => t.type.name),
        abilities: (pokemon.abilities as any[]).map((a) => a.ability.name + (a.is_hidden ? ' (hidden)' : '')),
        heightM: pokemon.height / 10,
        weightKg: pokemon.weight / 10,
        stats,
        power,
        rarity,
        stage,
        imageUrl: art,
    }
}

/** Download sprite bytes live (no disk cache). */
export async function fetchArt(url: string | null): Promise<Buffer | null> {
    if (!url) return null
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: TIMEOUT, validateStatus: () => true })
        if (res.status !== 200) return null
        return Buffer.from(res.data)
    } catch {
        return null
    }
}

export const STAT_LABELS: Record<string, string> = {
    hp: 'HP',
    attack: 'Atk',
    defense: 'Def',
    'special-attack': 'SpA',
    'special-defense': 'SpD',
    speed: 'Spe',
}

export function statBars(stats: PokeStat[]): string {
    const lines = stats.map((s) => {
        const filled = Math.min(12, Math.round((s.base / 255) * 12))
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(12 - filled)
        return `${(STAT_LABELS[s.name] ?? s.name).padEnd(4)} ${bar} ${String(s.base).padStart(3)}`
    })
    return lines.join('\n')
}

export function titleName(name: string): string {
    return name
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')
}

export function rarityLabel(r: Rarity): string {
    return r === 'rare' ? 'rare (legendary/mythical)' : r === 'uncommon' ? 'uncommon (evolved)' : 'common (base form)'
}

// ── Battles ──────────────────────────────────────────────────────────────────

/**
 * Type effectiveness is read from pokeapi once per attacking type and cached,
 * instead of hard-coding an 18x18 chart.
 */
export interface TypeRelations {
    double: string[]
    half: string[]
    zero: string[]
}

const typeCache = new Map<string, TypeRelations>()

export async function typeRelations(type: string): Promise<TypeRelations> {
    const key = type.toLowerCase()
    const cached = typeCache.get(key)
    if (cached) return cached

    const empty: TypeRelations = { double: [], half: [], zero: [] }
    try {
        const res = await axios.get(`${API}/type/${key}`, { timeout: TIMEOUT, validateStatus: () => true })
        if (res.status !== 200) return empty
        const rel = res.data?.damage_relations ?? {}
        const names = (list: Array<{ name: string }> | undefined): string[] => (list ?? []).map((t) => t.name)
        const value: TypeRelations = {
            double: names(rel.double_damage_to),
            half: names(rel.half_damage_to),
            zero: names(rel.no_damage_to),
        }
        typeCache.set(key, value)
        return value
    } catch {
        return empty
    }
}

export function effectiveness(moveType: string, defenderTypes: string[], rel: TypeRelations): number {
    let multiplier = 1
    for (const type of defenderTypes) {
        if (rel.zero.includes(type)) return 0
        if (rel.double.includes(type)) multiplier *= 2
        else if (rel.half.includes(type)) multiplier *= 0.5
    }
    void moveType
    return multiplier
}

export const BATTLE_LEVEL = 50

export interface BattleStats {
    hp: number
    attack: number
    defense: number
    spAttack: number
    spDefense: number
    speed: number
}

const baseStat = (poke: PokeData, name: string): number => poke.stats.find((s) => s.name === name)?.base ?? 50

/** Level-50 style stats, with HP doubled so a battle lasts a few turns. */
export function battleStats(poke: PokeData): BattleStats {
    const level = BATTLE_LEVEL
    const stat = (name: string): number => Math.floor(((2 * baseStat(poke, name) + 31) * level) / 100) + 5
    const hp = Math.floor(((2 * baseStat(poke, 'hp') + 31) * level) / 100) + level + 10
    return {
        hp: hp * 2,
        attack: stat('attack'),
        defense: stat('defense'),
        spAttack: stat('special-attack'),
        spDefense: stat('special-defense'),
        speed: stat('speed'),
    }
}

export interface BattleSide {
    jid: string
    name: string
    poke: PokeData
}

/** Potions a trainer brings into a battle. */
export interface PotionStock {
    normal: number
    super: number
}

export interface BattleOutcome {
    winner: number | 'draw'
    turns: number
    lines: string[]
    potionsUsed: [number, number]
}

const TYPE_ICON: Record<string, string> = {
    normal: '⚪', fire: '🔥', water: '💧', electric: '⚡', grass: '🌿', ice: '❄️',
    fighting: '🥊', poison: '☠️', ground: '🟤', flying: '🕊️', psychic: '🌀', bug: '🐛',
    rock: '🪨', ghost: '👻', dragon: '🐉', dark: '🌑', steel: '⚙️', fairy: '⚡',
}

const typeTag = (type: string): string => `${TYPE_ICON[type] ?? '•'} ${type}`

/**
 * Real damage formula: level, attack/defense, STAB, type effectiveness and a
 * small random spread. Potions are consumed automatically when a pokemon drops
 * below a third of its HP.
 */
export async function simulateBattle(
    a: BattleSide,
    b: BattleSide,
    potions: [PotionStock, PotionStock] = [
        { normal: 0, super: 0 },
        { normal: 0, super: 0 },
    ],
): Promise<BattleOutcome> {
    const sides = [a, b]
    const stats = [battleStats(a.poke), battleStats(b.poke)]
    const hp = [stats[0]!.hp, stats[1]!.hp]
    const used: [number, number] = [0, 0]
    const lines: string[] = []

    lines.push(`⚔️ *${titleName(a.poke.name)}* (${a.name})`)
    lines.push(`🆚 *${titleName(b.poke.name)}* (${b.name})`)
    lines.push('')

    // Faster pokemon moves first; ties are a coin flip.
    let order: [number, number] = stats[0]!.speed >= stats[1]!.speed ? [0, 1] : [1, 0]

    for (let turn = 1; turn <= 25; turn += 1) {
        let acted = false

        for (const attacker of order) {
            const defender = attacker === 0 ? 1 : 0
            if (hp[attacker]! <= 0 || hp[defender]! <= 0) continue
            acted = true

            const attackPoke = sides[attacker]!.poke
            const defendPoke = sides[defender]!.poke
            const attackerName = titleName(attackPoke.name)
            const defenderName = titleName(defendPoke.name)

            const moveType = attackPoke.types[Math.floor(Math.random() * attackPoke.types.length)] ?? 'normal'
            const rel = await typeRelations(moveType)
            const multiplier = effectiveness(moveType, defendPoke.types, rel)

            const physical = stats[attacker]!.attack >= stats[attacker]!.spAttack
            const atk = physical ? stats[attacker]!.attack : stats[attacker]!.spAttack
            const def = physical ? stats[defender]!.defense : stats[defender]!.spDefense
            const stab = attackPoke.types.includes(moveType) ? 1.5 : 1
            const spread = 0.85 + Math.random() * 0.15
            const power = 60

            let damage = 0
            if (multiplier > 0) {
                damage = Math.floor((((2 * BATTLE_LEVEL) / 5 + 2) * power * (atk / Math.max(1, def))) / 50 + 2)
                damage = Math.max(1, Math.floor(damage * multiplier * stab * spread))
            }
            hp[defender] = Math.max(0, hp[defender]! - damage)

            const tag = typeTag(moveType)
            if (multiplier === 0) {
                lines.push(`🛡️ ${attackerName}'s ${tag} move had *no effect* on ${defenderName}`)
            } else if (multiplier > 1) {
                lines.push(`💥 ${attackerName} hit ${defenderName} with *${tag}* — ${damage} dmg *(super effective!)*`)
            } else if (multiplier < 1) {
                lines.push(`🌫️ ${attackerName} hit ${defenderName} with *${tag}* — ${damage} dmg *(not very effective)*`)
            } else {
                lines.push(`🎯 ${attackerName} hit ${defenderName} with *${tag}* — ${damage} dmg`)
            }

            // Potions: a super potion is drunk first, then a normal one.
            const share = hp[defender]! / stats[defender]!.hp
            const stock = potions[defender]!
            if (hp[defender]! > 0 && share < 0.33) {
                const kind = stock.super > 0 ? 'super' : stock.normal > 0 ? 'normal' : null
                if (kind) {
                    if (kind === 'super') stock.super -= 1
                    else stock.normal -= 1
                    used[defender] = (used[defender] ?? 0) + 1
                    const healed = Math.floor(stats[defender]!.hp * (kind === 'super' ? 0.8 : 0.5))
                    hp[defender] = Math.min(stats[defender]!.hp, hp[defender]! + healed)
                    lines.push(
                        `🧪 ${defenderName} drank a *${kind === 'super' ? 'Super Potion' : 'Potion'}* and recovered *${healed} HP*`,
                    )
                }
            }

            if (hp[defender]! <= 0) {
                lines.push('')
                lines.push(`💀 *${defenderName} fainted!*`)
                lines.push(`🏆 *${attackerName}* wins for *${sides[attacker]!.name}*`)
                return { winner: attacker, turns: turn, lines, potionsUsed: used }
            }
        }

        if (!acted) break
        order = [order[1]!, order[0]!]
    }

    lines.push('')
    lines.push('⏱️ *Time up — the match ends in a draw.*')
    return { winner: 'draw', turns: 25, lines, potionsUsed: used }
}

// ── Growth ───────────────────────────────────────────────────────────────────

/** 100 XP per level keeps a battle-night grind from maxing a pokemon instantly. */
export const XP_PER_LEVEL = 100
export const MAX_POKE_LEVEL = 100

export const pokeLevelForXp = (xp: number): number =>
    Math.min(MAX_POKE_LEVEL, 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL))

export interface NextEvolution {
    id: number
    name: string
    /** Level pokeapi requires; null for stone/trade evolutions, which we skip. */
    minLevel: number | null
}

const speciesCache = new Map<number, number>()

/** The species id behind a pokedex id (they differ once forms exist). */
async function speciesIdFor(dexId: number): Promise<number> {
    const cached = speciesCache.get(dexId)
    if (cached) return cached
    const res = await axios.get(`${API}/pokemon-species/${dexId}`, { timeout: TIMEOUT, validateStatus: () => true })
    const id = Number(res.data?.id) || dexId
    speciesCache.set(dexId, id)
    return id
}

/** Next evolution in the chain, if the species evolves at all. */
export async function fetchEvolution(dexId: number): Promise<NextEvolution | null> {
    try {
        const speciesId = await speciesIdFor(dexId)
        const species = await axios.get(`${API}/pokemon-species/${speciesId}`, { timeout: TIMEOUT, validateStatus: () => true })
        const chainUrl = species.data?.evolution_chain?.url
        if (!chainUrl) return null
        const chain = await axios.get(chainUrl, { timeout: TIMEOUT, validateStatus: () => true })
        const root = chain.data?.chain
        if (!root) return null

        const idOf = (url: string): number => Number(url.split('/').filter(Boolean).pop())
        const walk = (node: any): any => {
            if (!node) return null
            if (idOf(node.species?.url ?? '') === speciesId) return node
            for (const next of node.evolves_to ?? []) {
                const hit = walk(next)
                if (hit) return hit
            }
            return null
        }

        const node = walk(root)
        const next = node?.evolves_to?.[0]
        if (!next) return null
        const detail = next.evolution_details?.[0]
        return {
            id: idOf(next.species?.url ?? '') || 0,
            name: String(next.species?.name ?? ''),
            minLevel: typeof detail?.min_level === 'number' ? detail.min_level : null,
        }
    } catch {
        return null
    }
}

// ── Journey ──────────────────────────────────────────────────────────────────

export interface Starter {
    name: string
    label: string
    emoji: string
}

/** Starter picks for a new trainer. */
export const STARTERS: Starter[] = [
    { name: 'bulbasaur', label: 'Bulbasaur', emoji: '🌱' },
    { name: 'charmander', label: 'Charmander', emoji: '🔥' },
    { name: 'squirtle', label: 'Squirtle', emoji: '💧' },
    { name: 'pikachu', label: 'Pikachu', emoji: '⚡' },
    { name: 'eevee', label: 'Eevee', emoji: '🦊' },
]

const levelMoveCache = new Map<number, Array<{ move: string; at: number }>>()

/** Level-up moves a species learns, sorted by the level they unlock. Cached per dex id. */
export async function levelUpMoves(dexId: number): Promise<Array<{ move: string; at: number }>> {
    const cached = levelMoveCache.get(dexId)
    if (cached) return cached
    try {
        const res = await axios.get(`${API}/pokemon/${dexId}`, { timeout: TIMEOUT, validateStatus: () => true })
        if (res.status !== 200) return []
        const best = new Map<string, number>()
        for (const entry of (res.data?.moves ?? []) as any[]) {
            const name = entry.move?.name
            if (!name) continue
            for (const detail of entry.version_group_details ?? []) {
                if (detail.move_learn_method?.name !== 'level-up') continue
                const at = Number(detail.level_learned_at ?? 0)
                if (at <= 0) continue
                if (!best.has(name) || at < (best.get(name) ?? Infinity)) best.set(name, at)
            }
        }
        const list = [...best.entries()].map(([move, at]) => ({ move, at })).sort((a, b) => a.at - b.at || a.move.localeCompare(b.move))
        levelMoveCache.set(dexId, list)
        return list
    } catch {
        return []
    }
}

export const prettyMove = (move: string): string =>
    move
        .split('-')
        .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
        .join(' ')

/**
 * Newest level-up move this species can know at `level` that the pokemon does
 * not already have. Machine/tutor moves stay out; null means nothing new.
 */
export async function moveForLevel(dexId: number, level: number, known: string[]): Promise<string | null> {
    try {
        const res = await axios.get(`${API}/pokemon/${dexId}`, { timeout: TIMEOUT, validateStatus: () => true })
        const moves: Array<{ move?: { name?: string }; version_group_details?: Array<{ level_learned_at?: number }> }> =
            res.data?.moves ?? []

        const options: Array<{ move: string; at: number }> = []
        for (const entry of moves) {
            const name = entry.move?.name
            if (!name) continue
            for (const detail of entry.version_group_details ?? []) {
                const at = Number(detail.level_learned_at ?? 0)
                if (at > 0 && at <= level) options.push({ move: name, at })
            }
        }

        options.sort((a, b) => b.at - a.at)
        return options.find((option) => !known.includes(option.move))?.move ?? null
    } catch {
        return null
    }
}

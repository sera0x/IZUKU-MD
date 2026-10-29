import { fetchMalArt } from './haigusha-art.js'

// Haigusha spawns from AniList's top 100 favourited characters that have a known
// age and source anime. Nothing is stored until someone marries them.
export interface HaiguShaCharacter {
    name: string
    nameKanji: string
    series: string
    gender: string
    about: string
    imageUrl: string
    anilistId: number
    age: string
    seriesEn: string
    nameAlts: string[]
    malImage: string
}


interface AniListCharacter {
    id: number
    name?: { full?: string | null; native?: string | null; alternative?: Array<string | null> | null }
    gender?: string | null
    description?: string | null
    image?: { large?: string | null }
    age?: string | null
    media?: { nodes?: Array<{ title?: { romaji?: string | null; english?: string | null } }> }
}


const clean = (value: string | undefined | null, max = 700): string => {
    if (!value) return ''
    const stripped = value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+|www\.\S+/gi, '')
        .replace(/\(([^)]*)\)\s*\(?(Written by|Source)[^)]*\)?/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    return stripped.length > max ? stripped.slice(0, max - 1).trimEnd() + '\u2026' : stripped
}

// Spawn pool: AniList's top 100 favourited characters (pages 1-4 of 25),
// keeping only those with a known age AND a known source anime. The filtered
// pool is cached for 6 hours so spawns don't hit AniList on every roll.
const PAGE_SIZE = 25
const TOP_PAGES = 4
const POOL_TTL = 6 * 60 * 60_000
let poolCache: { at: number; list: HaiguShaCharacter[] } | null = null

const QUERY = `query ($page: Int) {
    Page(page: $page, perPage: ${PAGE_SIZE}) {
        characters(sort: FAVOURITES_DESC) {
            id
            name { full native alternative }
            gender
            description
            image { large }
            favourites
            age
            media(perPage: 1, type: ANIME) { nodes { title { romaji english } } }
        }
    }
}`

async function fetchTopPool(): Promise<HaiguShaCharacter[]> {
    if (poolCache && Date.now() - poolCache.at < POOL_TTL && poolCache.list.length) return poolCache.list
    const pages = Array.from({ length: TOP_PAGES }, (_, i) => i + 1)
    const results = await Promise.all(
        pages.map(async (page) => {
            try {
                const response = await fetch('https://graphql.anilist.co', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: QUERY, variables: { page } }),
                    signal: AbortSignal.timeout(12000),
                })
                if (!response.ok) return [] as AniListCharacter[]
                const payload = (await response.json()) as {
                    data?: { Page?: { characters?: AniListCharacter[] } }
                }
                return payload.data?.Page?.characters ?? []
            } catch {
                return [] as AniListCharacter[]
            }
        }),
    )
    const list: HaiguShaCharacter[] = []
    for (const pick of results.flat()) {
        const imageUrl = pick.image?.large ?? ''
        const series = pick.media?.nodes?.[0]?.title?.romaji?.trim() ?? ''
        const seriesEn = pick.media?.nodes?.[0]?.title?.english?.trim() ?? ''
        const nameAlts = (pick.name?.alternative ?? []).filter((a): a is string => !!a)
        const age = typeof pick.age === 'string' ? pick.age.trim() : ''
        if (!pick.name?.full || !imageUrl || !age || !series) continue
        list.push({
            name: pick.name.full,
            nameKanji: pick.name.native ?? '',
            series,
            gender: pick.gender ?? 'unknown',
            age,
            about: clean(pick.description),
            imageUrl,
            anilistId: pick.id,
            seriesEn,
            nameAlts,
            malImage: '',
        })
    }
    // Keep only characters that have a confident MAL 1000x1400 image, so every
    // spawn is imaged and no AniList image is ever sent.
    // A character only stays in the pool when its MAL art actually downloads (size-checked, and the
    // lookup is year-verified for titled series). Spawns then always have an image; the frame
    // source is used on top of this when it resolves, and MAL is the guaranteed fallback.
    const imaged: HaiguShaCharacter[] = []
    for (let i = 0; i < list.length; i += 6) {
        const batch = list.slice(i, i + 6)
        const arts = await Promise.all(
            batch.map((c) => fetchMalArt(c.name, c.series, c.seriesEn, c.nameKanji, c.nameAlts).catch(() => null)),
        )
        batch.forEach((c, j) => {
            // MAL art or nothing: spawns are always clean official character art.
            if (arts[j]) imaged.push({ ...c, malImage: '' })
        })
    }
    if (imaged.length) poolCache = { at: Date.now(), list: imaged }
    return imaged
}

export async function fetchRandomCharacter(): Promise<HaiguShaCharacter | null> {
    try {
        const list = await fetchTopPool()
        if (!list.length) return null
        return list[Math.floor(Math.random() * list.length)] ?? null
    } catch {
        return null
    }
}

// One live spawn per chat, 3-minute claim window. Whoever replies .marry
// first takes it; the state lives here so both command files share it.
const spawns = new Map<string, { character: HaiguShaCharacter; at: number }>()
const SPAWN_TTL = 3 * 60_000

export function setSpawn(chat: string, character: HaiguShaCharacter): void {
    spawns.set(chat, { character, at: Date.now() })
}

export function takeSpawn(chat: string): HaiguShaCharacter | null {
    const entry = spawns.get(chat)
    if (!entry) return null
    spawns.delete(chat)
    if (Date.now() - entry.at > SPAWN_TTL) return null
    return entry.character
}

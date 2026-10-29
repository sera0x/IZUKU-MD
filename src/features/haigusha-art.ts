// Spawn art: MyAnimeList character art only (cdn.myanimelist.net /r/1000x1400).
// AniList images are never sent. A character is only in the spawn pool when MAL
// art resolves for it (see haigusha.ts), so spawns are always imaged.
import { promises as fs } from 'node:fs'
import path from 'node:path'

const UA = 'Mozilla/5.0'
const MAX_BYTES = 6_000_000
const MIN_MAL_BYTES = 20_000
const MAL_CACHE_FILE = path.resolve('data/haigusha-mal-map-v2.json')
const MAL_IMG_PREFIX = 'https://cdn.myanimelist.net/images/characters/'

export type MalEntry = { url: string | null; malId?: number; malName?: string; at: number }
let malCache: Record<string, MalEntry> | null = null

async function loadMalCache(): Promise<Record<string, MalEntry>> {
    if (malCache) return malCache
    try {
        malCache = JSON.parse(await fs.readFile(MAL_CACHE_FILE, 'utf8'))
    } catch {
        malCache = {}
    }
    return malCache!
}

async function saveMalCache(): Promise<void> {
    if (!malCache) return
    await fs.mkdir(path.dirname(MAL_CACHE_FILE), { recursive: true })
    await fs.writeFile(MAL_CACHE_FILE, JSON.stringify(malCache, null, 2))
}

// Normalise: strip accents, lowercase, collapse punctuation (Jin-U -> jin u, Hunter×Hunter -> hunter hunter)
export const norm = (s: string): string =>
    s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const toks = (s: string): string[] => norm(s).split(' ').filter(Boolean)
// Order-insensitive name key: "Gojou, Satoru" and "Satoru Gojou" both give "gojou satoru".
// Drops "nickname" quotes and (parenthesised) suffixes that MAL adds.
const nameKey = (s: string): string =>
    toks(s.replace(/"[^"]*"/g, ' ').replace(/\([^)]*\)/g, ' ')).sort().join(' ')

// Name forms to try against MAL search: as-is, reversed, first/last token, native, alternatives.
export function nameVariants(name: string, native = '', alternatives: string[] = []): string[] {
    const base = name.replace(/\([^)]*\)/g, '').trim()
    const parts = base.split(/\s+/).filter(Boolean)
    const out = new Set<string>([base])
    if (parts.length >= 2) {
        out.add(parts.slice().reverse().join(' '))
        out.add(parts[0]!)
        out.add(parts[parts.length - 1]!)
    }
    if (native) out.add(native)
    for (const a of alternatives) if (a && a.length < 40) out.add(a)
    return [...out].filter(Boolean)
}

// Series match: exact, substring either way (for > 3 chars), or >= 60% token overlap
// with at least two shared tokens. Covers "HUNTER×HUNTER" vs "Hunter x Hunter".
// A release year in an AniList title, e.g. "JoJo no Kimyou na Bouken (2000)", is an identity
// marker: a MAL work must carry that year and the stripped title, otherwise token overlap pulls
// in sibling parts (JoJo Part 2 / Part 3 for the 2000 listing).
const yearOf = (x: string): string => ((x.match(/\((\d{4})\)/) ?? [])[1]) ?? ''
const stripYear = (x: string): string => x.replace(/\(\d{4}\)/g, ' ')

export function seriesMatches(works: string[], series: string, seriesEn = ''): boolean {
    const year = yearOf(series) || yearOf(seriesEn)
    if (year) {
        const base = norm(stripYear(series)) || norm(stripYear(seriesEn))
        return works.some((w) => {
            const nw = norm(w)
            return nw.split(' ').includes(year) && nw.includes(base)
        })
    }
    const targets = [series, seriesEn].filter(Boolean).map(norm).filter(Boolean)
    return works.map(norm).some((w) =>
        targets.some((t) => {
            if (w === t) return true
            if (t.length > 3 && (w.includes(t) || t.includes(w))) return true
            const tt = new Set(t.split(' '))
            const wt = w.split(' ')
            const common = wt.filter((x) => tt.has(x)).length
            return common >= 2 && common / tt.size >= 0.6
        }),
    )
}

export function nameMatches(malName: string, name: string, native = '', alternatives: string[] = []): boolean {
    const key = nameKey(malName)
    if (!key) return false
    if (nameKey(name) === key) return true
    return nameVariants(name, native, alternatives).some((v) => nameKey(v) === key)
}

type MalItem = { id: number; name: string; image_url?: string; payload?: { related_works?: string[] } }

async function malSearch(keyword: string): Promise<MalItem[] | null> {
    try {
        const res = await fetch(
            'https://myanimelist.net/search/prefix.json?type=character&v=1&keyword=' + encodeURIComponent(keyword),
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) },
        )
        if (!res.ok) return null
        const json = (await res.json()) as any
        return (json?.categories?.[0]?.items ?? []) as MalItem[]
    } catch {
        return null
    }
}

// Resolve MAL art for one character. Tries name variants, then "name series" as a fallback
// query. Confident only when name key and series both match a MAL entry with a character image.
export async function malLookup(name: string, series: string, seriesEn = '', native = '', alternatives: string[] = []): Promise<MalEntry> {
    const cache = await loadMalCache()
    const key = `${norm(name)}|${norm(series)}`
    const cached = cache[key]
    if (cached) return cached

    const seen = new Map<number, MalItem>()
    const matching = () =>
        [...seen.values()].filter(
            (it) =>
                nameMatches(it.name ?? '', name, native, alternatives) &&
                seriesMatches(it.payload?.related_works ?? [], series, seriesEn) &&
                (it.image_url ?? '').startsWith(MAL_IMG_PREFIX),
        )

    const queries = [...nameVariants(name, native, alternatives), `${name} ${series}`]
    let transient = false
    for (const q of queries) {
        const items = await malSearch(q)
        if (items === null) {
            transient = true
            continue
        }
        for (const it of items.slice(0, 8)) if (!seen.has(it.id)) seen.set(it.id, it)
        if (matching().length) break
    }
    // Transient network failure with nothing found: don't cache the miss.
    if (transient && !matching().length) return { url: null, at: Date.now() }

    const hit = matching()[0]
    const entry: MalEntry = hit
        ? {
              url: (hit.image_url as string).replace(
                  'https://cdn.myanimelist.net/images/',
                  'https://cdn.myanimelist.net/r/1000x1400/images/',
              ),
              malId: hit.id,
              malName: hit.name,
              at: Date.now(),
          }
        : { url: null, at: Date.now() }
    cache[key] = entry
    await saveMalCache()
    return entry
}

// Downloads the MAL 1000x1400 image. Returns null when there is none; there is no fallback.
export async function fetchMalArt(name: string, series: string, seriesEn = '', native = '', alternatives: string[] = []): Promise<Buffer | null> {
    const entry = await malLookup(name, series, seriesEn, native, alternatives)
    if (!entry.url) return null
    try {
        const res = await fetch(entry.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return null
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length < MIN_MAL_BYTES || buf.length > MAX_BYTES) return null
        return buf
    } catch {
        return null
    }
}

import axiosRaw from 'axios'
import { metaContent, metaText } from './imgur.js'
const axios = axiosRaw as any

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const unescapeUrl = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined
    const url = raw
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim()
    return /^https?:\/\//i.test(url) ? url : undefined
}

const firstMatch = (html: string, patterns: RegExp[]): string | undefined => {
    for (const pattern of patterns) {
        const match = pattern.exec(html)
        if (match?.[1]) return unescapeUrl(match[1])
    }
    return undefined
}

const QUALITY_ORDER = ['720p', '480p', '360p', '240p']

function rankMp4(url: string): number {
    const lower = url.toLowerCase()
    if (lower.includes('hevc') || lower.includes('h265') || lower.includes('.m3u8') || lower.includes('.mpd')) return -1
    for (let i = 0; i < QUALITY_ORDER.length; i++) {
        if (lower.includes(`/${QUALITY_ORDER[i]}/`)) return QUALITY_ORDER.length - i
    }
    if (lower.includes('/mc/')) return 1
    return 2
}

function collectVideos(html: string): string[] {
    const scoped = new Set<string>()
    const blob = /"videoUrls"\s*:\s*(\[[\s\S]*?\])/.exec(html)
    if (blob?.[1]) {
        try {
            const list = JSON.parse(blob[1])
            for (const entry of Array.isArray(list) ? list : []) {
                const url = unescapeUrl(typeof entry === 'string' ? entry : entry?.url)
                if (url) scoped.add(url)
            }
        } catch {
            null
        }
    }

    const urls = new Set(scoped)
    if (urls.size === 0) {
        for (const match of html.matchAll(/https?:\/\/[^"'\\\s]+?\.mp4[^"'\\\s]*/g)) {
            const url = unescapeUrl(match[0])
            if (url) urls.add(url)
        }
    }

    return [...urls].filter((url) => rankMp4(url) >= 0).sort((a, b) => rankMp4(b) - rankMp4(a))
}

function collectImages(html: string): string[] {
    const urls: string[] = []
    const add = (raw: string | undefined): void => {
        const url = unescapeUrl(raw)
        if (url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) && !urls.includes(url)) urls.push(url)
    }

    for (const match of html.matchAll(/"orig"\s*:\s*\{[^}]*?"url"\s*:\s*"([^"]+)"/g)) add(match[1])
    add(metaContent(html, 'og:image'))
    add(metaContent(html, 'og:image:secure_url'))
    for (const match of html.matchAll(/"image_url"\s*:\s*"([^"]+)"/g)) add(match[1])

    return urls
}

function bestImage(url: string): string {
    return url.replace(/i\.pinimg\.com\/(?:\d+x\d*|736x|564x|originals)\//, 'i.pinimg.com/originals/')
}

export interface PinHit {
    url: string
    title?: string
    pin?: string
}

function bingHits(html: string, limit: number): PinHit[] {
    const hits: PinHit[] = []
    const seen = new Set<string>()
    const push = (image: string, pin: string | undefined, title: string | undefined): void => {
        const url = unescapeUrl(image)
        if (!url || hits.length >= limit) return
        const key = pin ?? url
        if (seen.has(key)) return
        seen.add(key)
        hits.push({ url, pin, title: title?.replace(/[\uE000-\uF8FF]/g, '').trim() || undefined })
    }

    for (const match of html.matchAll(/m="([^"]*)"/g)) {
        const raw = match[1]!
        if (!raw.includes('pinterest')) continue
        const decoded = raw
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
        try {
            const data = JSON.parse(decoded) as { purl?: string; murl?: string; t?: string }
            if (!data.purl || !data.murl) continue
            if (!/pinterest\./i.test(data.purl)) continue
            push(data.murl.replace(/\\\//g, '/'), data.purl.replace(/\\\//g, '/'), data.t)
        } catch {
            continue
        }
    }

    if (hits.length < limit) {
        for (const match of html.matchAll(/(?:murl&quot;:&quot;|"murl":")(https?:[^"&\\]+)/g)) {
            const url = match[1]!
            if (!/i\.pinimg\.com/i.test(url)) continue
            push(url, undefined, undefined)
        }
    }

    return hits.slice(0, limit)
}

export async function pinterestSearch(query: string, limit = 5): Promise<PinHit[]> {
    const response = await axios.get('https://www.bing.com/images/search', {
        params: { q: `site:pinterest.com ${query}`, form: 'HDRSC2', first: 1 },
        headers: { 'User-Agent': UA, accept: 'text/html,application/xhtml+xml' },
        timeout: 25_000,
    })

    const html = String(response.data ?? '')
    const hits = bingHits(html, limit)

    if (!hits.length) {
        const fallback = await axios.get('https://www.bing.com/images/search', {
            params: { q: `pinterest ${query}`, form: 'HDRSC2', first: 1 },
            headers: { 'User-Agent': UA, accept: 'text/html,application/xhtml+xml' },
            timeout: 25_000,
        })
        hits.push(...bingHits(String(fallback.data ?? ''), limit))
    }

    return hits.map((hit) => ({ ...hit, url: bestImage(hit.url) }))
}

export async function pinterestDl(url: string) {
    const response = await axios.get(url, {
        headers: {
            'User-Agent': UA,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9',
        },
        timeout: 30_000,
        maxRedirects: 5,
    })
    const html = String(response.data ?? '')
    if (html.length < 200) throw new Error('Pinterest returned an empty page')

    const title = metaText(html, 'og:title')
    const description = metaText(html, 'og:description') ?? metaText(html, 'description')
    const details = description && description !== title ? description.slice(0, 400) : ''
    const caption = ['*Pinterest*', title ? title.slice(0, 200) : '', details].filter(Boolean).join('\n')

    const videos = collectVideos(html)
    if (videos.length > 0) return { url: videos[0]!, type: 'video', caption }

    const images = collectImages(html)
    if (images.length > 0) {
        const items = images.slice(0, 5).map((image) => ({ url: bestImage(image), type: 'image' }))
        return { items, url: items[0]!.url, type: 'image', caption }
    }

    const direct = firstMatch(html, [
        /"image_url"\s*:\s*"([^"]+)"/,
        /https:\/\/i\.pinimg\.com\/[^"'\\\s]+\.(?:jpe?g|png|webp)/,
    ])
    if (direct) return { url: bestImage(direct), type: 'image', caption }

    throw new Error('No downloadable media in that pin')
}

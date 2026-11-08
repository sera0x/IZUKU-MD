

import axiosRaw from 'axios'
import { metaContent } from './imgur.js'
const axios = axiosRaw as any

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const unescapeUrl = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined
    const url = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&')
    return /^https?:\/\//i.test(url) ? url : undefined
}

const firstMatch = (html: string, patterns: RegExp[]): string | undefined => {
    for (const pattern of patterns) {
        const match = pattern.exec(html)
        if (match?.[1]) return unescapeUrl(match[1])
    }
    return undefined
}

export interface PinHit {
    url: string
    title?: string
    pin?: string
}

export async function pinterestSearch(query: string, limit = 5): Promise<PinHit[]> {
    const data = {
        options: { query, scope: 'pins', page: null, bookmarks: [] as string[] },
        context: {},
    }
    const url =
        'https://www.pinterest.com/resource/BaseSearchResource/get/' +
        '?source_url=' +
        encodeURIComponent(`/search/pins/?q=${query}`) +
        '&data=' +
        encodeURIComponent(JSON.stringify(data))

    const response = await axios.get(url, {
        headers: { 'User-Agent': UA, accept: 'application/json, text/plain, */*', 'x-app-version': '2b0b0b0' },
        timeout: 25_000,
    })

    const payload = response.data ?? {}
    const results: any[] =
        payload?.resource_response?.data?.results ??
        payload?.resource_response?.data?.pins ??
        payload?.data?.results ??
        []

    const hits: PinHit[] = []
    for (const pin of Array.isArray(results) ? results : []) {
        const raw = pin?.images?.orig?.url ?? pin?.images?.['736x']?.url ?? pin?.image ?? pin?.images?.orig
        const image = unescapeUrl(typeof raw === 'string' ? raw : undefined)
        if (!image) continue
        const id = pin?.id ? `https://www.pinterest.com/pin/${pin.id}/` : undefined
        hits.push({ url: image, title: typeof pin?.title === 'string' ? pin.title : undefined, pin: id })
        if (hits.length >= limit) break
    }
    return hits
}

export async function pinterestDl(url: string) {
    const response = await axios.get(url, {
        headers: { 'User-Agent': UA, accept: 'text/html,application/xhtml+xml' },
        timeout: 30_000,
        maxRedirects: 5,
    })
    const html = String(response.data ?? '')
    if (html.length < 200) throw new Error('Pinterest returned an empty page')

    const title = metaContent(html, 'og:title')
    const caption = ['*Pinterest*', title ? title.slice(0, 200) : ''].filter(Boolean).join('\n')

    const video = metaContent(html, 'og:video') ?? firstMatch(html, [/"video_url":"([^"]+)"/])
    if (video) return { url: video, type: 'video', caption }

    const image =
        firstMatch(html, [/:\{"orig":\{"url":"([^"]+)"/]) ??
        metaContent(html, 'og:image') ??
        firstMatch(html, [/"image_url":"([^"]+)"/])
    if (image) return { url: image, type: 'image', caption }

    throw new Error('No downloadable media in that pin')
}

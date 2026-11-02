// Imgur downloader: the post page carries the direct file in its meta tags, so
// one HTML fetch is enough. Attribute order varies between pages, so both
// orders are checked.

import axiosRaw from 'axios'
const axios = axiosRaw as any

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** `content` on a meta tag, whatever order the attributes come in. */
export function metaContent(html: string, property: string): string | undefined {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
    ]
    for (const pattern of patterns) {
        const value = pattern.exec(html)?.[1]?.replace(/&amp;/g, '&')
        if (value && /^https?:\/\//i.test(value)) return value
    }
    return undefined
}

export async function imgurDl(url: string) {
    const response = await axios.get(url, {
        headers: { 'User-Agent': UA, accept: 'text/html' },
        timeout: 30_000,
    })
    const html = String(response.data ?? '')
    if (html.length < 200) throw new Error('Imgur returned an empty page')

    const rawTitle = metaContent(html, 'og:title')
    const caption = ['*Imgur*', rawTitle ? rawTitle.slice(0, 200) : ''].filter(Boolean).join('\n')

    // Gif pages expose the .gif itself; Imgur serves the same id as .mp4, which
    // is the only form WhatsApp will play inline.
    const raw = metaContent(html, 'og:video') ?? metaContent(html, 'twitter:player:stream')
    const video = raw?.replace(/\.gif(v)?$/i, '.mp4')
    if (video) return { url: video, type: 'video', caption }

    const image = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image')
    if (image) return { url: image, type: 'image', caption }

    throw new Error('No downloadable media on that Imgur page')
}

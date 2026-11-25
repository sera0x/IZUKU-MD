import { readFile, rm } from 'node:fs/promises'
import axiosRaw from 'axios'
const axios = axiosRaw as any
import { ari } from '../../bot/registry.js'
import { searchYoutube, youtubeDl } from '../../features/scrapers/youtube.js'
import { facebookDl } from '../../features/scrapers/facebook.js'
import { instagramDl } from '../../features/scrapers/instagram.js'
import { twitterDl } from '../../features/scrapers/twitter.js'
import { pinterestDl, pinterestSearch } from '../../features/scrapers/pinterest.js'
import { imgurDl } from '../../features/scrapers/imgur.js'

const MAX_BYTES = 64 * 1024 * 1024
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

interface MediaItem {
    url: string
    type?: string
}

interface Scraped {
    url?: string
    type?: string
    caption?: string | null
    title?: string | null
    items?: MediaItem[]
}

function sniff(buffer: Buffer): 'image' | 'video' | null {
    if (buffer.length < 12) return null
    if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') return 'video'
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video'
    if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && (buffer[3] === 0xba || buffer[3] === 0xb3)) {
        return 'video'
    }
    const head = buffer.subarray(0, 12).toString('latin1')
    if (head.startsWith('GIF8')) return 'image'
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image'
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image'
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image'
    if (head.startsWith('BM')) return 'image'
    return null
}

function imageMime(buffer: Buffer): string {
    const head = buffer.subarray(0, 12).toString('latin1')
    if (head.startsWith('GIF8')) return 'image/gif'
    if (head.startsWith('RIFF')) return 'image/webp'
    if (buffer[0] === 0x89) return 'image/png'
    return 'image/jpeg'
}

async function download(url: string): Promise<{ buffer: Buffer; kind: 'image' | 'video' }> {
    if (url.startsWith('file://')) {
        const path = decodeURIComponent(url.slice('file://'.length))
        try {
            const buffer = await readFile(path)
            if (buffer.length > MAX_BYTES) throw new Error('the file is larger than 64 MB')
            const kind = sniff(buffer)
            if (!kind) throw new Error('unsupported media format')
            return { buffer, kind }
        } finally {
            await rm(path, { force: true })
        }
    }

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 90_000,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        headers: { 'User-Agent': UA, Accept: '*/*' },
        validateStatus: (status: number) => status >= 200 && status < 300,
    })

    const buffer = Buffer.from(response.data)
    const contentType = String(response.headers['content-type'] ?? '')
    if (/text\/html/i.test(contentType) || buffer.subarray(0, 200).toString('latin1').includes('<html')) {
        throw new Error('the link returned a web page instead of a media file')
    }
    if (buffer.length > MAX_BYTES) throw new Error('the file is larger than 64 MB')

    const kind = sniff(buffer)
    if (!kind) throw new Error(`unsupported media format${contentType ? ` (${contentType.split(';')[0]})` : ''}`)
    return { buffer, kind }
}

export async function sendMedia(ctx: any, scraped: Scraped): Promise<void> {
    const items: MediaItem[] = scraped.items?.length ? scraped.items : [{ url: scraped.url ?? '', type: scraped.type }]
    const caption = String(scraped.caption ?? scraped.title ?? '').trim().slice(0, 1024) || undefined

    let sent = 0
    let failure: string | undefined

    for (const [index, item] of items.entries()) {
        if (!item?.url) continue
        try {
            const { buffer, kind } = await download(item.url)

            if (kind === 'video') {
                await ctx.sock.sendMessage(
                    ctx.chat,
                    { video: buffer, mimetype: 'video/mp4' },
                    { quoted: index === 0 ? ctx.msg : undefined },
                )
            } else {
                await ctx.sock.sendMessage(
                    ctx.chat,
                    { image: buffer, mimetype: imageMime(buffer) },
                    { quoted: index === 0 ? ctx.msg : undefined },
                )
            }
            sent++
        } catch (error: any) {
            failure = failure ?? String(error?.message ?? error)
        }
    }

    if (sent === 0) throw new Error(failure ?? 'no media URL in scrape result')

    if (caption) await ctx.sock.sendMessage(ctx.chat, { text: caption }, { quoted: ctx.msg })

    if (failure && sent < items.length) {
        await ctx.reply(`⚠️ Sent ${sent} of ${items.length}. One file failed: ${failure.slice(0, 120)}`)
    }
}

function makeDownloader(
    name: string,
    hosts: string[],
    fn: (url: string) => Promise<Scraped>,
    aliases: string[] = [],
    search?: (query: string) => Promise<string>,
) {
    ari({
        name,
        description: 'Download media from ' + hosts.join(' / ') + (search ? ', or search when given words' : ''),
        category: 'media',
        aliases,
        usage: name + (search ? ' <link or search words>' : ' <link>'),
        cooldownMs: 5000,
        run: async (ctx) => {
            const input = ctx.args.join(' ').trim()
            if (!input) {
                await ctx.reply('Usage: ' + ctx.prefix + name + ' <link> 🛑')
                return
            }
            const isLink = /^https?:\/\//i.test(input)
            if (!isLink && !search) {
                await ctx.reply('Usage: ' + ctx.prefix + name + ' <link> 🛑')
                return
            }
            if (isLink && !hosts.some((host) => input.includes(host))) {
                await ctx.reply('That is not a ' + hosts[0] + ' link. 🛑')
                return
            }
            const target = isLink ? input : await search!(input)
            const scraped = await fn(target)
            await sendMedia(ctx, scraped)
        },
    })
}

makeDownloader('youtube', ['youtu'], youtubeDl, ['ytdl', 'yt'], searchYoutube)
makeDownloader('facebook', ['facebook.com', 'fb.watch', 'fb.com'], facebookDl, ['fbdl', 'fb'])
makeDownloader('instagram', ['instagram.com'], instagramDl, ['igdl', 'ig'])
makeDownloader('twitter', ['twitter.com', 'x.com'], twitterDl, ['twdl', 'tw', 'xdl'])
makeDownloader('imgur', ['imgur.com', 'imgur.io'], imgurDl, ['im'])

ari({
    name: 'pinterest',
    description: 'Download a Pinterest pin, or search Pinterest when given words',
    category: 'media',
    aliases: ['pindl', 'pint'],
    usage: 'pindl <link> | pindl <search words>',
    cooldownMs: 5000,
    run: async (ctx) => {
        const input = ctx.args.join(' ').trim()
        if (!input) {
            await ctx.reply(`Usage: ${ctx.prefix}pinterest <link or search words> 🛑`)
            return
        }

        const isLink = /^https?:\/\//i.test(input)
        if (isLink) {
            if (!/pinterest\.|pin\.it/i.test(input)) {
                await ctx.reply('That link is not Pinterest. Use the matching downloader. 🛑')
                return
            }
            const scraped = await pinterestDl(input)
            await sendMedia(ctx, scraped)
            return
        }

        const hits = await pinterestSearch(input, 5)
        if (!hits.length) {
            await ctx.reply('No Pinterest results for that search. 🛑')
            return
        }

        const best = hits[0]!
        const rest = hits.slice(1)

        let scraped: Scraped
        if (best.pin) {
            try {
                const resolved = await pinterestDl(best.pin)
                scraped = { ...resolved, caption: [best.title ?? '', resolved.caption ?? ''].filter(Boolean).join('\n') }
            } catch {
                scraped = { url: best.url, type: 'image', caption: best.title }
            }
        } else {
            scraped = { url: best.url, type: 'image', caption: best.title }
        }

        const lines = [`🔎 *Pinterest — ${input}*`]
        if (rest.length) {
            lines.push('', '*More pins:*')
            for (const hit of rest) lines.push(`▸ ${hit.pin ?? hit.url}`)
        }
        const footer = lines.join('\n')
        scraped.caption = [scraped.caption ?? '', footer].filter(Boolean).join('\n\n')

        await sendMedia(ctx, scraped)
    },
})

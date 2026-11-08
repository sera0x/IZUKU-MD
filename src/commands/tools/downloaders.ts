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

interface Scraped {
    url?: string
    type?: string
    caption?: string | null
}

async function sendMedia(ctx: any, scraped: Scraped): Promise<void> {
    const url = scraped?.url
    if (!url) throw new Error('no media URL in scrape result')

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: MAX_BYTES,
    })
    const buffer = Buffer.from(response.data)
    const mimetype = (((response.headers['content-type'] as string | undefined) ?? '').split(';')[0] ?? '')

    if (scraped.type === 'image' || mimetype.startsWith('image/')) {
        await ctx.sock.sendMessage(ctx.chat, { image: buffer, caption: scraped.caption || undefined }, { quoted: ctx.msg })
        return
    }

    await ctx.sock.sendMessage(
        ctx.chat,
        { video: buffer, mimetype: mimetype || 'video/mp4', caption: scraped.caption || undefined },
        { quoted: ctx.msg },
    )
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
        const lines = [`🔎 *Pinterest — ${input}*`]
        if (rest.length) {
            lines.push('', '*More pins:*')
            for (const hit of rest) lines.push(`▸ ${hit.pin ?? hit.url}`)
        }
        await sendMedia(ctx, {
            url: best.url,
            type: 'image',
            caption: [best.title ?? '', ...lines].filter(Boolean).join('\n'),
        })
    },
})

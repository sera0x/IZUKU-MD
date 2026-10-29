import axiosRaw from 'axios'
const axios = axiosRaw as any
import { ari } from '../../bot/registry.js'
import { youtubeDl } from '../../features/scrapers/youtube.js'
import { facebookDl } from '../../features/scrapers/facebook.js'
import { instagramDl } from '../../features/scrapers/instagram.js'
import { twitterDl } from '../../features/scrapers/twitter.js'

// Downloaders ported from the asamake reference bot (itsdevmj/asamake).

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

function makeDownloader(name: string, hosts: string[], fn: (url: string) => Promise<Scraped>) {
    ari({
        name,
        description: 'Download media from ' + hosts.join(' / '),
        category: 'media',
        aliases: [],
        usage: name + ' <link>',
        cooldownMs: 5000,
        run: async (ctx) => {
            const target = (ctx.args[0] ?? '').trim()
            if (!target || !hosts.some((host) => target.includes(host))) {
                await ctx.reply('Usage: ' + ctx.prefix + name + ' <link> 🛑')
                return
            }
            const scraped = await fn(target)
            await sendMedia(ctx, scraped)
        },
    })
}

makeDownloader('ytdl', ['youtu'], youtubeDl)
makeDownloader('fbdl', ['facebook.com', 'fb.watch'], facebookDl)
makeDownloader('igdl', ['instagram.com'], instagramDl)
makeDownloader('twdl', ['twitter.com', 'x.com'], twitterDl)

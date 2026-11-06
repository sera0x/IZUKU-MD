import { ari } from '../../bot/registry.js'
import { convert, jidToNumber, toImage, toMp3, toMp4, toSticker } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetName, identityAliases } from '../../bot/group-utils.js'

const extensionFor = (mimetype: string): string => {
    if (mimetype.includes('jpeg')) return 'jpg'
    if (mimetype.includes('png')) return 'png'
    if (mimetype.includes('webp')) return 'webp'
    if (mimetype.includes('gif')) return 'gif'
    if (mimetype.includes('video')) return 'mp4'
    if (mimetype.includes('ogg')) return 'ogg'
    if (mimetype.includes('mpeg')) return 'mp3'
    return 'bin'
}

const NEED_MEDIA = 'Reply to an image, video or sticker. 🛑'

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

/** Refuse obvious local targets so the command cannot be pointed at the host. */
const blockedHost = (hostname: string): boolean => {
    const host = hostname.toLowerCase()
    return (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '0.0.0.0' ||
        host === '[::1]' ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
}

ari({
    name: 'sticker',
    description: 'Turn an image, video or gif into a sticker',
    category: 'media',
    aliases: ['s'],
    cooldownMs: 5000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media) {
            await ctx.reply(NEED_MEDIA)
            return
        }

        const animated = media.mimetype.includes('video') || media.mimetype.includes('gif')
        const buffer = await toSticker(media.buffer, extensionFor(media.mimetype), animated)
        await ctx.sock.sendMessage(ctx.chat, { sticker: buffer }, { quoted: ctx.msg })
    },
})

ari({
    name: 'toimg',
    description: 'Convert a sticker to a PNG image',
    category: 'media',
    aliases: ['tophoto'],
    cooldownMs: 5000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.includes('webp')) {
            await ctx.reply('Reply to a sticker. 🛑')
            return
        }

        const buffer = await toImage(media.buffer, 'webp')
        await ctx.sock.sendMessage(ctx.chat, { image: buffer }, { quoted: ctx.msg })
    },
})

ari({
    name: 'tomp3',
    description: 'Convert a video or voice note to mp3',
    category: 'media',
    aliases: ['toaudio'],
    cooldownMs: 8000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !(media.mimetype.includes('video') || media.mimetype.includes('audio'))) {
            await ctx.reply('Reply to a video or audio message. 🛑')
            return
        }

        const buffer = await toMp3(media.buffer, extensionFor(media.mimetype))
        await ctx.sock.sendMessage(ctx.chat, { audio: buffer, mimetype: 'audio/mpeg' }, { quoted: ctx.msg })
    },
})

ari({
    name: 'tovideo',
    description: 'Convert an animated sticker to mp4',
    category: 'media',
    aliases: ['tomp4'],
    cooldownMs: 8000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.includes('webp')) {
            await ctx.reply('Reply to a sticker. 🛑')
            return
        }

        const buffer = await toMp4(media.buffer, 'webp')
        await ctx.sock.sendMessage(ctx.chat, { video: buffer, mimetype: 'video/mp4' }, { quoted: ctx.msg })
    },
})

ari({
    name: 'togif',
    description: 'Turn a video or animated sticker into a looping gif',
    category: 'media',
    aliases: ['gif'],
    cooldownMs: 8000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !(media.mimetype.includes('video') || media.mimetype.includes('webp'))) {
            await ctx.reply('Reply to a video or an animated sticker. 🛑')
            return
        }

        const buffer = await toMp4(media.buffer, extensionFor(media.mimetype))
        await ctx.sock.sendMessage(
            ctx.chat,
            { video: buffer, mimetype: 'video/mp4', gifPlayback: true },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'compress',
    description: 'Shrink a video so it fits through WhatsApp',
    category: 'media',
    cooldownMs: 8000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.includes('video')) {
            await ctx.reply('Reply to a video. 🛑')
            return
        }

        const buffer = await convert(media.buffer, extensionFor(media.mimetype), 'mp4', [
            '-vf',
            'scale=-2:480',
            '-crf',
            '32',
            '-preset',
            'veryfast',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            'faststart',
            '-an',
        ])

        const saved = Math.max(0, Math.round((1 - buffer.length / media.buffer.length) * 100))
        await ctx.sock.sendMessage(
            ctx.chat,
            { video: buffer, mimetype: 'video/mp4', caption: `Compressed (${saved}% smaller) 🗜️` },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'dl',
    description: 'Download a file from a direct link',
    category: 'media',
    aliases: ['download', 'get'],
    usage: 'dl https://example.com/file.mp4',
    cooldownMs: 5000,
    run: async (ctx) => {
        const target = (ctx.args[0] ?? '').trim()
        let url: URL
        try {
            url = new URL(target)
        } catch {
            await ctx.reply(`Usage: ${ctx.prefix}dl https://example.com/file.mp4`)
            return
        }

        if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) {
            await ctx.reply('That link is not allowed. 🛑')
            return
        }

        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(30_000),
                headers: { 'user-agent': 'IZUKU-MD' },
            })
            if (!response.ok) throw new Error(`request failed (${response.status})`)

            const declared = Number(response.headers.get('content-length') ?? 0)
            if (declared > MAX_DOWNLOAD_BYTES) {
                await ctx.reply('That file is too large (limit 64 MB). 🛑')
                return
            }

            const buffer = Buffer.from(await response.arrayBuffer())
            if (buffer.length === 0) throw new Error('empty response')
            if (buffer.length > MAX_DOWNLOAD_BYTES) {
                await ctx.reply('That file is too large (limit 64 MB). 🛑')
                return
            }

            const mimetype = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
            const filename = decodeURIComponent(url.pathname.split('/').pop() ?? '') || 'file'

            if (mimetype.startsWith('image/')) {
                await ctx.sock.sendMessage(ctx.chat, { image: buffer, mimetype }, { quoted: ctx.msg })
                return
            }
            if (mimetype.startsWith('video/')) {
                await ctx.sock.sendMessage(ctx.chat, { video: buffer, mimetype }, { quoted: ctx.msg })
                return
            }
            if (mimetype.startsWith('audio/')) {
                await ctx.sock.sendMessage(ctx.chat, { audio: buffer, mimetype }, { quoted: ctx.msg })
                return
            }

            await ctx.sock.sendMessage(
                ctx.chat,
                {
                    document: buffer,
                    mimetype: mimetype || 'application/octet-stream',
                    fileName: filename,
                },
                { quoted: ctx.msg },
            )
        } catch (error) {
            await ctx.reply(`Download failed: ${(error as Error).message} 🛑`)
        }
    },
})

interface TikwmData {
    title?: string
    play?: string
    hdplay?: string
    wmplay?: string
    images?: string[]
    music?: string
    duration?: number
    author?: { unique_id?: string; nickname?: string }
}

/** tikwm returns relative media paths (".../file.mp4") as well as absolute ones. */
const absoluteMedia = (path: string | undefined): string | undefined => {
    if (!path) return undefined
    if (/^https?:\/\//i.test(path)) return path
    return `https://www.tikwm.com${path.startsWith('/') ? '' : '/'}${path}`
}

async function fetchMedia(url: string, limit = MAX_DOWNLOAD_BYTES): Promise<Buffer | null> {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(45_000),
            headers: { 'user-agent': 'IZUKU-MD', accept: '*/*' },
        })
        if (!response.ok) return null
        const buffer = Buffer.from(await response.arrayBuffer())
        return buffer.length && buffer.length <= limit ? buffer : null
    } catch {
        return null
    }
}

ari({
    name: 'tiktok',
    description: 'Download a TikTok video or photo slideshow (no watermark)',
    category: 'media',
    aliases: ['tt', 'ttdl', 'tikwm'],
    usage: 'tiktok <link>',
    cooldownMs: 10_000,
    run: async (ctx) => {
        const input = (ctx.args[0] ?? '').trim()
        let url: URL
        try {
            url = new URL(input)
        } catch {
            await ctx.reply(
                ['*TikTok downloader*', `▸ *${ctx.prefix}tiktok https://vm.tiktok.com/xxxx*`, '▸ works with vm., vt. and full links'].join('\n'),
            )
            return
        }

        if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
            await ctx.reply('That is not a TikTok link 🤷')
            return
        }

        let data: TikwmData | undefined
        try {
            const endpoint = new URL('https://www.tikwm.com/api/')
            endpoint.searchParams.set('url', url.toString())
            endpoint.searchParams.set('hd', '1')
            const response = await fetch(endpoint, {
                signal: AbortSignal.timeout(30_000),
                headers: { 'user-agent': 'IZUKU-MD', accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`resolver ${response.status}`)
            const payload = (await response.json()) as { code?: number; msg?: string; data?: TikwmData }
            if (payload.code !== 0 || !payload.data) throw new Error(payload.msg || 'no data')
            data = payload.data
        } catch {
            await ctx.reply('Could not read that TikTok. It may be private or the resolver is down 🌧️')
            return
        }

        const author = data.author?.unique_id ? `@${data.author.unique_id}` : 'unknown creator'
        const title = (data.title ?? '').trim().slice(0, 200)
        const caption = ['*TikTok*', title ? `_${title}_` : '', `👤 ${author}`].filter(Boolean).join('\n')

        // Photo slideshows come back as an image list, not a video.
        const slides = (data.images ?? []).map(absoluteMedia).filter((src): src is string => Boolean(src))
        if (slides.length) {
            const shown = slides.slice(0, 5)
            for (const [index, slide] of shown.entries()) {
                const buffer = await fetchMedia(slide)
                if (!buffer) continue
                await ctx.sock.sendMessage(
                    ctx.chat,
                    { image: buffer, caption: index === 0 ? `${caption}\n🖼️ ${slides.length} photo(s)` : undefined },
                    { quoted: index === 0 ? ctx.msg : undefined },
                )
            }
            return
        }

        const videoUrl = absoluteMedia(data.hdplay) ?? absoluteMedia(data.play) ?? absoluteMedia(data.wmplay)
        if (!videoUrl) {
            await ctx.reply('No downloadable media in that post 🌧️')
            return
        }

        const video = await fetchMedia(videoUrl)
        if (!video) {
            await ctx.reply('The video was too big or expired. Try another link 🌧️')
            return
        }

        await ctx.sock.sendMessage(
            ctx.chat,
            { video, mimetype: 'video/mp4', caption },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'getpp',
    description: 'Show a profile picture',
    category: 'media',
    aliases: ['pp'],
    usage: 'getpp @user',
    run: async (ctx) => {
        const raw = resolveTarget(ctx) || ctx.sender

        const forms = [await normalizeTarget(ctx, raw), raw, ...(await identityAliases(ctx, raw))]
        const name = (await targetName(ctx, raw)) || jidToNumber(raw)
        let url: string | undefined
        for (const form of forms) {
            url = await ctx.sock.profilePictureUrl(form, 'image').catch(() => undefined)
            if (url) break
        }
        if (!url) {
            await ctx.reply(`*${name}* has no profile picture.`)
            return
        }
        await ctx.replyImage(url, `*${name}* ${jidToNumber(raw)}`)
    },
})


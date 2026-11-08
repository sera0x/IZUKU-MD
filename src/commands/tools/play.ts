import sharp from 'sharp'
import { ari } from '../../bot/registry.js'
import { downloadTrack, fmtDuration } from '../../features/music.js'

async function cardThumb(art: Buffer): Promise<Buffer | null> {
    try {

        return await sharp(art).resize(150, 150, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer()
    } catch {
        return null
    }
}

ari({
    name: 'play',
    description: 'Download a song from YouTube by name or link and send it as audio',
    category: 'media',
    aliases: ['song', 'ytmp3'],
    usage: 'play <song name or youtube url>',
    cooldownMs: 8000,
    run: async (ctx) => {
        const query = (ctx.args ?? []).join(' ').trim()
        if (!query) {
            await ctx.reply('usage: ' + ctx.prefix + 'play <song name or youtube url> 🛑')
            return
        }
        await ctx.reply('🔎 finding ' + query + '…')
        let track
        try {
            track = await downloadTrack(query)
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'failed'
            await ctx.reply('🛑 ' + reason)
            return
        }
        try {
            await ctx.sock.sendMessage(
                ctx.chat,
                { audio: track.buffer, mimetype: 'audio/mpeg', fileName: track.title + '.mp3', ptt: false },
                { quoted: ctx.msg },
            )
            const caption = '🎵 ' + track.title + ' · ' + track.artist + ' · ' + fmtDuration(track.duration)
            const thumbnail = track.thumb ? await cardThumb(track.thumb) : null
            if (thumbnail) {

                await ctx.sock.sendMessage(ctx.chat, {
                    text: caption,
                    contextInfo: {
                        externalAdReply: {
                            title: track.title,
                            body: track.artist + ' · ' + fmtDuration(track.duration),
                            mediaType: 1,
                            thumbnail,
                            sourceUrl: track.sourceUrl ?? 'https://www.youtube.com/',
                            renderLargerThumbnail: false,
                            showAdAttribution: false,
                        },
                    },
                })
            } else {
                await ctx.reply(caption)
            }
        } catch {
            await ctx.reply('🛑 send failed')
        } finally {
            await track.cleanup()
        }
    },
})

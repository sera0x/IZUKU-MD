import sharp from 'sharp'
import { ari } from '../../bot/registry.js'
import { downloadTrack, fmtDuration } from '../../features/music.js'

/**
 * Album art for the preview card. WhatsApp only renders an `externalAdReply`
 * card on text messages, so the cover goes on the caption line instead of the
 * image/audio messages (media carrying a card gets dropped).
 */
async function cardThumb(art: Buffer): Promise<Buffer | null> {
    try {
        return await sharp(art).resize(320, 320, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
    } catch {
        return null
    }
}

// .play <song name or youtube url>. Group gating is handled by the pipeline
// (no command runs in a group without an active .agb live), same as other tools.
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
            if (track.thumb) {
                // whatsapp audio messages have no cover-art field, so the thumbnail goes out as an image right before the audio
                await ctx.sock.sendMessage(ctx.chat, { image: track.thumb, caption: '🎵 ' + track.title }, { quoted: ctx.msg })
            }
            await ctx.sock.sendMessage(
                ctx.chat,
                { audio: track.buffer, mimetype: 'audio/mpeg', fileName: track.title + '.mp3', ptt: false },
                { quoted: ctx.msg },
            )
            const caption = '🎵 ' + track.title + ' · ' + track.artist + ' · ' + fmtDuration(track.duration)
            const thumbnail = track.thumb ? await cardThumb(track.thumb) : null
            if (thumbnail) {
                // Cover art inside the message's context info, like a link
                // preview. sourceUrl keeps the card tappable through to YouTube.
                await ctx.sock.sendMessage(ctx.chat, {
                    text: caption,
                    contextInfo: {
                        externalAdReply: {
                            title: track.title,
                            body: track.artist + ' · ' + fmtDuration(track.duration),
                            mediaType: 1,
                            thumbnail,
                            sourceUrl: track.sourceUrl ?? 'https://www.youtube.com/',
                            renderLargerThumbnail: true,
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

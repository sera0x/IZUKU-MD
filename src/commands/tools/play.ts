import { ari } from '../../bot/registry.js'
import { downloadTrack, fmtDuration } from '../../features/music.js'

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
            await ctx.reply('🎵 ' + track.title + ' · ' + track.artist + ' · ' + fmtDuration(track.duration))
        } catch {
            await ctx.reply('🛑 send failed')
        } finally {
            await track.cleanup()
        }
    },
})

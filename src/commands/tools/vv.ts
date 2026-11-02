import { ari } from '../../bot/registry.js'

ari({
    name: 'vv',
    description: 'Reveal a view-once image, video or audio message',
    category: 'tools',
    aliases: ['viewonce'],
    cooldownMs: 5000,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media) {
            await ctx.reply('Reply to a view-once message. 🛑')
            return
        }

        if (media.mimetype.startsWith('image/')) {
            await ctx.sock.sendMessage(ctx.chat, { image: media.buffer }, { quoted: ctx.msg })
            return
        }
        if (media.mimetype.startsWith('video/')) {
            await ctx.sock.sendMessage(ctx.chat, { video: media.buffer, mimetype: media.mimetype }, { quoted: ctx.msg })
            return
        }
        if (media.mimetype.startsWith('audio/')) {
            await ctx.sock.sendMessage(ctx.chat, { audio: media.buffer, mimetype: media.mimetype }, { quoted: ctx.msg })
            return
        }

        await ctx.sock.sendMessage(
            ctx.chat,
            { document: media.buffer, mimetype: media.mimetype, fileName: 'view-once' },
            { quoted: ctx.msg },
        )
    },
})

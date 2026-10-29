import { jidNormalizedUser } from 'baileys'
import { ari } from '../../bot/registry.js'

ari({
    name: 'setpp',
    description: 'Set the bot profile picture from a quoted image',
    category: 'tools',
    usage: 'setpp (reply to an image)',
    ownerOnly: true,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.startsWith('image/')) {
            await ctx.reply('Reply to an image. 🛑')
            return
        }

        const bot = ctx.sock.user?.id
        if (!bot) {
            await ctx.reply('Not connected. 🛑')
            return
        }

        try {
            await ctx.sock.updateProfilePicture(jidNormalizedUser(bot), media.buffer)
            await ctx.reply('Profile picture updated ✅')
        } catch {
            await ctx.reply('Failed to update profile picture 🛑')
        }
    },
})

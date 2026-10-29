import { ari } from '../../bot/registry.js'

ari({
    name: 'gpp',
    description: 'Show the group profile picture',
    category: 'group',
    groupOnly: true,
    run: async (ctx) => {
        const metadata = await ctx.groupMetadata()
        const url = await ctx.sock.profilePictureUrl(ctx.chat, 'image').catch(() => undefined)
        if (!url) {
            await ctx.reply('This group has no profile picture. 🛑')
            return
        }
        await ctx.replyImage(url, `*${metadata?.subject ?? 'Group'}*`)
    },
})

ari({
    name: 'setgcpp',
    description: 'Set the group profile picture from a quoted image',
    category: 'group',
    aliases: ['setgpp', 'setgroupdp'],
    usage: 'setgcpp (reply to an image)',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.startsWith('image/')) {
            await ctx.reply('Reply to an image with this command. 🛑')
            return
        }

        try {
            await ctx.sock.updateProfilePicture(ctx.chat, media.buffer)
            await ctx.reply('Group profile picture updated ✅')
        } catch {
            await ctx.reply('Failed to update the group profile picture 🛑')
        }
    },
})

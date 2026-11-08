import { ari } from '../../bot/registry.js'

ari({
    name: 'setabout',
    description: 'Set the bot about message',
    category: 'tools',
    aliases: ['setbio'],
    usage: 'setabout [text]',
    cooldownMs: 10000,
    ownerOnly: true,
    run: async (ctx) => {
        const text = ctx.args.join(' ')
        if (!text) {
            await ctx.reply(`Usage: ${ctx.prefix}setabout Your status message`)
            return
        }

        if (text.length > 139) {
            await ctx.reply('About text must be 139 characters or fewer. 🛑')
            return
        }

        try {
            await ctx.sock.updateProfileStatus(text)

            await ctx.reply('About status updated ✅')
        } catch (error) {
            await ctx.reply(`WhatsApp rejected the about update: ${(error as Error).message} 🛑`)
        }
    },
})

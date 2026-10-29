import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { db } from '../../db/index.js'

ari({
    name: 'react',
    description: 'Enable/disable automatic reactions and choose the emoji',
    category: 'tools',
    aliases: ['autoreact'],
    usage: 'react on|off|<emoji>',
    cooldownMs: 0,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()
        const settings = db.autoreact(ctx.chat)

        if (!action) {
            const effective = settings.configured ? settings.enabled : config.features.autoReaction
            const source = settings.configured ? 'this chat' : config.features.autoReaction ? 'global default' : 'off'
            await ctx.reply(
                [
                    `Auto-reaction: ${effective ? 'on ✅' : 'off 🛑'} (${source})`,
                    `Emoji: ${settings.emoji}`,
                    `Usage: ${ctx.prefix}react on|off|<emoji>`,
                ].join('\n'),
            )
            return
        }

        if (action === 'on') {
            db.setAutoreact(ctx.chat, true)
            await ctx.reply(`Auto-reaction on (${settings.emoji}) ✅`)
            return
        }

        if (action === 'off') {
            db.setAutoreact(ctx.chat, false)
            await ctx.reply('Auto-reaction off 🛑')
            return
        }

        const emoji = action === 'emoji' ? ctx.args[1] : ctx.args[0]
        if (!emoji) {
            await ctx.reply(`Usage: ${ctx.prefix}react on|off|<emoji>`)
            return
        }

        db.setAutoreactEmoji(ctx.chat, emoji)
        await ctx.reply(`Reaction set to ${emoji} ✅`)
    },
})

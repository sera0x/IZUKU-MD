import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'

ari({
    name: 'afk',
    description: 'Mark yourself away with an optional reason',
    category: 'afk',
    usage: 'afk back in 20 minutes',
    run: async (ctx) => {
        const reason = ctx.text || 'Away'
        db.setAfk(ctx.sender, reason)
        await ctx.reply(`AFK: ${reason} ✅`)
    },
})

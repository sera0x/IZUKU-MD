import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'

ari({
    name: 'info',
    description: 'Show bot, owner and stack details',
    category: 'general',
    aliases: ['about'],
    run: async (ctx) => {
        await ctx.reply(
            `*${config.botName}* ${config.version}\n▸ Owner: ${config.ownerName}\n▸ Stack: TypeScript · Baileys 7 · SQLite\n▸ Repository: ${config.links.repo}\n▸ Mode: ${config.mode}\n▸ Prefix: ${config.prefix}\n▸ Database: ${config.dbPath}\n▸ Instagram: ${config.links.instagram || 'not set'}`,
        )
    },
})

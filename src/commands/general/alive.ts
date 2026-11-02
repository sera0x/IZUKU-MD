import { config } from '../../config.js'
import { runtime } from '../../runtime.js'
import { commandCount, ari } from '../../bot/registry.js'
import { formatUptime, memoryLine } from '../../features/system.js'

ari({
    name: 'alive',
    description: 'Check that the bot is online',
    category: 'general',
    aliases: ['bot'],
    run: async (ctx) => {
        await ctx.reply(
            `*${config.botName}*: is online ✅\n▸ Version: ${config.version}\n▸ Mode: ${runtime.mode}\n▸ Uptime: ${formatUptime(Date.now() - runtime.startedAt)}\n▸ Commands: ${commandCount()}\n▸ Memory: ${memoryLine()}`,
        )
    },
})

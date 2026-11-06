import { runtime } from '../../runtime.js'
import { ari } from '../../bot/registry.js'
import { formatUptime, memoryLine } from '../../features/system.js'

ari({
    name: 'uptime',
    description: 'Show how long the bot has been running',
    category: 'general',
    run: async (ctx) => {
        await ctx.reply(
            [
                `Uptime: ${formatUptime(Date.now() - runtime.startedAt)}`,
                `Memory: ${memoryLine()}`,
            ].join('\n'),
        )
    },
})

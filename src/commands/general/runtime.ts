import { ari, commandCount } from '../../bot/registry.js'
import { runtime } from '../../runtime.js'
import { cpuCount, formatUptime, memoryLine, platformLabel, runtimeLabel } from '../../features/system.js'

ari({
    name: 'runtime',
    description: 'Show process and system information',
    category: 'general',
    aliases: ['sys'],
    run: async (ctx) => {
        await ctx.reply(
            `╭─ *Runtime*\n│ PID : ${process.pid}\n│ Runtime : ${runtimeLabel()}\n│ Platform : ${platformLabel()}\n│ CPU cores : ${cpuCount()}\n│ Memory : ${memoryLine()}\n│ Uptime : ${formatUptime(Date.now() - runtime.startedAt)}\n│ Commands : ${commandCount()}\n│ Mode : ${runtime.mode}\n╰─`,
        )
    },
})

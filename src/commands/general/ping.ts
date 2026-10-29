import { ari } from '../../bot/registry.js'

ari({
    name: 'ping',
    description: 'Measure message round-trip latency',
    category: 'general',
    run: async (ctx) => {
        const started = Date.now()
        const sent = await ctx.sock.sendMessage(ctx.chat, { text: 'ping' }, { quoted: ctx.msg })
        const latency = Date.now() - started

        if (sent) {
            await ctx.sock.sendMessage(ctx.chat, {
                text: `pong ${latency}ms`,
                edit: sent.key,
            })
        }
    },
})

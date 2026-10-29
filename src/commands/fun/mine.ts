import { ari } from '../../bot/registry.js'
import { casinoGate, type CasinoCtx } from '../../features/casino.js'
import { startMine, pickMine, cashoutMine } from '../../features/mine.js'

const ctxOf = (ctx: { chat: string; sender: string; isGroup: boolean; prefix: string; args: string[]; reply(c: string): Promise<unknown>; sock: any; msg: any }): CasinoCtx => ({
    chat: ctx.chat,
    sender: ctx.sender,
    isGroup: ctx.isGroup,
    prefix: ctx.prefix,
    args: ctx.args,
    reply: (c) => ctx.reply(c),
    sendImage: async (image, caption) => {
        await ctx.sock.sendMessage(ctx.chat, { image, caption }, { quoted: ctx.msg })
    },
})

ari({
    name: 'mine',
    description: 'Start a mines round with a bet',
    category: 'games',
    usage: 'mine <bet>',
    cooldownMs: 0,
    run: async (ctx) => {
        const c = ctxOf(ctx as any)
        if (await casinoGate(c)) return
        await startMine(c, ctx.args[0])
    },
})

ari({
    name: 'mpick',
    description: 'Reveal mine tiles (1-25), single or batch',
    category: 'games',
    usage: 'mpick <1-25> [more...]',
    cooldownMs: 0,
    run: async (ctx) => {
        const c = ctxOf(ctx as any)
        if (await casinoGate(c)) return
        await pickMine(c, ctx.args)
    },
})

ari({
    name: 'cashout',
    description: 'Bank your mines winnings',
    category: 'games',
    usage: 'cashout',
    cooldownMs: 0,
    run: async (ctx) => {
        const c = ctxOf(ctx as any)
        if (await casinoGate(c)) return
        await cashoutMine(c)
    },
})

import { ari } from '../../bot/registry.js'
import { casinoGate, type CasinoCtx } from '../../features/casino.js'
import { playSlots } from '../../features/slots.js'
import { mineCooldownLeft } from '../../features/mine.js'

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
    name: 'slot',
    aliases: ['slots'],
    description: 'Spin 6 lines of emoji reels with a bet',
    category: 'games',
    usage: 'slot <bet>',
    cooldownMs: 0,
    run: async (ctx) => {
        const c = ctxOf(ctx as any)
        if (await casinoGate(c)) return
        if (mineCooldownLeft(ctx.sender) > 0) {
            await ctx.reply('🛑 slow down, next bet in a moment.')
            return
        }
        await playSlots(c)
    },
})

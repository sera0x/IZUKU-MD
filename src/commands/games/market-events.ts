import { ari } from '../../bot/registry.js'
import { gameGuard } from '../../features/tcg.js'
import { sellCard, buyListing, marketText, describeSell, describeBuy } from '../../features/market.js'

ari({
    name: 'sell',
    description: 'List a card for sale: .sell <card name or #number> <price>',
    category: 'games',
    aliases: [],
    usage: 'sell <card> <price>',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const priceArg = ctx.args[ctx.args.length - 1] ?? ''
        const query = ctx.args.slice(0, -1).join(' ')
        if (!query || !/^\d+$/.test(priceArg)) {
            await ctx.reply(`Usage: *${ctx.prefix}sell <card name or #number> <price>* e.g. ${ctx.prefix}sell 4 2500 🛑`)
            return
        }
        await ctx.reply(describeSell(sellCard(ctx.sender, query, Number(priceArg))))
    },
})

ari({
    name: 'market',
    description: 'Browse live card listings and time left',
    category: 'games',
    aliases: ['mkt'],
    usage: 'market',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        await ctx.reply(marketText())
    },
})

ari({
    name: 'mbuy',
    description: 'Buy a market listing: .mbuy <listing id>',
    category: 'games',
    aliases: ['marketbuy'],
    usage: 'mbuy <id>',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const id = Number(ctx.args[0] ?? '')
        if (!Number.isSafeInteger(id) || id <= 0) {
            await ctx.reply(`Usage: *${ctx.prefix}mbuy <id>* (ids are in ${ctx.prefix}market) 🛑`)
            return
        }
        await ctx.reply(describeBuy(buyListing(ctx.sender, id)))
    },
})

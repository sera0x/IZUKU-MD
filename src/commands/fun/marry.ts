import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'

ari({
    name: 'marry',
    description: 'Marry the spawned haigusha character',
    category: 'fun',
    usage: 'marry',
    cooldownMs: 3000,
    run: async (ctx) => {
        const existing = db.marriageOf(ctx.sender)
        if (existing) {
            await ctx.reply(`\u{1F492} You are already married to *${existing.name}*. Use .divorce first.`)
            return
        }

        const partner = ctx.text?.trim()
        if (!partner) {
            await ctx.reply(`Usage: ${ctx.prefix}marry <name> 🛑`)
            return
        }

        db.setMarriage(ctx.sender, { name: partner.slice(0, 40), series: '', image_url: '' } as never)
        await ctx.reply(
            [
                '\u{1F492} *Marriage*',
                '',
                `*${ctx.senderName}* is now married to *${partner.slice(0, 40)}*`,
                '',
            ].join('\n'),
        )
    },
})

ari({
    name: 'divorce',
    description: 'Divorce your waifu or husband',
    category: 'fun',
    usage: 'divorce',
    cooldownMs: 3000,
    run: async (ctx) => {
        const existing = db.marriageOf(ctx.sender)
        if (!existing) {
            await ctx.reply('You are not married yet.')
            return
        }
        db.clearMarriage(ctx.sender)
        await ctx.reply(`\u{1F494} *${ctx.senderName}* divorced *${existing.name}*. Paperwork done.`)
    },
})

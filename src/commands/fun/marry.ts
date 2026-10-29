import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { takeSpawn } from '../../features/haigusha.js'

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

        const character = takeSpawn(ctx.chat)
        if (!character) {
            await ctx.reply('No one is waiting at the altar. Use .haigusha to spawn a character first.')
            return
        }

        db.setMarriage(ctx.sender, character)
        await ctx.replyImage(
            character.imageUrl,
            [
                '\u{1F492} *Marriage*',
                '',
                `*${ctx.senderName}* is now married to *${character.name}*`,
                `*Series* : ${character.series}`,
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
            await ctx.reply('You are not married. Use .haigusha and .marry to find someone.')
            return
        }
        db.clearMarriage(ctx.sender)
        await ctx.reply(`\u{1F494} *${ctx.senderName}* divorced *${existing.name}*. Paperwork done.`)
    },
})

import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'

const MAX_BIO = 200

ari({
    name: 'clanbio',
    description: 'Set or view your clan bio (leader/officer only)',
    category: 'fun',
    aliases: ['cbio'],
    usage: 'clanbio <text> | clanbio clear | clanbio alone shows it',
    cooldownMs: 1000,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        if (!membership) {
            await ctx.reply('You are not in a clan. ' + String.fromCharCode(0x1F6D1))
            return
        }
        const clan = db.clanById(membership.clan_id)
        if (!clan) {
            await ctx.reply('Your clan could not be found. ' + String.fromCharCode(0x1F6D1))
            return
        }

        const text = ctx.args.join(' ').trim()
        if (!text) {
            await ctx.reply(
                clan.bio
                    ? `🌿 *${clan.name}* bio:\n\n_${clan.bio}_`
                    : `*${clan.name}* has no bio yet. Set one: ${ctx.prefix}clanbio <text>`,
            )
            return
        }

        if (text.toLowerCase() === 'clear') {
            if (membership.role === 'member') {
                await ctx.reply('Only the leader or an officer can clear the bio. ' + String.fromCharCode(0x1F6D1))
                return
            }
            db.setClanBio(clan.id, null)
            await ctx.reply(`🌿 Bio cleared for *${clan.name}*`)
            return
        }

        if (membership.role === 'member') {
            await ctx.reply('Only the leader or an officer can set the bio. ' + String.fromCharCode(0x1F6D1))
            return
        }
        if (text.length > MAX_BIO) {
            await ctx.reply(`Bio is too long: ${text.length}/${MAX_BIO} characters. ` + String.fromCharCode(0x1F6D1))
            return
        }
        db.setClanBio(clan.id, text)
        await ctx.reply(`🌿 Bio set for *${clan.name}*:\n\n_${text}_`)
    },
})

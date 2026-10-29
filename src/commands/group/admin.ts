import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { resolveTarget } from '../../bot/group-utils.js'

const label = (jid: string): string => `@${jidToNumber(jid)}`

ari({
    name: 'add',
    description: 'Add a number to the group',
    category: 'group',
    usage: 'add 2348012345678',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const target = resolveTarget(ctx)
        if (!target) {
            await ctx.reply('Give me a number or reply to a contact. 🛑')
            return
        }

        const [result] = await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'add')
        const status = result?.status ?? 'unknown'
        await ctx.reply(
            status === '200'
                ? `Added ${label(target)} ✅`
                : `Could not add ${label(target)} (status ${status}). They may have privacy rules. 🛑`,
        )
    },
})

ari({
    name: 'kick',
    description: 'Remove a member from the group',
    category: 'group',
    aliases: ['remove'],
    usage: 'kick @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const target = resolveTarget(ctx)
        if (!target) {
            await ctx.reply('Mention, reply to, or give the number of the member. 🛑')
            return
        }
        if (jidToNumber(target) === jidToNumber(ctx.sock.user?.id ?? '')) {
            await ctx.reply('I cannot remove myself. 🛑')
            return
        }

        await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'remove')
        await ctx.reply(`Removed ${label(target)} ✅`)
    },
})

ari({
    name: 'promote',
    description: 'Promote a member to admin',
    category: 'group',
    usage: 'promote @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const target = resolveTarget(ctx)
        if (!target) {
            await ctx.reply('Mention, reply to, or give the number of the member. 🛑')
            return
        }
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'promote')
        await ctx.reply(`${label(target)} is now an admin. ✅`)
    },
})

ari({
    name: 'demote',
    description: 'Remove admin rights from a member',
    category: 'group',
    usage: 'demote @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const target = resolveTarget(ctx)
        if (!target) {
            await ctx.reply('Mention, reply to, or give the number of the member. 🛑')
            return
        }
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'demote')
        await ctx.reply(`${label(target)} is no longer an admin. ✅`)
    },
})

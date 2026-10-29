import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'

ari({
    name: 'id',
    description: 'Show the chat and sender identifiers',
    category: 'general',
    aliases: ['whoami'],
    run: async (ctx) => {
        await ctx.reply(
            [
                `▸ Chat: \`${ctx.chat}\``,
                `▸ Sender: \`${ctx.sender}\``,
                `▸ Number: +${jidToNumber(ctx.sender)}`,
                `▸ Role: ${ctx.isOwner ? 'owner' : ctx.isSudo ? 'sudo' : ctx.isAdmin ? 'admin' : 'member'}`,
            ].join('\n'),
        )
    },
})

ari({
    name: 'whois',
    description: 'Show a user name, number and group role',
    category: 'general',
    aliases: ['who'],
    usage: 'whois @user',
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const name = (await targetName(ctx, target)) || 'unknown'
        const metadata = ctx.isGroup ? await ctx.groupMetadata() : undefined
        const participant = metadata?.participants.find((entry) => {
            const identifiers = [entry.id, entry.lid, entry.phoneNumber].filter(
                (value): value is string => typeof value === 'string' && value.length > 0,
            )
            return identifiers.some((value) => sameUser(value, target))
        })

        await ctx.reply(
            [
                '╭─ *User*',
                `│ Name : ${name}`,
                `│ Number : +${jidToNumber(target)}`,
                `│ JID : ${target}`,
                ctx.isGroup ? `│ Role : ${participant?.admin ? 'admin' : 'member'}` : '',
                '╰─',
            ]
                .filter(Boolean)
                .join('\n'),
        )
    },
})

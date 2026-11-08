import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'
import { activeBotFor, botRefs, normalizeBotRef, setActiveBot } from '../../features/active-bot.js'

const ownNumber = (sock: Parameters<typeof botRefs>[0]): string =>
    (sock?.user?.id ?? '').split('@')[0]?.split(':')[0] ?? ''

/**
 * Several deployments of the bot can sit in the same group. `.sleep` puts every
 * bot there to sleep except the one the owner names — the others go quiet
 * without leaving the group, so the group can still be handed to another bot
 * with a single command.
 */
ari({
    name: 'sleep',
    description: 'Put every bot in this group to sleep except one',
    category: 'owner',
    groupOnly: true,
    ownerOnly: true,
    usage: 'sleep <name|number> | sleep off | sleep status',
    cooldownMs: 0,
    run: async (ctx) => {
        const wanted = normalizeBotRef(ctx.args.join(' '))
        const refs = botRefs(ctx.sock)
        const active = activeBotFor(ctx.chat)
        const mine = ownNumber(ctx.sock)

        if (!wanted || wanted === 'status' || wanted === 'who') {
            await ctx.reply(
                active
                    ? `Only *${active}* is awake here. 😴\nThis bot is *${config.botName}* (${mine || 'unknown'}).\nUse *${ctx.prefix}sleep off* to wake every bot again.`
                    : `Every bot is awake here.\nThis bot is *${config.botName}* (${mine || 'unknown'}).\nUse *${ctx.prefix}sleep <name or number>* to keep just one.`,
            )
            return
        }

        if (['off', 'all', 'everyone', 'any', 'reset', 'wake'].includes(wanted)) {
            setActiveBot(ctx.chat, '')
            await ctx.reply('Every bot is awake here again. ✅')
            return
        }

        // A number nobody in the group owns would put every bot to sleep with
        // no one left to answer, so check it before recording the choice.
        if (/^\d{6,}$/.test(wanted) && !refs.includes(wanted)) {
            const metadata = await ctx.groupMetadata().catch(() => undefined)
            const present = (metadata?.participants ?? []).some(
                (member) => String(member.id ?? '').split('@')[0]?.split(':')[0] === wanted,
            )
            if (!present) {
                await ctx.reply(
                    `No bot with *${wanted}* is in this group, so nothing was put to sleep. 🛑\nThis bot is *${config.botName}* (${mine || 'unknown'}).`,
                )
                return
            }
        }

        setActiveBot(ctx.chat, wanted)
        // Every bot in the group receives this command and records the same
        // choice, but only the chosen one says so — otherwise the confirmation
        // would arrive once per deployment.
        if (!refs.includes(wanted)) return
        await ctx.reply(`The others are asleep. 😴 *${config.botName}* answers here now.\nUse *${ctx.prefix}sleep off* to wake them.`)
    },
})

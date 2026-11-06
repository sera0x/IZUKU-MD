import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'
import { activeBotFor, botRefs, normalizeBotRef, setActiveBot } from '../../features/active-bot.js'

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

        if (!wanted || wanted === 'status' || wanted === 'who') {
            await ctx.reply(
                active
                    ? `Only *${active}* is awake here. 😴\nUse *${ctx.prefix}sleep off* to wake every bot again.`
                    : `Every bot is awake here. Use *${ctx.prefix}sleep <name or number>* to keep just one.`,
            )
            return
        }

        if (['off', 'all', 'everyone', 'any', 'reset', 'wake'].includes(wanted)) {
            setActiveBot(ctx.chat, '')
            await ctx.reply('Every bot is awake here again. ✅')
            return
        }

        setActiveBot(ctx.chat, wanted)
        // Every bot in the group receives this command and records the same
        // choice, but only the chosen one says so — otherwise the confirmation
        // would arrive once per deployment.
        if (!refs.includes(wanted)) return
        await ctx.reply(`The others are asleep. 😴 *${config.botName}* answers here now.\nUse *${ctx.prefix}sleep off* to wake them.`)
    },
})

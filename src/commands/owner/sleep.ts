import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'
import { activeBotFor, botRefs, normalizeBotRef, setActiveBot } from '../../features/active-bot.js'

const ownNumber = (sock: Parameters<typeof botRefs>[0]): string =>
    (sock?.user?.id ?? '').split('@')[0]?.split(':')[0] ?? ''

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

        if (!refs.includes(wanted)) return
        await ctx.reply(`The others are asleep. 😴 *${config.botName}* answers here now.\nUse *${ctx.prefix}sleep off* to wake them.`)
    },
})

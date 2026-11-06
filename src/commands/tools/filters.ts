import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'

export const MIN_TRIGGER_LENGTH = 2

ari({
    name: 'filters',
    description: 'Manage auto-reply filters',
    category: 'tools',
    aliases: ['filter'],
    usage: 'filter add|del|list|clear',
    run: async (ctx) => {
        const [action, ...args] = ctx.args

        if (!action) {
            await ctx.reply(`Usage: ${ctx.prefix}filter add|del|list|clear`)
            return
        }

        if (action === 'list') {
            const filters = db.filters(ctx.chat)
            if (!filters.length) {
                await ctx.reply('No filters.')
                return
            }
            await ctx.reply(filters.map((filter, index) => `${index + 1}. ${filter.trigger} → ${filter.response}`).join('\n'))
            return
        }

        if (action === 'add') {
            const [trigger, ...replyParts] = args.join(' ').split('|').map((part) => part.trim())
            const response = replyParts.join('|').trim()

            if (!trigger || !response) {
                await ctx.reply(`Format: ${ctx.prefix}filter add trigger | reply`)
                return
            }
            if (trigger.length < MIN_TRIGGER_LENGTH) {
                await ctx.reply(`Trigger needs at least ${MIN_TRIGGER_LENGTH} characters. 🛑`)
                return
            }
            db.setFilter(ctx.chat, trigger, response, ctx.sender)
            await ctx.reply(`${trigger} → ${response} ✅`)
            return
        }

        if (action === 'del') {
            if (!args[0]) {
                await ctx.reply(`Usage: ${ctx.prefix}filter del trigger`)
                return
            }
            const removed = db.removeFilter(ctx.chat, args[0])
            await ctx.reply(removed ? `Removed ${args[0]} ✅` : `No filter named ${args[0]} 🛑`)
            return
        }

        if (action === 'clear') {
            db.clearFilters(ctx.chat)
            await ctx.reply('Filters cleared ✅')
            return
        }

        await ctx.reply(`Usage: ${ctx.prefix}filter add|del|list|clear`)
    },
})

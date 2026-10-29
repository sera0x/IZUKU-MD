import { ari } from '../../bot/registry.js'

function secondsOf(value: string): number | null {
    if (value === 'off' || value === '0') return 0
    const match = value.match(/^(\d+)(s|m|h|d)?$/)
    if (!match) return null
    const amount = Number(match[1])
    const unit = match[2] ?? 's'
    const factor = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1
    const seconds = amount * factor
    return [0, 86400, 604800, 7776000].includes(seconds) ? seconds : null
}

ari({
    name: 'disappear',
    description: 'Set disappearing messages for this chat',
    category: 'tools',
    usage: 'disappear 24h|7d|90d|off',
    run: async (ctx) => {
        const input = (ctx.args[0] ?? '').toLowerCase()
        const seconds = secondsOf(input)

        if (seconds === null) {
            await ctx.reply(`Usage: ${ctx.prefix}disappear 24h|7d|90d|off 🛑`)
            return
        }

        if (ctx.isGroup) {
            if (!ctx.isAdmin && !ctx.isOwner) {
                await ctx.reply('Admins only. 🛑')
                return
            }
            if (!ctx.isBotAdmin) {
                await ctx.reply('I need to be an admin to do that. 🛑')
                return
            }
        }

        await ctx.sock.sendMessage(ctx.chat, { disappearingMessagesInChat: seconds })
        await ctx.reply(`${seconds === 0 ? 'off' : input} ✅`)
    },
})

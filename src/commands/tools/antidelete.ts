import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'

const state = (): string => {
    const mode = config.antiDelete.mode
    if (mode === 'off') return 'Anti-delete is off 🛑'
    if (mode === 'bot') return 'Anti-delete is on ✅'
    if (mode === 'jid') return `Anti-delete → +${config.antiDelete.jid} ✅`
    return `Anti-delete is on (${mode}) ✅`
}

ari({
    name: 'antidelete',
    description: 'Recover deleted messages',
    category: 'tools',
    aliases: ['antidel', 'adel'],
    usage: 'antidelete off|same|bot|jid <number>',
    ownerOnly: true,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()

        if (action === 'status') {
            await ctx.reply('Deleted statuses are never forwarded. 🛑')
            return
        }

        if (action === 'jid') {
            const number = (ctx.args[1] ?? '').replace(/\D/g, '')
            if (!number) {
                await ctx.reply(`Usage: ${ctx.prefix}antidelete jid <number with country code> 🛑`)
                return
            }
            try {
                applySetting('ANTI_DELETE_JID', number)
                applySetting('ANTI_DELETE', 'jid')
                await ctx.reply(`Deleted messages will be forwarded to +${number} ✅`)
            } catch (error) {
                await ctx.reply(`${(error as Error).message} 🛑`)
            }
            return
        }

        if (action === 'bot') {
            applySetting('ANTI_DELETE', 'bot')
            await ctx.reply('Anti-delete is on ✅')
            return
        }

        if (action === 'off' || action === 'same') {
            applySetting('ANTI_DELETE', action)
            await ctx.reply(action === 'off' ? 'Anti-delete is off 🛑' : 'Anti-delete is on ✅')
            return
        }

        if (action === 'sudo') {
            applySetting('ANTI_DELETE', 'same')
            await ctx.reply('Anti-delete is on ✅')
            return
        }

        await ctx.reply(`${state()}\nUsage: ${ctx.prefix}antidelete off | same | bot | jid <number>`)
    },
})

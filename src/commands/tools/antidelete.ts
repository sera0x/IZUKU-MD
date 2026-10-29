import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'

const state = (): string => {
    const mode = config.antiDelete.mode
    if (mode === 'off') return 'Anti-delete is off 🛑'
    if (mode === 'bot') return 'Anti-delete forwards to the owner chat ✅'
    if (mode === 'jid') return `Anti-delete forwards to +${config.antiDelete.jid} ✅`
    return `Anti-delete mode: *${mode}* ✅`
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
            await ctx.reply('Status recovery is disabled for privacy. Deleted statuses are never forwarded. 🛑')
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
            await ctx.reply('Anti-delete will forward deleted messages to the owner chat ✅')
            return
        }

        if (action === 'off' || action === 'same') {
            applySetting('ANTI_DELETE', action)
            await ctx.reply(
                action === 'off'
                    ? 'Anti-delete off 🛑'
                    : 'Anti-delete will resend in the same chat ✅',
            )
            return
        }

        // Kept only so an old habit does not look broken. Forwarding to many
        // sudo users leaked private chats, so it falls back to the same chat.
        if (action === 'sudo') {
            applySetting('ANTI_DELETE', 'same')
            await ctx.reply(
                'Anti-delete no longer forwards to sudo users. It will resend in the same chat ✅',
            )
            return
        }

        await ctx.reply(
            [
                state(),
                `Modes : ${ctx.prefix}antidelete off | same | jid <number>`,
                'Deleted statuses are never forwarded.',
            ].join('\n'),
        )
    },
})

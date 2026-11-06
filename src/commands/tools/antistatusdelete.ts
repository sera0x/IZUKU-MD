import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'
import { jidToNumber } from '../../bot/helpers.js'

const state = (): string =>
    config.antiDelete.status ? 'Anti-status-delete is on ✅' : 'Anti-status-delete is off 🛑'

ari({
    name: 'antistatusdelete',
    description: 'Forward deleted WhatsApp statuses to the bot number',
    category: 'tools',
    aliases: ['antistatusdel', 'asd'],
    usage: 'antistatusdelete on|off',
    ownerOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()

        if (action === 'on' || action === 'off') {
            applySetting('ANTISTATUS_DELETE', action)
            await ctx.reply(
                action === 'on'
                    ? `Anti-status-delete is on ✅ (→ +${jidToNumber(ctx.sock.user?.id ?? '') || 'unknown'})`
                    : 'Anti-status-delete is off 🛑',
            )
            return
        }

        await ctx.reply(`${state()}\nUsage: ${ctx.prefix}antistatusdelete on | off`)
    },
})

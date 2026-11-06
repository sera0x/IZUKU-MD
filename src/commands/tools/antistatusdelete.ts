import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'
import { jidToNumber } from '../../bot/helpers.js'

const state = (): string =>
    config.antiDelete.status
        ? 'Anti-status-delete is *on* — deleted statuses come to this bot number ✅'
        : 'Anti-status-delete is off 🛑'

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
                    ? [
                          '✅ *Anti-status-delete on*',
                          '',
                          `▸ Deleted statuses are sent to the bot number: *+${jidToNumber(ctx.sock.user?.id ?? '') || 'unknown'}*`,
                          '▸ They are never forwarded to the owner chat or to your DMs.',
                      ].join('\n')
                    : '🛑 Anti-status-delete off',
            )
            return
        }

        await ctx.reply(
            [
                state(),
                '',
                `▸ *${ctx.prefix}antistatusdelete on* — forward deleted statuses to the bot number`,
                `▸ *${ctx.prefix}antistatusdelete off* — stop forwarding`,
                '',
                'The quote is restored with its media when it is still cached.',
            ].join('\n'),
        )
    },
})

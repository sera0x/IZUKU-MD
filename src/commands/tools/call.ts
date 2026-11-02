import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'

ari({
    name: 'call',
    description: 'Reject incoming WhatsApp calls',
    category: 'tools',
    aliases: ['anticall'],
    usage: 'call on|off',
    ownerOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()

        if (action === 'on' || action === 'off') {
            applySetting('ANTI_CALL', action)
            await ctx.reply(
                action === 'on'
                    ? [
                          '📵 *Anti-call on*',
                          '',
                          '▸ Every incoming call is rejected and the caller gets a short notice.',
                      ].join('\n')
                    : '📞 *Anti-call off* — calls are left alone.',
            )
            return
        }

        await ctx.reply(
            [
                config.features.antiCall ? '📵 Anti-call is *on*' : '📞 Anti-call is off',
                '',
                `▸ *${ctx.prefix}call on* — reject incoming calls`,
                `▸ *${ctx.prefix}call off* — allow them again`,
            ].join('\n'),
        )
    },
})

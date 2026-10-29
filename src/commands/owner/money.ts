import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { balanceOf, money } from '../../features/economy.js'
import { normalizeTarget, resolveTarget } from '../../bot/group-utils.js'

ari({
    name: 'gen',
    description: 'Create Ryo out of thin air (owner only)',
    category: 'owner',
    aliases: ['print', 'mint'],
    usage: 'gen <amount> [@user]',
    ownerOnly: true,
    hidden: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const amount = Number.parseInt(ctx.args.find((arg) => /^\d+$/.test(arg)) ?? '', 10)

        if (!Number.isSafeInteger(amount) || amount <= 0) {
            await ctx.reply(`Usage: *${ctx.prefix}gen 100000 @user* (bare ${ctx.prefix}gen 5000 tops up you)`)
            return
        }

        db.user(target)
        db.addCoins(target, amount)
        const label = target === ctx.sender ? 'your wallet' : 'their wallet'
        await ctx.reply(`🖨️ Minted *${money(amount)}* into ${label}.\nBalance: *${money(balanceOf(target))}*`)
    },
})

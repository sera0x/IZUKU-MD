import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { balanceOf, money } from '../../features/economy.js'
import { economyGuard } from '../../features/tcg.js'

/** Sentinel ledger day: -1 marks the one-time starter bonus, never a real day. */
const BONUS_DAY = -1
const BONUS_MIN = 250
const BONUS_MAX = 1000
const BONUS_STEP = 50

const rollBonus = (): number => {
    const steps = Math.floor((BONUS_MAX - BONUS_MIN) / BONUS_STEP) + 1
    return BONUS_MIN + Math.floor(Math.random() * steps) * BONUS_STEP
}

ari({
    name: 'bonus',
    description: 'One-time random starter Ryo for new players',
    category: 'fun',
    aliases: ['starter', 'startmoney', 'starterpack'],
    usage: 'bonus',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await economyGuard(ctx)) return

        if (db.gameEarnedOn(ctx.sender, BONUS_DAY) > 0) {
            await ctx.reply(
                [
                    '🎁 You already claimed your starter bonus.',
                    `▸ Your wallet: *${money(balanceOf(ctx.sender))}*`,
                    `▸ Earn more with *${ctx.prefix}daily* and *${ctx.prefix}work*`,
                ].join('\n'),
            )
            return
        }

        const amount = rollBonus()
        db.addGameEarning(ctx.sender, BONUS_DAY, amount)
        db.addCoins(ctx.sender, amount)

        await ctx.reply(
            [
                '🎁 *Starter bonus*',
                '',
                `▸ You found *${money(amount)}* on the pavement.`,
                `▸ Wallet: *${money(balanceOf(ctx.sender))}*`,
                '',
                `_This is a one-time drop — ${ctx.prefix}bonus will not pay twice._`,
            ].join('\n'),
        )
    },
})

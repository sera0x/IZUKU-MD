import { ari } from '../../bot/registry.js'
import {
    CURRENCY_NAME,
    DAILY_COINS,
    STREAK_CAP,
    STREAK_STEP,
    balanceOf,
    claimDaily,
    dailyStatus,
    formatWait,
    money,
} from '../../features/economy.js'
import { db } from '../../db/index.js'
import { economyGuard } from '../../features/tcg.js'
import { sendCurrencyCard } from '../../features/currency-card.js'
import { streakMilestone } from '../../features/poke-upgrade.js'

ari({
    name: 'daily',
    description: `Claim your daily ${DAILY_COINS} ${CURRENCY_NAME} (streak bonus stacks each day)`,
    category: 'fun',
    aliases: ['dailycoins', 'claimdaily'],
    usage: 'daily',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const status = dailyStatus(ctx.sender)
        if (!status.ready) {
            await ctx.reply(`You already claimed your daily. Come back in *${formatWait(status.waitMs)}*. ⏳`)
            return
        }

        const claimed = claimDaily(ctx.sender)
        if (!claimed) {
            await ctx.reply('Your daily reward is not ready yet. ⏳')
            return
        }

        const lines = [
            '🧧 *Daily reward claimed!*',
            '',
            `+${money(claimed.amount)} (${money(claimed.base)} base + ${money(claimed.bonus)} streak)`,
            `🔥 Streak: *${claimed.streak}* day${claimed.streak === 1 ? '' : 's'}`,
            `Balance: *${money(claimed.balance)}*`,
        ]
        if (claimed.freezeUsed) lines.push('🧊 Streak freeze used. your streak survived the gap.')
        if (claimed.brokeStreak) lines.push('💔 streak reset. you missed too long.')
        lines.push(...streakMilestone(ctx.sender, claimed.streak))
        lines.push('', `Bonus maxes at +${money(STREAK_CAP * STREAK_STEP)} after ${STREAK_CAP + 1} days.`)
        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'balance',
    description: `Wallet card: ${CURRENCY_NAME} balance, streak and income`,
    category: 'fun',
    aliases: ['bal', 'wallet', 'coins', 'vbalance', 'vbal'],
    usage: 'balance',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const balance = balanceOf(ctx.sender)
        const streak = db.dailyStreak(ctx.sender)
        const status = dailyStatus(ctx.sender)

        const text = [
            `👛 *${ctx.senderName}'s wallet*`,
            '',
            `💰 Balance : *${money(balance)}*`,
            `🔥 Streak  : *${streak}* day${streak === 1 ? '' : 's'}`,
            `⏳ Daily   : ${status.ready ? '*ready to claim*' : `in ${formatWait(status.waitMs)}`}`,
        ].join('\n')

        await sendCurrencyCard(ctx, text, {
            title: `${CURRENCY_NAME} wallet`,
            body: `Balance ${money(balance)}`,
        })
    },
})

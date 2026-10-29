import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { sameUser } from '../../bot/identity.js'
import { db } from '../../db/index.js'
import {
    CURRENCY_NAME,
    ROB_COOLDOWN_MS,
    ROB_MIN_WALLET,
    ROB_SUCCESS_CHANCE,
    attemptRob,
    formatWait,
    money,
    parseAmount,
    robStatus,
    vaultTotals,
} from '../../features/economy.js'
import type { CommandContext } from '../../bot/types.js'
import { sendCurrencyCard } from '../../features/currency-card.js'
import { economyGuard } from '../../features/tcg.js'

const MAX_MESSAGE = 30_000

/** Vault balance card: same link-preview thumbnail as the wallet, different body. */
async function sendVaultCard(ctx: CommandContext, title: string, body: string): Promise<void> {
    const totals = vaultTotals(ctx.sender)
    const text = [
        `*${title}*`,
        '',
        `👛 *Wallet* : ${money(totals.wallet)}`,
        `🏦 *Vault*  : ${money(totals.vault)}`,
        `💰 *Total*  : ${money(totals.total)}`,
        '',
        '🔒 *Vault ryo cannot be robbed* — move it out only when you need it.',
        body ? `\n${body}` : '',
    ]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_MESSAGE)

    await sendCurrencyCard(ctx, text, {
        title: `${CURRENCY_NAME} vault`,
        body: `Vault ${money(totals.vault)} of ${money(totals.total)}`,
    })
}

ari({
    name: 'deposit',
    description: `Move ${CURRENCY_NAME} from your wallet into the vault`,
    category: 'fun',
    aliases: ['depo', 'dep'],
    usage: 'deposit <amount|all|half>',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const totals = vaultTotals(ctx.sender)
        if (totals.wallet <= 0) {
            await ctx.reply(
                `🏦 Your wallet is empty — nothing to deposit.\n▸ Earn with *${ctx.prefix}daily* or *${ctx.prefix}work*, or win a game.`,
            )
            return
        }

        const amount = parseAmount(ctx.args.join(' '), totals.wallet)
        if (!amount) {
            await ctx.reply(
                [
                    '*Deposit*',
                    `▸ *${ctx.prefix}deposit 500* — move that much`,
                    `▸ *${ctx.prefix}deposit all* — vault everything (${money(totals.wallet)})`,
                    `▸ *${ctx.prefix}deposit half* — vault half`,
                ].join('\n'),
            )
            return
        }

        if (amount > totals.wallet) {
            await ctx.reply(`You only have *${money(totals.wallet)}* in your wallet 🤷`)
            return
        }

        if (!db.deposit(ctx.sender, amount)) {
            await ctx.reply('The vault door jammed. Try again 🤷')
            return
        }

        const after = vaultTotals(ctx.sender)
        const note =
            after.wallet === 0
                ? '👀 Wallet empty, vault full. Bold strategy — nobody can touch it now.'
                : `✅ Locked away *${money(amount)}* — safe from every thief in this group.`
        await sendVaultCard(ctx, '🏦 Deposit complete', note)
    },
})

ari({
    name: 'withdraw',
    description: `Move ${CURRENCY_NAME} from the vault back into your wallet`,
    category: 'fun',
    aliases: ['wd', 'unvault'],
    usage: 'withdraw <amount|all|half>',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const totals = vaultTotals(ctx.sender)
        if (totals.vault <= 0) {
            await ctx.reply(
                `🏦 Your vault is empty.\n▸ Lock something up first with *${ctx.prefix}deposit all* — vault ryo cannot be robbed.`,
            )
            return
        }

        const amount = parseAmount(ctx.args.join(' '), totals.vault)
        if (!amount) {
            await ctx.reply(
                [
                    '*Withdraw*',
                    `▸ *${ctx.prefix}withdraw 500*`,
                    `▸ *${ctx.prefix}withdraw all* (${money(totals.vault)})`,
                ].join('\n'),
            )
            return
        }

        if (amount > totals.vault) {
            await ctx.reply(`Your vault only holds *${money(totals.vault)}* 🤷`)
            return
        }

        if (!db.withdraw(ctx.sender, amount)) {
            await ctx.reply('The vault door jammed. Try again 🤷')
            return
        }

        await sendVaultCard(
            ctx,
            '🏦 Withdrawal complete',
            `⚠️ *${money(amount)}* is back in your wallet — and robbers can see it now.`,
        )
    },
})

ari({
    name: 'vault',
    description: `Your vault card: protected ${CURRENCY_NAME} vs wallet`,
    category: 'fun',
    aliases: ['bank', 'safe'],
    usage: 'vault',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const totals = vaultTotals(ctx.sender)
        const share = totals.total > 0 ? Math.round((totals.vault / totals.total) * 100) : 0
        await sendVaultCard(ctx, `🏦 ${ctx.senderName}'s vault`, `📊 Protected: *${share}%* of everything you own.`)
    },
})

ari({
    name: 'rob',
    description: `Try to rob someone's wallet (1h cooldown, the vault is safe)`,
    category: 'fun',
    aliases: ['steal', 'loot'],
    usage: 'rob @user',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const status = robStatus(ctx.sender)
        if (!status.ready) {
            await ctx.reply(`🕵️ You are laying low for *${formatWait(status.waitMs)}*. Rookies get caught.`)
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(
                [
                    '*Robbery 101*',
                    `▸ *${ctx.prefix}rob @user* or reply to their message`,
                    `▸ Success chance: *${Math.round(ROB_SUCCESS_CHANCE * 100)}%*`,
                    `▸ Only *wallet* ryo can be taken — vault ryo is untouchable 🔒`,
                ].join('\n'),
            )
            return
        }

        const victim = await normalizeTarget(ctx, raw)
        if (sameUser(victim, ctx.sender)) {
            await ctx.reply('🤡 Robbing yourself? The maths does not work, genius.')
            return
        }

        const victimName = (await targetName(ctx, victim)) || jidToNumber(victim)
        const outcome = attemptRob(ctx.sender, victim, victimName)

        if (outcome.ok) {
            await ctx.reply(
                [
                    `🥷 *${outcome.line}*`,
                    '',
                    `💸 Stole *${money(outcome.amount)}* from *${victimName}*`,
                    `👛 Your wallet: *${money(outcome.thiefBalance)}*`,
                    '',
                    `🕒 Lay low for ${formatWait(ROB_COOLDOWN_MS)} before the next job.`,
                ].join('\n'),
            )
            return
        }

        if (outcome.error === 'broke') {
            await ctx.reply(
                [
                    '🥱 *Not worth it.*',
                    '',
                    outcome.line,
                    `📉 Their wallet is under *${money(ROB_MIN_WALLET)}* — barely enough for a snack.`,
                ].join('\n'),
            )
            return
        }

        if (outcome.error === 'self') {
            await ctx.reply(`🤡 ${outcome.line}`)
            return
        }

        await ctx.reply(
            [
                '🚨 *The job went wrong.*',
                '',
                outcome.line,
                '',
                `👛 Your wallet: *${money(outcome.thiefBalance)}*`,
                `🕒 Try again in ${formatWait(ROB_COOLDOWN_MS)}.`,
            ].join('\n'),
        )
    },
})

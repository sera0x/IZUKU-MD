import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { db } from '../../db/index.js'
import { latestNameFor } from '../../features/message-store.js'
import { money } from '../../features/economy.js'
import { progressFor } from '../../features/xp.js'

const MEDALS = ['🥇', '🥈', '🥉']

const nameOf = (jid: string): string => latestNameFor(jid) || db.user(jid).name || jidToNumber(jid) || 'unknown'

const row = (index: number, name: string, value: string): string =>
    `${MEDALS[index] ?? `*${index + 1}.*`} *${name}* — ${value}`

ari({
    name: 'lb',
    description: 'Leaderboard: top wins, wallet, cards or level',
    category: 'general',
    aliases: ['board', 'toptable'],
    usage: 'lb [wins|money|cards|level]',
    cooldownMs: 1500,
    run: async (ctx) => {
        const mode = (ctx.args[0] ?? 'wins').toLowerCase()
        const limit = 10

        if (mode === 'wins' || mode === 'win' || mode === 'games') {
            const stats = db.topGameStats(limit).filter((entry) => entry.wins > 0)
            const lines = stats.length
                ? stats.map((entry, index) =>
                      row(index, nameOf(entry.user_jid), `${entry.wins}W / ${entry.losses}L / ${entry.draws}D`),
                  )
                : ['_nobody has won a game yet_']
            await ctx.reply(
                [
                    '🏆 *LEADERBOARD* — *wins*',
                    '',
                    ...lines,
                    '',
                    `▸ *${ctx.prefix}lb money | cards | level*`,
                ].join('\n'),
            )
            return
        }

        if (mode === 'money' || mode === 'ryo' || mode === 'wallet') {
            const rows = db.topCoins(limit).filter((entry) => entry.coins > 0)
            const lines = rows.length
                ? rows.map((entry, index) => row(index, nameOf(entry.jid), money(entry.coins)))
                : ['_every wallet is empty_']
            await ctx.reply(
                [
                    '🏆 *LEADERBOARD* — *wallet*',
                    '',
                    ...lines,
                    '',
                    `▸ *${ctx.prefix}lb wins | cards | level*`,
                ].join('\n'),
            )
            return
        }

        if (mode === 'cards' || mode === 'collection' || mode === 'deck') {
            const rows = db.topCollectors(limit)
            const lines = rows.length
                ? rows.map((entry, index) =>
                      row(index, nameOf(entry.user_jid), `${entry.total} cards`),
                  )
                : ['_no cards collected yet_']
            await ctx.reply(
                [
                    '🏆 *LEADERBOARD* — *cards*',
                    '',
                    ...lines,
                ].join('\n'),
            )
            return
        }

        if (mode === 'level' || mode === 'xp') {
            const rows = db.topXpAll(limit).filter((entry) => entry.xp > 0)
            const lines = rows.length
                ? rows.map((entry, index) => {
                      const progress = progressFor(entry.xp)
                      return row(index, nameOf(entry.user_jid), `level *${progress.level}* (${progress.total} XP)`)
                  })
                : ['_no XP earned yet_']
            await ctx.reply(
                [
                    '🏆 *LEADERBOARD* — *level*',
                    '',
                    ...lines,
                ].join('\n'),
            )
            return
        }

        await ctx.reply(
            [
                '*Leaderboard*',
                `▸ *${ctx.prefix}lb wins* — most game wins`,
                `▸ *${ctx.prefix}lb money* — biggest wallets`,
                `▸ *${ctx.prefix}lb cards* — best collectors`,
                `▸ *${ctx.prefix}lb level* — highest level`,
            ].join('\n'),
        )
    },
})

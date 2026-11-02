import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { db } from '../../db/index.js'
import { latestNameFor } from '../../features/message-store.js'
import { progressFor } from '../../features/xp.js'

const MEDALS = ['🥇', '🥈', '🥉']

const nameOf = (jid: string): string => latestNameFor(jid) || db.user(jid).name || jidToNumber(jid) || 'unknown'

const row = (index: number, name: string, value: string): string =>
    `${MEDALS[index] ?? `*${index + 1}.*`} *${name}* — ${value}`

ari({
    name: 'lb',
    description: 'Leaderboard: top level or most messages',
    category: 'general',
    aliases: ['board', 'toptable'],
    usage: 'lb [level|msgs]',
    cooldownMs: 1500,
    run: async (ctx) => {
        const mode = (ctx.args[0] ?? 'level').toLowerCase()
        const limit = 10

        if (mode === 'msgs' || mode === 'messages' || mode === 'activity') {
            const rows = db.topXp(ctx.chat, limit).filter((entry) => entry.messages > 0)
            const lines = rows.length
                ? rows.map((entry, index) => row(index, nameOf(entry.user_jid), `${entry.messages} messages`))
                : ['_no messages counted yet_']
            await ctx.reply(['🏆 *LEADERBOARD* — *messages*', '', ...lines].join('\n'))
            return
        }

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
                '',
                `▸ *${ctx.prefix}lb msgs* — most active`,
            ].join('\n'),
        )
    },
})

import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { db } from '../../db/index.js'
import { heroTier, progressBar, progressFor, rankLine } from '../../features/xp.js'
import { breakdownOf, gameLabel, leaderboard, profileOf } from '../../features/game-stats.js'

ari({
    name: 'rank',
    description: 'Show your activity level in this chat',
    category: 'general',
    aliases: ['level', 'xp'],
    usage: 'rank | rank @user',
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const name = raw ? (await targetName(ctx, target)) || jidToNumber(target) : ctx.senderName

        const row = db.xp(ctx.chat, target)
        const progress = progressFor(row.xp)
        const wins = profileOf(target).wins
        const tier = heroTier(progress.level, wins)

        const lines = [
            `*${name}*`,
            `${tier.current.badge} *${tier.current.name}* — ${tier.percent}% to next`,
            `Level : ${progress.level} ${progressBar(progress)} ${progress.current}/${progress.needed}`,
            `XP    : ${progress.total}`,
            `Msgs  : ${row.messages}`,
            `Wins  : ${wins}`,
            `Rank  : ${rankLine(ctx.chat, target)}`,
        ]
        if (tier.next) {
            lines.push(`Next  : ${tier.next.badge} ${tier.next.name} (level ${tier.next.level}, ${tier.next.wins} wins)`)
        } else {
            lines.push('Next  : maxed out 👑')
        }

        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'top',
    description: 'Show the most active members in this chat',
    category: 'general',
    aliases: ['leaderboard', 'ranks'],
    usage: 'top',
    run: async (ctx) => {
        const rows = db.topXp(ctx.chat, 10)
        if (!rows.length) {
            await ctx.reply('Nobody has earned XP here yet. 🛑')
            return
        }

        const medals = ['🥇', '🥈', '🥉']
        const lines = rows.map((row, index) => {
            const name = db.user(row.user_jid).name || jidToNumber(row.user_jid)
            const level = progressFor(row.xp).level
            return `${medals[index] ?? `▸ ${index + 1}.`} ${name} — level ${level} (${row.xp} xp)`
        })

        await ctx.reply(['*Top members*', ...lines].join('\n'))
    },
})

ari({
    name: 'streak',
    description: 'Show wins, streak and rank across every game',
    category: 'general',
    aliases: ['games', 'gamestats', 'winrate'],
    usage: 'streak | streak @user',
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const name = raw ? (await targetName(ctx, target)) || jidToNumber(target) : ctx.senderName

        const profile = profileOf(target)
        const games = breakdownOf(target)

        const tier = heroTier(progressFor(db.xp(ctx.chat, target).xp).level, profile.wins)
        const lines = [
            `*${name}*`,
            `${tier.current.badge} *${tier.current.name}*`,
            `Wins    : ${profile.wins}`,
            `Losses  : ${profile.losses}`,
            `Draws   : ${profile.draws}`,
            `Streak  : ${profile.streak}${profile.best > 0 ? ` (best ${profile.best})` : ''}`,
            `Win rate: ${profile.winRate}%`,
            `Rank    : ${profile.rank > 0 ? `#${profile.rank}` : 'unranked'}`,
        ]

        if (games.length) {
            lines.push('')
            for (const game of games) {
                lines.push(`▸ ${gameLabel(game.game)} — ${game.wins}W/${game.losses}L/${game.draws}D`)
            }
        }

        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'gametop',
    description: 'Rank players by wins across every game',
    category: 'general',
    aliases: ['streaktop', 'topgames'],
    usage: 'gametop',
    run: async (ctx) => {
        const rows = leaderboard(10)
        if (!rows.length) {
            await ctx.reply('Nobody has finished a game yet. 🛑')
            return
        }

        const medals = ['🥇', '🥈', '🥉']
        const lines = rows.map((row, index) => {
            const name = db.user(row.user_jid).name || jidToNumber(row.user_jid)
            const streak = row.streak > 0 ? ` · 🔥${row.streak}` : ''
            return `${medals[index] ?? `▸ ${index + 1}.`} ${name} — ${row.wins}W/${row.losses}L${streak}`
        })

        await ctx.reply(['*Game leaderboard*', ...lines].join('\n'))
    },
})

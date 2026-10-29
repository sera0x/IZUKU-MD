import { config } from '../../config.js'
import { jidToNumber } from '../../bot/helpers.js'
import { phoneDigitsFor, sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { balanceOf } from '../../features/economy.js'
import { breakdownOf, gameLabel, profileOf } from '../../features/game-stats.js'
import { renderProfileCard, type ProfileMarriage } from '../../features/profile-card.js'
import { collectionOf, deckOf } from '../../features/tcg.js'
import { progressBar, progressFor, rankLine } from '../../features/xp.js'

ari({
    name: 'profile',
    description: 'Show a player profile with game record, rank and collection',
    aliases: ['p'],
    category: 'general',
    usage: 'profile | profile @user',
    cooldownMs: 0,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const storedName = await targetName(ctx, target).catch(() => '')
        const name =
            storedName ||
            (sameUser(target, ctx.sender) ? ctx.senderName : '') ||
            jidToNumber(target) ||
            'unknown'

        const number = phoneDigitsFor(target) || jidToNumber(target) || 'unknown'
        const role = config.owners.includes(number)
            ? 'Owner'
            : config.sudo.includes(number)
              ? 'Sudo'
              : 'Member'

        const game = profileOf(target)
        const games = breakdownOf(target)
        const collection = collectionOf(target)
        const staged = deckOf(target).reduce((sum, entry) => sum + entry.copies, 0)
        const coins = balanceOf(target)
        const xp = db.xp(ctx.chat, target)
        const progress = progressFor(xp.xp)
        const chatRank = rankLine(ctx.chat, target)
        const topCard = collection.cards[0]
        const marriage = db.marriageOf(target)

        const lines = [
            `*${name}*`,
            `🪪 +${number} · ${role}`,
            `🏅 Global rank: ${game.rank > 0 ? `#${game.rank}` : 'unranked'}`,
            '',
            '🎮 *ɢᴀᴍᴇ ʀᴇᴄᴏʀᴅ*',
            `🎮 *Played* : ${game.played}`,
            `✅ *Wins*   : ${game.wins}`,
            `🛑 *Losses* : ${game.losses}`,
            `🤝 *Draws*  : ${game.draws}`,
            `🔥 *Streak* : ${game.streak}${game.best > 0 ? ` (best ${game.best})` : ''}`,
            `📈 *Win rate* : ${game.winRate}%`,
        ]

        if (games.length) {
            for (const row of games) {
                lines.push(`▸ ${gameLabel(row.game)} — ${row.wins}W/${row.losses}L/${row.draws}D`)
            }
        } else {
            lines.push('▸ No finished games yet.')
        }

        lines.push(
            '',
            '🎴 *ᴄᴏʟʟᴇᴄᴛɪᴏɴ*',
            `💰 *Ryo*   : ${coins.toLocaleString('en-US')}`,
            `🎴 *Cards* : ${collection.unique} unique / ${collection.total} total`,
            `🍃 *Deck*  : ${staged} staged${staged ? ` — ${config.prefix}m2coll to bank them` : ''}`,
            `⚡ *Best*  : ${topCard ? `${topCard.card.emoji} ${topCard.card.name} ×${topCard.copies}` : 'No cards yet'}`,
            `💍 *Wife*  : ${marriage ? `${marriage.name} (${marriage.series})` : 'Not married yet'}`,
            '',
            '⚡ *ᴀᴄᴛɪᴠɪᴛʏ*',
            `⭐ *Level* : ${progress.level} ${progressBar(progress)} ${progress.current}/${progress.needed}`,
            `💬 *XP*    : ${progress.total}`,
            `🏆 *Chat rank* : ${chatRank}`,
        )

        const caption = lines.join('\n')
        const marriageData: ProfileMarriage | null = marriage
            ? { name: marriage.name, series: marriage.series, imageUrl: marriage.image_url }
            : null
        const image = await renderProfileCard({
            name,
            number,
            role,
            wins: game.wins,
            losses: game.losses,
            draws: game.draws,
            played: game.played,
            winRate: game.winRate,
            streak: game.streak,
            best: game.best,
            rank: game.rank,
            coins,
            cardsUnique: collection.unique,
            cardsTotal: collection.total,
            level: progress.level,
            levelCurrent: progress.current,
            levelNeeded: progress.needed,
            chatRank,
            topCard: topCard ? `${topCard.card.name} ×${topCard.copies}` : 'No cards yet',
            games: games.map((row) => ({
                label: gameLabel(row.game),
                wins: row.wins,
                losses: row.losses,
                draws: row.draws,
            })),
        }, marriageData).catch(() => null)

        if (image) {
            await ctx.sock.sendMessage(
                ctx.chat,
                { image, caption, mentions: [target] },
                { quoted: ctx.msg },
            )
            return
        }

        await ctx.reply(caption)
    },
})

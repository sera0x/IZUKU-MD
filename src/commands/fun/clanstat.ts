// .clanstat: your clan at a glance. Tag, your role, roster size, treasury,
// tax rate, upkeep and this week's war points.
import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { money } from '../../features/economy.js'
import { weekKey } from '../../features/mine.js'

const MAX_MEMBERS = 30

ari({
    name: 'clanstat',
    description: 'Show your clan stats',
    category: 'fun',
    aliases: ['clan', 'cstats', 'clanstats'],
    usage: 'clanstat',
    cooldownMs: 1000,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        if (!membership) {
            await ctx.reply(`You are not in a clan. Start one with ${ctx.prefix}cclan <name> 🛡️`)
            return
        }
        const clan = db.clanById(membership.clan_id)
        if (!clan) {
            await ctx.reply('🛑 your clan record is missing, rejoin a clan.')
            return
        }
        const members = db.clanMembers(clan.id)
        const treasury = db.clanTreasury(clan.id)
        const standing = db.clanWarStandings(weekKey()).find((row) => row.id === clan.id)
        const rank = db.clanWarStandings(weekKey()).findIndex((row) => row.id === clan.id) + 1
        const online = members.length >= MAX_MEMBERS ? 'full' : `${MAX_MEMBERS - members.length} spots open`

        await ctx.reply(
            [
                `🛡️ *[${clan.tag}] ${clan.name}*`,
                ...(clan.bio ? [`🌿 ${clan.bio}`] : []),
                '',
                `👤 your role: *${membership.role}*`,
                `👥 members: *${members.length}/${MAX_MEMBERS}* (${online})`,
                `💰 treasury: *${money(treasury.balance)}*`,
                `⚙️ clan tax: *${treasury.tax_pct}%* on casino profit`,
                `🏦 weekly upkeep: *${money(db.clanUpkeep())}*`,
                `📈 cumulative profit: *${money(db.clanProfit(clan.id))}*`,
                `💼 clan net worth: *${money(db.clanNetWorth(clan.id))}* (members + treasury)`,
                `🏆 war this week: *${standing ? standing.points : 0} pts*${rank ? ` · rank #${rank}` : ''}`,
            ].join('\n'),
        )
    },
})

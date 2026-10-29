import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { money } from '../../features/economy.js'
import { weekKey } from '../../features/mine.js'

ari({
    name: 'clantax',
    description: 'Set the clan casino tax (head only, 0-20 percent)',
    category: 'fun',
    usage: 'clantax <0-20>',
    cooldownMs: 0,
    run: async (ctx) => {
        const mine = db.clanOf(ctx.sender)
        if (!mine) return void (await ctx.reply('you are not in a clan 🛑'))
        if (mine.role !== 'leader') return void (await ctx.reply('only the clan leader can set the tax 🛑'))
        const pct = Number.parseInt(ctx.args[0] ?? '', 10)
        if (!Number.isFinite(pct) || pct < 0 || pct > 20) return void (await ctx.reply(`usage: ${ctx.prefix}clantax <0-20> 🛑`))
        db.setClanTax(mine.clan_id, pct)
        await ctx.reply(`🏦 clan tax set to ${pct}% of member casino profit`)
    },
})

ari({
    name: 'clantreasury',
    description: 'View your clan treasury',
    category: 'fun',
    usage: 'clantreasury',
    cooldownMs: 0,
    run: async (ctx) => {
        const mine = db.clanOf(ctx.sender)
        if (!mine) return void (await ctx.reply('you are not in a clan 🛑'))
        const t = db.clanTreasury(mine.clan_id)
        await ctx.reply(`🏦 treasury: ${money(t.balance)}\ntax: ${t.tax_pct}%\nweekly upkeep due sunday: ${money(db.clanUpkeep())}`)
    },
})

ari({
    name: 'clanwar',
    description: 'Weekly clan war standings (points = ryo gambled)',
    category: 'fun',
    usage: 'clanwar',
    cooldownMs: 0,
    run: async (ctx) => {
        const rows = db.clanWarStandings(weekKey())
        if (rows.length === 0) return void (await ctx.reply('no clans yet'))
        const lines = rows.map((r, i) => `${i + 1}. ${r.name}: ${r.points.toLocaleString('en-US')} pts`)
        await ctx.reply(`⚔️ clan war this week\n${lines.join('\n')}`)
    },
})

ari({
    name: 'clanupkeep',
    description: 'Owner: set the weekly clan upkeep in ryo',
    category: 'owner',
    usage: 'clanupkeep <amount>',
    cooldownMs: 0,
    run: async (ctx) => {
        if (!ctx.isOwner) return void (await ctx.reply('owner only 🛑'))
        const amount = Number.parseInt(ctx.args[0] ?? '', 10)
        if (!Number.isFinite(amount) || amount < 0) return void (await ctx.reply(`usage: ${ctx.prefix}clanupkeep <amount> 🛑`))
        db.setClanUpkeep(amount)
        await ctx.reply(`🏦 weekly clan upkeep set to ${money(amount)}`)
    },
})


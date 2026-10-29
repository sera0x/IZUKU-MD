import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { pokeGuard } from '../../features/tcg.js'

ari({
    name: 'ptop',
    description: 'Top pokemon collectors by total power',
    category: 'games',
    aliases: ['pokemon top', 'pokemoncol', 'pokedex top'],
    usage: 'ptop | ptop <name>',
    cooldownMs: 1000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        const rows = db.pokeList(ctx.sender)
        if (!rows.length) {
            await ctx.reply(`No pokemon caught yet. Wait for ${ctx.prefix}pspawn. 🛑`)
            return
        }

        // Group by name and sum power
        const byName = new Map<string, { totalPower: number; count: number; rarity: string }>()
        for (const row of rows) {
            const key = row.name.toLowerCase()
            const existing = byName.get(key) ?? { totalPower: 0, count: 0, rarity: row.rarity }
            existing.totalPower += row.power
            existing.count += 1
            // Keep the first rarity seen
            if (!existing.rarity) existing.rarity = row.rarity
            byName.set(key, existing)
        }

        // Sort by total power descending
        const sorted = [...byName.entries()]
            .sort((a, b) => b[1].totalPower - a[1].totalPower)

        const medals = ['🥇', '🥈', '🥉', '▸', '▸']

        const shown = sorted.slice(0, 10)
        const lines = shown.map(([name, data], index) => {
            const medal = medals[index] ?? '▸'
            return `${medal} *${name}* — Power ${data.totalPower.toLocaleString('en-US')} + (${data.count} pokemon, ${data.rarity || 'common'})`
        })

        await ctx.reply(
            `🐾 *Your pokemon collection — Top ${shown.length} by total power*\n\n` +
            lines.join('\n'),
        )
    },
})
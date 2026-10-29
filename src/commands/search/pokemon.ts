import axiosRaw from 'axios'
const axios = axiosRaw as any
import { ari } from '../../bot/registry.js'
import { pokeGuard } from '../../features/tcg.js'

const TIMEOUT = 10_000

ari({
    name: 'pokesearch',
    description: 'Look up any pokemon: types, abilities, base stats, height and weight',
    category: 'games',
    aliases: ['pokemon', 'pokedexlookup'],
    usage: 'pokesearch <name>',
    cooldownMs: 2000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        const query = ctx.args.join(' ').trim().toLowerCase()
        if (!query) {
            await ctx.reply(`Usage: *${ctx.prefix}pokesearch pikachu* 🛑`)
            return
        }

        let entry: any
        try {
            const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(query)}`, {
                timeout: TIMEOUT,
                validateStatus: () => true,
            })
            entry = res.data
        } catch {
            await ctx.reply('PokeAPI could not be reached, try again in a moment 🌧️')
            return
        }

        if (!entry?.id) {
            await ctx.reply(`No pokemon called *${query}* found. 🛑`)
            return
        }

        const statOf = (name: string): number =>
            entry.stats?.find((s: any) => s.stat.name === name)?.base_stat ?? 0
        const total = (entry.stats ?? []).reduce((sum: number, s: any) => sum + s.base_stat, 0)

        const lines = [
            `⚡ *${String(entry.name).replace(/-/g, ' ').toUpperCase()}* · #${entry.id}`,
            '',
            `🔥 *Type* : ${(entry.types ?? []).map((t: any) => t.type.name).join(', ')}`,
            `🧠 *Abilities* : ${(entry.abilities ?? []).filter((a: any) => !a.is_hidden).map((a: any) => String(a.ability.name).replace(/-/g, ' ')).join(', ') || '—'}`,
            `📏 *Height* : ${entry.height ? (entry.height / 10).toFixed(1) + ' m' : '?'} · ⚖️ *Weight* : ${entry.weight ? (entry.weight / 10).toFixed(1) + ' kg' : '?'}`,
            '',
            '*Base stats*',
            `▸ HP ${statOf('hp')} · Atk ${statOf('attack')} · Def ${statOf('defense')}`,
            `▸ SpA ${statOf('special-attack')} · SpD ${statOf('special-defense')} · Spe ${statOf('speed')}`,
            `▸ *Total* : ${total}`,
            '',
            entry.sprites?.other?.['official-artwork']?.front_default || entry.sprites?.front_default || '',
        ].filter((l) => l !== '')

        const text = lines.filter((l) => !l.startsWith('http')).join('\n')
        const art = entry.sprites?.other?.['official-artwork']?.front_default || entry.sprites?.front_default
        if (art) {
            const sent = await ctx.sock.sendMessage(ctx.chat, { image: { url: art }, caption: text }, { quoted: ctx.msg }).catch(() => null)
            if (sent) return
        }
        await ctx.reply(text)
    },
})

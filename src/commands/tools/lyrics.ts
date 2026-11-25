import { ari } from '../../bot/registry.js'

const UA = 'IZUKU-MD/0.0.7 (+https://github.com/sera0x/IZUKU-MD)'

interface Suggestion {
    title?: string
    artist?: { name?: string }
}

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': UA, accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`request failed (${response.status})`)
    return (await response.json()) as T
}

const chunks = (text: string, size = 3500): string[] => {
    const parts: string[] = []
    let current = ''
    for (const line of text.split('\n')) {
        if (current && current.length + line.length + 1 > size) {
            parts.push(current)
            current = line
        } else {
            current = current ? `${current}\n${line}` : line
        }
    }
    if (current.trim()) parts.push(current)
    return parts
}

ari({
    name: 'lyrics',
    description: 'Find the lyrics of a song',
    category: 'tools',
    aliases: ['lyric'],
    usage: 'lyrics bohemian rhapsody',
    cooldownMs: 5000,
    run: async (ctx) => {
        const query = ctx.text.trim()
        if (!query) {
            await ctx.reply(`Usage: ${ctx.prefix}lyrics bohemian rhapsody`)
            return
        }

        try {
            const found = await getJson<{ data?: Suggestion[] }>(
                `https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`,
            )
            const hit = found.data?.find((item) => item.title && item.artist?.name)
            if (!hit?.title || !hit.artist?.name) {
                await ctx.reply(`I could not find lyrics for *${query}*. 🛑`)
                return
            }

            const song = await getJson<{ lyrics?: string }>(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(hit.artist.name)}/${encodeURIComponent(hit.title)}`,
            )
            const lyrics = (song.lyrics ?? '')
                .replace(/^Paroles de la chanson .*? par .*?\n/i, '')
                .replace(/\r/g, '')
                .trim()
            if (!lyrics) {
                await ctx.reply(`No lyrics came back for *${hit.title}*. 🛑`)
                return
            }

            const parts = chunks(lyrics)
            await ctx.reply(`🎵 *${hit.title}* — ${hit.artist.name}\n\n${parts[0] ?? lyrics}`)
            for (const part of parts.slice(1)) await ctx.reply(part)
        } catch (error) {
            await ctx.reply(`Lyrics lookup failed: ${(error as Error).message} 🛑`)
        }
    },
})

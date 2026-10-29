import axiosRaw from 'axios'
const axios = axiosRaw as any
import { ari } from '../../bot/registry.js'

const TIMEOUT = 10_000
const ANILIST_URL = 'https://graphql.anilist.co'
const QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 1) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      id
      siteUrl
      title { romaji english native }
      coverImage { large }
      description(asHtml: false)
      genres
      format
      episodes
      averageScore
      status
    }
  }
}`

const slice = (text: string, limit: number): string =>
    text && text.length > limit ? `${text.slice(0, limit).trim()}…` : text

const stripHtml = (html: string): string =>
    (html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

const titleCase = (s: string): string =>
    s ? s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '?'

export async function fetchAnime(query: string): Promise<any | null> {
    const res = await axios.post(
        ANILIST_URL,
        { query: QUERY, variables: { search: query } },
        {
            timeout: TIMEOUT,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            validateStatus: () => true,
        },
    )
    if (res.status >= 500) throw new Error(`anilist ${res.status}`)
    return res.data?.data?.Page?.media?.[0] ?? null
}

ari({
    name: 'anime',
    description: 'Look up any anime: score, episodes, status, genres',
    category: 'media',
    aliases: ['animesearch', 'animelookup'],
    usage: 'anime <title>',
    cooldownMs: 2000,
    run: async (ctx) => {
        const query = ctx.args.join(' ').trim()
        if (!query) {
            await ctx.reply(`Usage: *${ctx.prefix}anime my hero academia* 🛑`)
            return
        }

        let entry: any
        try {
            entry = await fetchAnime(query)
        } catch {
            await ctx.reply('search service down, try again 🛑')
            return
        }

        if (!entry) {
            await ctx.reply(`No anime called *${query}* found. 🛑`)
            return
        }

        const title = entry.title?.english || entry.title?.romaji || entry.title?.native || 'Unknown'
        const lines = [
            `🎌 *${title}*`,
            entry.title?.native && entry.title?.native !== title ? `🇯🇵 ${entry.title.native}` : '',
            '',
            `⭐ *Score* : ${entry.averageScore ? `${entry.averageScore}/100` : 'unrated'}`,
            `📺 *Format* : ${titleCase(entry.format)} · ${entry.episodes ? `${entry.episodes} eps` : 'unknown length'}`,
            `📊 *Status* : ${titleCase(entry.status)}`,
            `🎭 *Genres* : ${(entry.genres ?? []).join(', ') || '—'}`,
            '',
            slice(stripHtml(entry.description ?? ''), 400),
            '',
            entry.siteUrl ? `▸ ${entry.siteUrl}` : '',
        ]
        const caption = lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n')

        const cover = entry.coverImage?.large
        if (cover && typeof ctx.replyImage === 'function') {
            try {
                await ctx.replyImage(cover, caption)
                return
            } catch {
                // fall through to text-only
            }
        }
        await ctx.reply(caption)
    },
})

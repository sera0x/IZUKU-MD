import axiosRaw from 'axios'
const axios = axiosRaw as any

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MAX_BITRATE = 2_400_000

interface FxFormat {
    url?: string
    container?: string
    bitrate?: number
}

interface FxMedia {
    type?: string
    url?: string
    formats?: FxFormat[]
}

interface FxTweet {
    text?: string
    author?: { name?: string; screen_name?: string }
    media?: { all?: FxMedia[]; videos?: FxMedia[]; photos?: { url?: string }[] }
}

function tweetId(url: string): string | null {
    const match = /(?:twitter\.com|x\.com)\/(?:i\/status|(?:[^/]+)\/status(?:es)?)\/(\d{5,25})/.exec(url)
    return match ? match[1]! : null
}

function videoUrl(item: FxMedia): string | undefined {
    const formats = (item.formats ?? [])
        .filter((format) => format.url && (format.container ?? 'mp4') === 'mp4')
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))
    const under = formats.filter((format) => (format.bitrate ?? 0) <= MAX_BITRATE)
    return (under.at(-1) ?? formats.at(-1))?.url ?? item.url
}

export async function twitterDl(url: string) {
    const id = tweetId(url)
    if (!id) throw new Error('That is not an X/Twitter status link')

    let tweet: FxTweet | undefined
    try {
        const response = await axios.get(`https://api.fxtwitter.com/i/status/${id}`, {
            headers: { 'User-Agent': UA, accept: 'application/json' },
            timeout: 25_000,
        })
        tweet = response.data?.tweet as FxTweet | undefined
    } catch {
        throw new Error('X did not answer for that post — it may be deleted or protected')
    }

    if (!tweet) throw new Error('X did not answer for that post — it may be deleted or protected')

    const media = tweet.media?.all ?? []
    const items: { url: string; type: 'video' | 'image' }[] = []

    for (const entry of media) {
        if (entry.type === 'video' || entry.type === 'gif') {
            const link = videoUrl(entry)
            if (link) items.push({ url: link, type: 'video' })
        } else if (entry.type === 'photo' && entry.url) {
            items.push({ url: entry.url, type: 'image' })
        }
    }

    if (!items.length) {
        for (const photo of tweet.media?.photos ?? []) {
            if (photo.url) items.push({ url: photo.url, type: 'image' })
        }
    }

    if (!items.length) throw new Error('That post has no photo or video')

    const text = (tweet.text ?? '').trim().slice(0, 600)
    const author = tweet.author?.name ?? ''
    const handle = tweet.author?.screen_name ? `@${tweet.author.screen_name}` : ''
    const caption = ['*X*', text ? `_${text}_` : '', [author, handle].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join('\n')

    return { items, type: items[0]!.type, caption, url: items[0]!.url }
}

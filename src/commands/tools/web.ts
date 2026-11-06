import { ari } from '../../bot/registry.js'

const UA = 'IZUKU-MD/0.0.7 (+https://github.com/sera0x/IZUKU-MD)'

async function getJson<T>(url: string, timeoutMs = 7000): Promise<T> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': UA, accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`request failed (${response.status})`)
    return (await response.json()) as T
}

const round = (value: number, digits = 1): string => value.toFixed(digits).replace(/\.0$/, '')

const WEATHER: Record<number, string> = {
    0: 'Clear sky ☀️',
    1: 'Mainly clear 🌤️',
    2: 'Partly cloudy ⛅',
    3: 'Overcast ☁️',
    45: 'Fog 🌫️',
    48: 'Freezing fog 🌫️',
    51: 'Light drizzle 🌦️',
    53: 'Drizzle 🌦️',
    55: 'Heavy drizzle 🌦️',
    61: 'Light rain 🌧️',
    63: 'Rain 🌧️',
    65: 'Heavy rain 🌧️',
    66: 'Freezing rain 🌧️',
    67: 'Freezing rain 🌧️',
    71: 'Light snow 🌨️',
    73: 'Snow 🌨️',
    75: 'Heavy snow 🌨️',
    77: 'Snow grains 🌨️',
    80: 'Rain showers 🌦️',
    81: 'Rain showers 🌧️',
    82: 'Violent showers ⛈️',
    85: 'Snow showers 🌨️',
    86: 'Heavy snow showers 🌨️',
    95: 'Thunderstorm ⛈️',
    96: 'Thunderstorm with hail ⛈️',
    99: 'Thunderstorm with hail ⛈️',
}

interface GeoResult {
    results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[]
}

interface Forecast {
    current?: {
        temperature_2m?: number
        apparent_temperature?: number
        relative_humidity_2m?: number
        wind_speed_10m?: number
        weather_code?: number
    }
    current_units?: { temperature_2m?: string; wind_speed_10m?: string }
}

ari({
    name: 'weather',
    description: 'Show the current weather for a city',
    category: 'tools',
    aliases: ['forecast'],
    usage: 'weather Lagos',
    cooldownMs: 3000,
    run: async (ctx) => {
        const place = ctx.text.trim()
        if (!place) {
            await ctx.reply(`Usage: ${ctx.prefix}weather Lagos`)
            return
        }

        try {
            const geo = await getJson<GeoResult>(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
            )
            const location = geo.results?.[0]
            if (!location) {
                await ctx.reply(`I could not find *${place}*. 🛑`)
                return
            }

            const forecast = await getJson<Forecast>(
                `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`,
            )
            const now = forecast.current
            if (!now) throw new Error('no current weather')

            const label = [location.name, location.admin1, location.country].filter(Boolean).join(', ')

            await ctx.reply(
                [
                    `*Weather — ${label}*`,
                    `Condition : ${WEATHER[now.weather_code ?? -1] ?? 'Unknown'}`,
                    `Temp      : ${round(now.temperature_2m ?? 0)}${forecast.current_units?.temperature_2m ?? '°C'} (feels ${round(now.apparent_temperature ?? 0)}°)`,
                    `Humidity  : ${Math.round(now.relative_humidity_2m ?? 0)}%`,
                    `Wind      : ${round(now.wind_speed_10m ?? 0)} ${forecast.current_units?.wind_speed_10m ?? 'km/h'}`,
                ].join('\n'),
            )
        } catch (error) {
            await ctx.reply(`Weather lookup failed: ${(error as Error).message} 🛑`)
        }
    },
})

interface Rates {
    amount?: number
    base?: string
    date?: string
    rates?: Record<string, number>
}

ari({
    name: 'currency',
    description: 'Convert money between currencies',
    category: 'tools',
    aliases: ['fx', 'exchange'],
    usage: 'currency 100 usd eur',
    cooldownMs: 3000,
    run: async (ctx) => {
        const [rawAmount, from, to] = ctx.args
        const amount = Number(rawAmount)
        if (!Number.isFinite(amount) || amount <= 0 || !from || !to) {
            await ctx.reply(`Usage: ${ctx.prefix}currency 100 usd eur`)
            return
        }

        const base = from.toUpperCase()
        const target = to.toUpperCase()

        try {
            const data = await getJson<Rates>(
                `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(target)}`,
            )
            const rate = data.rates?.[target]
            if (!rate) {
                await ctx.reply(`I do not know *${target}* (or it is the same as *${base}*). 🛑`)
                return
            }

            await ctx.reply(
                [
                    `💱 *${amount} ${base} = ${round(amount * rate, 2)} ${target}*`,
                    `Rate : 1 ${base} = ${round(rate, 4)} ${target}`,
                    `Date : ${data.date ?? 'today'}`,
                ].join('\n'),
            )
        } catch (error) {
            await ctx.reply(`Conversion failed: ${(error as Error).message} 🛑`)
        }
    },
})

ari({
    name: 'qr',
    description: 'Turn text into a QR code image',
    category: 'tools',
    aliases: ['qrcode'],
    usage: 'qr https://example.com',
    cooldownMs: 3000,
    run: async (ctx) => {
        const text = ctx.text.trim()
        if (!text) {
            await ctx.reply(`Usage: ${ctx.prefix}qr https://example.com`)
            return
        }

        const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=16&data=${encodeURIComponent(text.slice(0, 900))}`
        await ctx.replyImage(url, `QR for: ${text.slice(0, 120)}`)
    },
})

interface WikiSummary {
    title?: string
    description?: string
    extract?: string
    content_urls?: { desktop?: { page?: string } }
}

ari({
    name: 'wiki',
    description: 'Look up a topic on Wikipedia',
    category: 'tools',
    aliases: ['wikipedia'],
    usage: 'wiki Mount Kilimanjaro',
    cooldownMs: 3000,
    run: async (ctx) => {
        const query = ctx.text.trim()
        if (!query) {
            await ctx.reply(`Usage: ${ctx.prefix}wiki Mount Kilimanjaro`)
            return
        }

        try {
            const data = await getJson<WikiSummary>(
                `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, '_'))}`,
            )
            if (data.extract?.trim()) {
                await ctx.reply(
                    [
                        `*${data.title ?? query}*`,
                        data.description ? `_${data.description}_` : '',
                        '',
                        data.extract.slice(0, 900),
                        data.content_urls?.desktop?.page ? `\n${data.content_urls.desktop.page}` : '',
                    ]
                        .filter((line) => line !== '')
                        .join('\n'),
                )
                return
            }

            const search = await getJson<{ query?: { search?: { title: string }[] } }>(
                `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(query)}`,
            )
            const titles = (search.query?.search ?? []).map((entry) => entry.title)
            await ctx.reply(
                titles.length
                    ? [`Nothing exact for *${query}*. Try:`, ...titles.map((title) => `▸ ${title}`)].join('\n')
                    : `Nothing found for *${query}*. 🛑`,
            )
        } catch (error) {
            await ctx.reply(`Wikipedia lookup failed: ${(error as Error).message} 🛑`)
        }
    },
})

interface IpInfo {
    success?: boolean
    ip?: string
    country?: string
    region?: string
    city?: string
    connection?: { isp?: string; org?: string }
    timezone?: { id?: string }
    message?: string
}

ari({
    name: 'ip',
    description: 'Look up where an IP address is located',
    category: 'tools',
    aliases: ['iplookup', 'whoisip'],
    usage: 'ip 8.8.8.8',
    cooldownMs: 3000,
    run: async (ctx) => {
        const target = ctx.args[0] ?? ''
        try {
            const data = await getJson<IpInfo>(`https://ipwho.is/${encodeURIComponent(target)}`)
            if (!data.success) {
                await ctx.reply(`${data.message ?? 'That IP could not be resolved'} 🛑`)
                return
            }

            await ctx.reply(
                [
                    `*IP ${data.ip ?? target}*`,
                    `Location : ${[data.city, data.region, data.country].filter(Boolean).join(', ') || 'unknown'}`,
                    `ISP : ${data.connection?.isp ?? data.connection?.org ?? 'unknown'}`,
                    `Timezone : ${data.timezone?.id ?? 'unknown'}`,
                ].join('\n'),
            )
        } catch (error) {
            await ctx.reply(`IP lookup failed: ${(error as Error).message} 🛑`)
        }
    },
})

interface DictionaryEntry {
    word?: string
    phonetic?: string
    meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[]
}

ari({
    name: 'define',
    description: 'Look up a word in the dictionary',
    category: 'tools',
    aliases: ['dict', 'dictionary'],
    usage: 'define serendipity',
    cooldownMs: 3000,
    run: async (ctx) => {
        const word = (ctx.args[0] ?? '').toLowerCase().replace(/[^a-z'-]/g, '')
        if (!word) {
            await ctx.reply(`Usage: ${ctx.prefix}define serendipity`)
            return
        }

        try {
            const data = await getJson<DictionaryEntry[]>(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
            )
            const entry = data[0]
            const meaning = entry?.meanings?.[0]
            const definition = meaning?.definitions?.[0]

            if (!definition?.definition) {
                await ctx.reply(`No definition found for *${word}*. 🛑`)
                return
            }

            await ctx.reply(
                [
                    `*${entry?.word ?? word}*${entry?.phonetic ? ` ${entry.phonetic}` : ''}`,
                    meaning?.partOfSpeech ? `_${meaning.partOfSpeech}_` : '',
                    '',
                    definition.definition,
                    definition.example ? `\nExample: _${definition.example}_` : '',
                ]
                    .filter((line) => line !== '')
                    .join('\n'),
            )
        } catch {
            await ctx.reply(`No definition found for *${word}*. 🛑`)
        }
    },
})

ari({
    name: 'shorten',
    description: 'Shorten a long link',
    category: 'tools',
    aliases: ['shorturl', 'tinyurl'],
    usage: 'shorten https://example.com/very/long/path',
    cooldownMs: 3000,
    run: async (ctx) => {
        const target = (ctx.args[0] ?? '').trim()
        if (!/^https?:\/\/\S+$/i.test(target)) {
            await ctx.reply(`Usage: ${ctx.prefix}shorten https://example.com/very/long/path`)
            return
        }

        try {
            const response = await fetch(
                `https://is.gd/create.php?format=simple&url=${encodeURIComponent(target)}`,
                { signal: AbortSignal.timeout(7000), headers: { 'user-agent': UA } },
            )
            const body = (await response.text()).trim()
            if (!response.ok || !/^https?:\/\//.test(body)) {
                throw new Error(body.slice(0, 120) || `request failed (${response.status})`)
            }
            await ctx.reply(`🔗 ${body}`)
        } catch (error) {
            await ctx.reply(`Could not shorten that link: ${(error as Error).message} 🛑`)
        }
    },
})

ari({
    name: 'translate',
    description: 'Translate text into another language',
    category: 'tools',
    aliases: ['tr'],
    usage: 'translate fr good morning',
    cooldownMs: 3000,
    run: async (ctx) => {
        const language = (ctx.args[0] ?? '').toLowerCase()
        const text = ctx.args.slice(1).join(' ').trim()
        if (!/^[a-z]{2}(-[a-z]{2})?$/.test(language) || !text) {
            await ctx.reply(`Usage: ${ctx.prefix}translate fr good morning`)
            return
        }

        try {
            const response = await fetch(
                `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(language)}&dt=t&q=${encodeURIComponent(text.slice(0, 900))}`,
                { signal: AbortSignal.timeout(7000), headers: { 'user-agent': UA } },
            )
            if (!response.ok) throw new Error(`request failed (${response.status})`)

            const data = (await response.json()) as [string[][], unknown, string]
            const translated = (data[0] ?? []).map((part) => part[0] ?? '').join('').trim()
            if (!translated) throw new Error('empty translation')

            await ctx.reply(
                [`*${data[2] ?? 'auto'} → ${language}*`, '', translated].join('\n'),
            )
        } catch {
            await ctx.reply('Translation failed. 🛑')
        }
    },
})

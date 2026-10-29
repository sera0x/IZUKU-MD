import { config } from '../../config.js'
import { runtime } from '../../runtime.js'
import { db } from '../../db/index.js'
import { commandsByCategory, ari, findCommand } from '../../bot/registry.js'
import { themeFor } from '../../features/themes.js'
import { dateLines, formatUptime, memoryLine, platformLabel } from '../../features/system.js'
import { boxBottom, smallCaps } from '../../features/text.js'
import type { Category, Command } from '../../bot/types.js'

const ORDER: Category[] = ['general', 'group', 'tools', 'media', 'fun', 'games', 'afk', 'owner']

// The arena pair is always on: it needs no group activation and works in DMs.
const ALWAYS_ON_GAMES = new Set(['ttt', 'tictactoe', 'wcg', 'wordchain'])

// Some legacy theme URLs are dead or reject hotlinking. Skip a failed image
// for a while and try the theme's next picture instead of falling back to text.
const imageFailures = new Map<string, number>()
const IMAGE_RETRY_MS = 15 * 60 * 1000

// Two lightweight renderers rotate twice a day. This is only a couple of
// string templates, so it adds no storage or background work.
const MENU_LAYOUT_MS = 12 * 60 * 60 * 1000
const menuLayout = (): 0 | 1 => (Math.floor(Date.now() / MENU_LAYOUT_MS) % 2) as 0 | 1

// One command per line keeps every name readable on a phone screen.
const commandLines = (commands: Command[], prefix: string): string[] =>
    commands.map((command) => `│ ▸ *${prefix}${command.name}*`)

function details(command: Command): string {
    const flags = [
        command.ownerOnly ? 'owner only' : '',
        command.groupOnly ? 'groups only' : '',
        command.adminOnly ? 'admins only' : '',
        command.botAdmin ? 'bot admin' : '',
    ].filter(Boolean)

    const top = `╭─〔 *${config.prefix}${command.name}* 〕`
    return [
        top,
        `│ *${command.description ?? command.category}*`,
        command.usage ? `│ *Usage* : ${config.prefix}${command.usage}` : '',
        command.aliases.length ? `│ *Aliases* : ${command.aliases.join(', ')}` : '',
        `│ *Category* : ${command.category}${flags.length ? ` · ${flags.join(' · ')}` : ''}`,
        boxBottom(top),
    ]
        .filter(Boolean)
        .join('\n')
}

function categoryBox(category: Category, commands: Command[], prefix: string, titleOverride?: string): string {
    const title = smallCaps(titleOverride ?? category)
    const top = `╭─〔 *${title}* 〕`
    return [top, ...commandLines(commands, prefix), boxBottom(top)].join('\n')
}

function categoryStrip(category: Category, commands: Command[], prefix: string, titleOverride?: string): string {
    const title = smallCaps(titleOverride ?? category)
    const rule = '─'.repeat(Math.max(4, 18 - [...title].length))
    return [`*${title}* ${rule}`, ...commandLines(commands, prefix)].join('\n')
}

ari({
    name: 'help',
    description: 'Show the menu or details for one command',
    category: 'general',
    aliases: ['menu', 'cmds', 'h'],
    usage: 'help [command|category]',
    run: async (ctx) => {
        const [query] = ctx.args
        const layout = menuLayout()

        // Collection games are opt-in per group (.agb live). Until a mod opens
        // them, the card and pokemon commands stay out of the menu entirely and
        // only the plain bot is advertised.
        const gamesOn = ctx.isGroup && db.gameActive(ctx.chat)
        const casinoOn = ctx.isGroup && db.casinoEnabled(ctx.chat)
        const CASINO_NAMES = new Set(['slot', 'mine', 'mpick', 'cashout'])
        const permitted = (entry: Command): boolean =>
            (!entry.ownerOnly || ctx.isOwner) &&
            (entry.category !== 'games' || gamesOn || ALWAYS_ON_GAMES.has(entry.name) || (casinoOn && CASINO_NAMES.has(entry.name)))
        const GAMES_OFF = `Cards and games are not active here yet. A mod can open them. 🛑`

        if (query) {
            const category = [...commandsByCategory().keys()].find(
                (name) => name.toLowerCase() === query.toLowerCase(),
            )

            // A category name wins over a command alias: ".help games" used to
            // resolve to the .streak alias and print one card instead of the
            // whole games list.
            const command = category ? undefined : findCommand(query)
            if (command) {
                await ctx.reply(details(command))
                return
            }

            if (!category) {
                await ctx.reply(`No command or category named *${query}*. 🛑`)
                return
            }

            const all = (commandsByCategory().get(category) ?? [])
                .filter(permitted)
                .sort((a, b) => a.name.localeCompare(b.name))

            if (!all.length) {
                await ctx.reply(category === 'games' ? GAMES_OFF : 'No commands in that category. 🛑')
                return
            }

            // Eclipse-style paging: ".help fun 2" shows the second page.
            const PAGE = 20
            const pages = Math.max(1, Math.ceil(all.length / PAGE))
            const page = Math.min(Math.max(1, Number(ctx.args[1]) || 1), pages)
            const visible = all.slice((page - 1) * PAGE, page * PAGE)
            const title = pages > 1 ? category + ' (' + page + '/' + pages + ')' : category

            await ctx.reply(
                layout === 0
                    ? categoryBox(category, visible, config.prefix, title)
                    : categoryStrip(category, visible, config.prefix, title),
            )
            return
        }

        // Eclipse-style worlds menu: only in groups where the anchor
        // activated the game (.agb live). Otherwise: the normal menu.
        // Worlds menu only in groups where the anchor ran .agb live.
        const gameMenu = gamesOn
        const WORLDS: Array<{ title: string; icon: string; categories: Category[] }> = [
            { title: 'Card Hall', icon: '▫', categories: (config.gamesEnabled ? (['games'] as Category[]) : []).filter((c) => commandsByCategory().has(c)) },
            { title: 'Profile & Ranks', icon: '\uD83D\uDC64', categories: ['general'] },
            { title: 'Media & Utils', icon: '\uD83D\uDEE0\uFE0F', categories: (['tools', 'media', 'search'] as Category[]).filter((c) => commandsByCategory().has(c)) },
            { title: 'Group Desk', icon: '\u2699\uFE0F', categories: ['group'] },
            { title: 'Owner', icon: '\uD83D\uDD11', categories: (['owner', 'afk'] as Category[]).filter((c) => commandsByCategory().has(c)) },
        ]

        const sections: string[] = []
        let visibleCount = 0
        const seen = new Set<Category>()

        // Activated sections only, every command name listed in full.
        // cards: .agb live, pokemon: .agb poke, casino: .agb gamble.
        if (ctx.isGroup && !query) {
            const cardsOn = db.gameActive(ctx.chat)
            const pokeOn = db.pokeEnabled(ctx.chat)
            const casinoNow = db.casinoEnabled(ctx.chat)
            const listNames = (cat: Category, keep?: (name: string) => boolean): string[] =>
                (commandsByCategory().get(cat) ?? [])
                    .filter(permitted)
                    .filter((c) => (keep ? keep(c.name) : true))
                    .map((c) => c.name)
                    .sort((a, b) => a.localeCompare(b))
            const pokeNames = new Set(['pspawn', 'catch', 'pokedeck', 'pokecollection', 'pokebattle', 'pinfo', 'pstart', 'pswap', 'pcrelease', 'prelease', 'plearn', 'move', 'ptop', 'pokesearch', 'mbuy', 'market', 'sell', 'quest'])
            const gated: Array<{ title: string; names: string[] }> = []
            if (cardsOn) gated.push({ title: 'Cards', names: listNames('games', (n) => !CASINO_NAMES.has(n) && !pokeNames.has(n)) })
            if (pokeOn) gated.push({ title: 'Pokemon', names: listNames('games', (n) => pokeNames.has(n)) })
            if (casinoNow) gated.push({ title: 'Casino', names: [...CASINO_NAMES].filter((n) => commandsByCategory().get('games')?.some((c) => c.name === n)) })
            for (const block of gated) {
                if (!block.names.length) continue
                visibleCount += block.names.length
                sections.push(`*${block.title}* · ${block.names.length}\n${block.names.map((n) => `${config.prefix}${n}`).join('  ')}`)
            }
        }

        for (const world of gameMenu ? WORLDS : []) {
            const names: string[] = []
            for (const category of world.categories) {
                const commands = commandsByCategory().get(category) ?? []
                const visible = commands.filter(permitted).sort((a, b) => a.name.localeCompare(b.name))
                if (!visible.length) continue
                seen.add(category)
                visibleCount += visible.length
                names.push(...visible.map((c) => c.name))
            }
            if (!names.length) continue
            sections.push(`${world.icon} *${world.title}* · ${names.length} · ${config.prefix}help ${world.categories[0]}`)
            sections.push('')
        }

        // Categories not covered by the worlds overview still appear in full.
        for (const [category, commands] of [...commandsByCategory()].sort(
            ([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b),
        )) {
            if (seen.has(category)) continue
            const visible = commands.filter(permitted).sort((a, b) => a.name.localeCompare(b.name))
            if (!visible.length) continue
            visibleCount += visible.length
            sections.push(
                layout === 0
                    ? categoryBox(category, visible, config.prefix)
                    : categoryStrip(category, visible, config.prefix),
            )
        }

        const theme = themeFor(db.theme(ctx.sender) || 'plain')
        const clock = dateLines()
        const headerTop = `🍃 *${smallCaps(theme.title)} · ᴍᴇɴᴜ*`
        const stats = [
            `*Prefix* : ${config.prefix}`,
            `*User* : ${ctx.senderName}`,
            `*Date* : ${clock.date} · ${clock.time}`,
            theme.botName !== theme.title ? `*Bot* : ${theme.botName}` : '',
            `*Cmds* : ${visibleCount}`,
            `*Uptime* : ${formatUptime(Date.now() - runtime.startedAt)}`,
            `*Ram* : ${memoryLine()}`,
            `*OS* : ${platformLabel()}`,
        ].filter(Boolean)
        const header = [
            headerTop,
            `_${theme.body}_`,
            ...stats.map((line) => `▸ ${line}`),
        ].join('\n')

        const menu = [
            header,
            '',
            sections.join('\n\n'),
            '',
            ...(gameMenu
                ? [
                      `🍃 *ꜱʜᴏʀᴛᴄᴜᴛꜱ*`,
                      `▸ open a section: *${config.prefix}help games*`,
                      `▸ one command: *${config.prefix}help claim*`,
                      `▸ full menu: *${config.prefix}help*`,
                      '',
                  ]
                : []),
`*${config.prefix}help <command>* · ${theme.footer}`,
        ].join('\n')

        const now = Date.now()
        const candidates = theme.images.filter((url) => (imageFailures.get(url) ?? 0) <= now)
        const start = candidates.length ? Math.floor(Math.random() * candidates.length) : 0

        for (let offset = 0; offset < candidates.length; offset += 1) {
            const image = candidates[(start + offset) % candidates.length] as string
            try {
                const sent = await ctx.replyImage(image, menu)
                if (sent) return
            } catch {
                imageFailures.set(image, now + IMAGE_RETRY_MS)
            }
        }

        await ctx.reply(menu)
    },
})

import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { db } from '../../db/index.js'
import { balanceOf, money } from '../../features/economy.js'

/** A pull ticket is the only way to roll, and it leans the odds your way. */
const PULL_TICKET_PRICE = 1800
/** Share of ticketed pulls that land in tiers 4-6/S; the rest is bad luck. */
const PULL_LUCK = 0.4
import { latestNameFor } from '../../features/message-store.js'
import { statsKey } from '../../features/game-stats.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { sameUser } from '../../bot/identity.js'
import {
    cardBody,
    claimCard,
    forceDrop,
    randomCard,
    randomCardForTier,
    cardArt,
    cardMedia,
    cardDropCaption,
    findCards,
    pickFreshCard,
    refreshCatalogNow,
    refreshCatalogSoon,
    tierRank as tierWeight,
    gameGuard,
    deckOf,
    renderDeckImage,
    CARD_BY_ID,
    CARDS,
    rarityForTier,
    type Card,
} from '../../features/tcg.js'
import { unlink } from 'node:fs/promises'

type NumberedCard = { n: number; card: Card; copies: number }

/**
 * Stable per-user card numbers: position in the user's collection in the order
 * cards were first acquired. Existing numbers never shift when a card is added.
 */
function numberedCollection(user: string): NumberedCard[] {
    return db
        .cards(user)
        .map((row, index) => ({ n: index + 1, card: CARD_BY_ID.get(row.card_id), copies: row.copies }))
        .filter((entry): entry is { n: number; card: Card; copies: number } => Boolean(entry.card))
}

const TIER_ICON: Record<string, string> = { S: '👑', '6': '💠', '5': '🟢', '4': '🔶', '3': '🟣', '2': '🟢', '1': '⚪' }
const TIER_ORDER = ['S', '6', '5', '4', '3', '2', '1']
const tierOf = (card: Card): string => String(card.tier ?? '').trim().toUpperCase() || '?'
const tierIcon = (tier: string): string => TIER_ICON[tier] ?? '🍃'
/** Higher is better: tier first (S > 6 > ... > 1), then power, then name. */
const tierRank = (card: Card): number => {
    const index = TIER_ORDER.indexOf(tierOf(card))
    return index >= 0 ? 100 - index * 10 : 0
}
/** One listing row: every owned card, collection and deck copies folded together. */
type ListedCard = { n: number; card: Card; copies: number }

/**
 * Every card the user owns, numbered 1..n. Collection and deck are the same
 * thing here: a staged card is still owned, so it is listed once with its
 * total copies instead of being marked as "in deck".
 */
function listedCards(user: string): ListedCard[] {
    const rows = new Map<string, { card: Card; copies: number; order: number }>()
    for (const entry of numberedCollection(user)) {
        rows.set(entry.card.id, { card: entry.card, copies: entry.copies, order: entry.n })
    }
    for (const entry of deckOf(user)) {
        const existing = rows.get(entry.card.id)
        if (existing) existing.copies += entry.copies
        else rows.set(entry.card.id, { card: entry.card, copies: entry.copies, order: Number.MAX_SAFE_INTEGER })
    }
    return [...rows.values()]
        .sort((a, b) => a.order - b.order)
        .map((entry, index) => ({ n: index + 1, card: entry.card, copies: entry.copies }))
}

const listedBest = (a: ListedCard, b: ListedCard): number =>
    tierRank(b.card) - tierRank(a.card) || (b.card.power ?? 0) - (a.card.power ?? 0) || a.card.name.localeCompare(b.card.name)

ari({
    name: 'pull',
    description: 'Pull a card with a shop ticket (weighted to high tiers, not guaranteed)',
    category: 'fun',
    aliases: [],
    usage: 'pull',
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const user = ctx.sender

        // Pulls are bought: no free roll, the shop ticket is the entry price.
        if (!db.takeItem(user, 'pull_ticket', 1)) {
            await ctx.reply(
                [
                    '🎟️ *Pulls run on tickets.*',
                    '',
                    `▸ Buy one in *${ctx.prefix}shop* for *${money(PULL_TICKET_PRICE)}*`,
                    '▸ A ticket weighs the pull towards the high tiers…',
                    '▸ …but the shop does not always keep its promise 😬',
                ].join('\n'),
            )
            return
        }

        const lucky = Math.random() < PULL_LUCK
        let card: Card | undefined
        if (lucky) {
            const tiers = ['4', '5', '6', 'S']
            card = randomCardForTier(tiers[Math.floor(Math.random() * tiers.length)] ?? '4')
        }
        const pulled = card ?? randomCard()

        const owned = db.card(user, pulled.id)
        db.addCard(user, pulled.id)

        await ctx.sock.sendMessage(
            ctx.chat,
            cardMedia(
                await cardArt(pulled),
                [
                    owned ? '🔁 *Duplicate pull*' : '⚡ *New card!*',
                    '',
                    cardBody(pulled),
                    '',
                    lucky
                        ? '🎟️ *Ticket paid off* — the high tiers came through.'
                        : '😬 *Ticket fizzled* — the shop kept its word *that* time.',
                    owned ? `You now own *${owned.copies + 1}*.` : 'Added to your collection.',
                ].join('\n'),
            ),
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'claim',
    description: 'Claim the anime card that just dropped in this chat',
    category: 'fun',
    aliases: ['grab'],
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const claimed = claimCard(ctx.chat, ctx.sender)
        if (!claimed) {
            await ctx.reply(`There is no card waiting right now. 🛑`)
            return
        }
        if (claimed.deckFull) {
            await ctx.reply([
                '📦 Your deck is full (10/10).',
                '',
                `*${claimed.card.name}* is still waiting. Run *${ctx.prefix}m2coll all* to bank your deck, then claim again.`,
            ].join('\n'))
            return
        }

        // Animated cards must go out as video: sending that buffer as an
        // `image` made WhatsApp drop the media and show the text alone.
        await ctx.sock.sendMessage(
            ctx.chat,
            cardMedia(
                await cardArt(claimed.card),
                [
                    claimed.isNew ? '🟢 *ᴄʟᴀɪᴍᴇᴅ*' : '🔁 *ᴅᴜᴘʟɪᴄᴀᴛᴇ · ᴄʟᴀɪᴍᴇᴅ*',
                    '',
                    cardBody(claimed.card),
                    '',
                    claimed.isNew
                        ? `in your deck now. bank it with *${ctx.prefix}m2coll*.`
                        : `You now own *${claimed.copies}*.`,
                ].join('\n'),
            ),
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'cards',
    description: 'All your cards, best tier first. Add -tier to group them by tier',
    category: 'games',
    aliases: ['card'],
    usage: 'cards [-tier]',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const listed = listedCards(ctx.sender)
        if (!listed.length) {
            await ctx.reply(`You have no cards yet. Try *${ctx.prefix}pull* or claim a drop. 🛑`)
            return
        }
        const byTier = ctx.args.some((arg) => arg.toLowerCase() === '-tier' || arg.toLowerCase() === '--tier')
        const best = [...listed].sort(listedBest)[0]
        if (!best) return

        const total = listed.reduce((sum, entry) => sum + entry.copies, 0)
        const copiesNote = (entry: ListedCard): string => (entry.copies > 1 ? ` (x${entry.copies})` : '')
        const body: string[] = []
        if (byTier) {
            const tiers = new Map<string, ListedCard[]>()
            for (const entry of [...listed].sort(listedBest)) {
                const tier = tierOf(entry.card)
                tiers.set(tier, [...(tiers.get(tier) ?? []), entry])
            }
            for (const [tier, group] of tiers) {
                body.push(`${tierIcon(tier)} Tier ${tier}`)
                for (const entry of group) body.push(`#${entry.n} ➳ ${entry.card.name}${copiesNote(entry)}`)
                body.push('')
            }
        } else {
            for (const entry of listed) body.push(`#${entry.n} ➳ ${entry.card.name}${copiesNote(entry)}`)
        }

        const header = [`🍃 Cards | ${ctx.senderName} | ${byTier ? 'By Tier' : 'All'}`, `${listed.length} cards · ${total} copies`, '']
        const caption = [...header, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trim()
        await ctx.sock.sendMessage(ctx.chat, cardMedia(await cardArt(best.card), caption), { quoted: ctx.msg })
    },
})

ari({
    name: 'deck',
    description: 'Picture of your staging deck (claimed cards not yet in the binder)',
    category: 'games',
    aliases: [],
    usage: 'deck',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const deck = deckOf(ctx.sender)
        if (!deck.length) {
            await ctx.reply('Your deck is empty. Claim drops with *' + ctx.prefix + 'claim*. \u274c')
            return
        }
        const shown = deck.slice(0, 10)
        const { path, buffer } = await renderDeckImage(shown)
        const total = deck.reduce((sum, entry) => sum + entry.copies, 0)
        const lines = [`🍃 *ᴅᴇᴄᴋ · ${ctx.senderName}*`, `_${total} cards · showing ${shown.length}_`, '']
        shown.forEach((entry, index) => {
            lines.push(
                `🟢 *#${index + 1}* ${entry.card.name}${entry.copies > 1 ? ` ×${entry.copies}` : ''}`,
                `    ⚡ tier ${entry.card.tier ?? '?'}`,
                '',
            )
        })
        try {
            await ctx.sock.sendMessage(ctx.chat, { image: buffer, caption: lines.join('\n') }, { quoted: ctx.msg })
        } finally {
            await unlink(path).catch(() => undefined)
        }
    },
})

ari({
    name: 'movetodeck',
    description: 'Stage one collection card into your deck, by its .cs number or name',
    category: 'games',
    aliases: ['m2deck'],
        usage: 'cardtodeck <cs#> [cs#...]',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const tokens = ctx.args.join(' ').split(/[\s,]+/).filter(Boolean)
        if (tokens.length > 1 || (tokens.length === 1 && (tokens[0] ?? '').includes('-'))) {
            if (tokens.every((t) => /^\d+(-\d+)?$/.test(t))) {
                const nums = new Set<number>()
                let bad = false
                for (const t of tokens) {
                    if (t.includes('-')) {
                        const [x = 0, y = 0] = t.split('-').map(Number)
                        const lo = Math.min(x, y)
                        const hi = Math.max(x, y)
                        if (hi - lo > 50) { bad = true; break }
                        for (let i = lo; i <= hi; i++) nums.add(i)
                    } else nums.add(Number(t))
                }
                if (bad) {
                    await ctx.reply('That range is too big (max 50 numbers at once).')
                    return
                }
                const sorted = [...nums].filter((n) => n > 0).sort((x, y) => x - y)
                const movedNames: string[] = []
                const skipped: string[] = []
                for (const n of sorted) {
                    if (deckOf(ctx.sender).length >= 10) { skipped.push(`#${n} (deck full)`); continue }
                    const target = numberedCollection(ctx.sender).find((entry) => entry.n === n)
                    if (!target) { skipped.push(`#${n} (not in .cs)`); continue }
                    if (!db.takeCollectionCopy(ctx.sender, target.card.id)) { skipped.push(`#${n} (no spare copy)`); continue }
                    db.addDeckCard(ctx.sender, target.card.id)
                    movedNames.push(target.card.name)
                }
                if (movedNames.length === 0) {
                    await ctx.reply(`Nothing moved. ${skipped.join(', ')}`)
                    return
                }
                let msg = `\u2705 Moved ${movedNames.length} to your deck: ${movedNames.join(', ')}.`
                if (skipped.length) msg += ` Skipped: ${skipped.join(', ')}.`
                await ctx.reply(msg)
                return
            }
        }
        const query = ctx.args.join(' ').trim()
        if (!query) {
            await ctx.reply(`Usage: *${ctx.prefix}m2deck 254* (collection number from *${ctx.prefix}cs*) 🛑`)
            return
        }
        if (deckOf(ctx.sender).length >= 10) {
            await ctx.reply('Your deck is full (10). Move something out with *' + ctx.prefix + 'm2coll* first. \u274c')
            return
        }
        let target: { card: Card; copies: number } | undefined
        if (/^\d+$/.test(query)) {
            const n = Number(query)
            target = numberedCollection(ctx.sender).find((entry) => entry.n === n)
            if (!target) {
                await ctx.reply(`No card #${query} in your .cs list 🛑`)
                return
            }
        } else {
            const owned = numberedCollection(ctx.sender)
            target = owned.find((entry) => entry.card.name.toLowerCase() === query.toLowerCase()) ?? owned.find((entry) => entry.card.name.toLowerCase().includes(query.toLowerCase()))
            if (!target) {
                await ctx.reply(`No card matching *${query}* in your collection 🛑`)
                return
            }
        }
        const moved = db.takeCollectionCopy(ctx.sender, target.card.id)
        if (!moved) {
            await ctx.reply(`No spare copy of *${target.card.name}* left in your collection 🛑`)
            return
        }
        db.addDeckCard(ctx.sender, target.card.id)
        await ctx.reply(`\u2705 Staged *${target.card.name}* in your deck. See it with *${ctx.prefix}deck*.`)
    },
})

ari({
    name: 'cardsearch',
    description: 'Search your binder by name; each hit gets a number for .coll and .m2deck',
    category: 'games',
    aliases: ['cs'],
        usage: 'cardsearch <name>',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const query = ctx.args.join(' ').trim().toLowerCase()
        const owned = numberedCollection(ctx.sender)
        const deckHits = deckOf(ctx.sender)
            .map((d) => d.card)
            .filter((c) => !query || c.name.toLowerCase().includes(query) || c.series.toLowerCase().includes(query))
        if (!owned.length && !deckHits.length) {
            await ctx.reply('No Izuku cards in your collection \u274c')
            return
        }
        if (!owned.length && deckHits.length) {
            const lines = deckHits.map((c) => `\u{1F0CF} ${c.name} (Tier ${c.tier ?? '?'}) \u2014 in deck, move it with .m2coll to number it`)
            await ctx.reply(lines.join('\n'))
            return
        }
        const matches = query
            ? owned.filter((entry) => entry.card.name.toLowerCase().includes(query) || entry.card.series.toLowerCase().includes(query))
            : owned
        if (!matches.length && deckHits.length) {
            const lines = deckHits.map((c) => `\u{1F0CF} ${c.name} (Tier ${c.tier ?? '?'}) \u2014 in deck, move it with .m2coll to number it`)
            await ctx.reply(lines.join('\n'))
            return
        }
        if (!matches.length) {
            await ctx.reply('No Izuku cards in your collection \u274c')
            return
        }
        const shown = matches.slice(0, 50)
        const lines = shown.map(
            (entry) => `#${entry.n} ${entry.card.name} (Tier ${entry.card.tier ?? '?'}) \u00d7${entry.copies}`,
        )
        if (matches.length > shown.length) lines.push(`...and ${matches.length - shown.length} more, narrow the name`)
        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'cardcoll',
    description: 'Open a card by .cs number or name: art, tier and copies. No arg: collection overview',
    category: 'games',
    aliases: ['coll', 'collection'],
        usage: 'cardcoll [number|name]',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        if (!ctx.args.length) {
            // Collection overview: highest tier card art on top, then the numbered list.
            const user = ctx.sender
            const owned: Array<{ first_at: number; copies: number; card: Card }> = []
            for (const row of db.cards(user)) {
                const card = CARD_BY_ID.get(row.card_id)
                if (card) owned.push({ first_at: row.first_at, copies: row.copies, card })
            }
            if (!owned.length) {
                await ctx.reply('Your collection is empty. Claim a card first \u274c')
                return
            }
            const tierRank = (tier: string | undefined): number => {
                const value = (tier ?? '').trim().toUpperCase()
                if (value === 'S') return 7
                const num = Number(value)
                return Number.isFinite(num) ? num : 0
            }
            const top = [...owned].sort((a, b) => tierRank(b.card.tier) - tierRank(a.card.tier) || b.first_at - a.first_at)[0]
            if (!top) return
            const numbered = numberedCollection(user)
            const total = owned.reduce((sum, entry) => sum + entry.copies, 0)
            const shown = numbered
            const divider = '\u2500'.repeat(12)
            const lines = [
                `\uD83C\uDCCF Collection | ${ctx.senderName} \uD83C\uDCCF`,
                divider,
                `\uD83D\uDCE6 Total Cards: ${total}`,
                `\uD83D\uDD22 Numbered: ${numbered.length}`,
                divider,
            ]
            shown.forEach((entry, index) => {
                lines.push(`\uD83D\uDD37 #${entry.n} / \uD83C\uDCCF Name: ${entry.card.name} / \u2728 Tier: ${entry.card.tier ?? '?'} / \u00d7${entry.copies}`)
                if (index < shown.length - 1) lines.push(divider)
            })
            lines.push(divider, `open one with ${ctx.prefix}coll <number>`)
            await ctx.sock.sendMessage(ctx.chat, cardMedia(await cardArt(top.card), lines.join('\n')), { quoted: ctx.msg })
            return
        }
        const numbered = numberedCollection(ctx.sender)
        const needle = ctx.args.join(' ').trim().replace(/^#/, '').toLowerCase()
        const entry = /^\d+$/.test(needle)
            ? numbered.find((item) => item.n === Number(needle))
            : numbered.find((item) => item.card.id.toLowerCase() === needle || item.card.name.toLowerCase() === needle) ??
              numbered.find((item) => item.card.name.toLowerCase().includes(needle))
        if (!entry) {
            await ctx.reply(`No card *${needle || '?'}* in your collection 🛑 (try ${ctx.prefix}cards)`)
            return
        }
        const { card, copies } = entry
        await ctx.sock.sendMessage(
            ctx.chat,
            cardMedia(await cardArt(card), [cardBody(card), '', `#${entry.n} · Copies: *${copies}*`].join('\n')),
            { quoted: ctx.msg },
        )
    },
})


ari({
    name: 'give',
    description: 'Send coins to another user: .give @user <amount>',
    category: 'fun',
    aliases: ['pay'],
    usage: 'give @user <amount>',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const amountArg = ctx.args.find((arg) => /^\d+$/.test(arg))
        const amount = amountArg ? Number(amountArg) : 0
        const raw = resolveTarget(ctx)
        if (!raw || !Number.isSafeInteger(amount) || amount <= 0) {
            await ctx.reply(`Usage: *${ctx.prefix}give @user 500* (whole coins, above 0) 🛑`)
            return
        }
        const target = statsKey(await normalizeTarget(ctx, raw))
        if (sameUser(target, ctx.sender)) {
            await ctx.reply('You cannot give coins to yourself. 🛑')
            return
        }
        // spendCoins is an atomic check-and-subtract, so a balance race cannot overdraw.
        if (!db.spendCoins(ctx.sender, amount)) {
            await ctx.reply(
                `You need *${money(amount)}* to send that. You have *${money(balanceOf(ctx.sender))}*. 🛑`,
            )
            return
        }
        db.user(target)
        db.addCoins(target, amount)
        const receiver = (await targetName(ctx, target).catch(() => '')) || jidToNumber(target)
        await ctx.reply(
            `✅ Sent *${money(amount)}* to *${receiver}*\n▸ Your balance: *${money(balanceOf(ctx.sender))}*`,
        )
    },
})

ari({
    name: 'transfercard',
    description: 'Give one of your deck cards to another user: .tc <deck number|name> @user',
    category: 'games',
    aliases: ['tc'],
        usage: 'cardtransfer <deck#> @user',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const raw = resolveTarget(ctx)
        // The card query is everything except the @mention itself.
        const query = ctx.args.filter((arg) => !arg.startsWith('@')).join(' ').trim()
        if (!raw || !query) {
            await ctx.reply(`Usage: *${ctx.prefix}tc 4 @user* (deck number, see ${ctx.prefix}deck) or *${ctx.prefix}tc Izuku @user* 🛑`)
            return
        }
        const target = statsKey(await normalizeTarget(ctx, raw))
        if (sameUser(target, ctx.sender)) {
            await ctx.reply('You cannot send a card to yourself. 🛑')
            return
        }

        // A number is the card's position in the sender's DECK (1..deck length, deck order).
        // A name matches the deck first, then falls back to the collection.
        const deck = deckOf(ctx.sender)
        const needle = query.replace(/^#/, '').toLowerCase()
        let picked: Card | undefined
        let source: 'deck' | 'collection' = 'deck'
        if (/^\d+$/.test(needle)) {
            const n = Number(needle)
            if (n < 1 || n > deck.length) {
                await ctx.reply(`No card #${query} in your deck 🛑 (deck numbers run 1-${deck.length}, see ${ctx.prefix}deck)`)
                return
            }
            picked = deck[n - 1]?.card
        } else {
            picked =
                deck.find((item) => item.card.name.toLowerCase() === needle)?.card ??
                deck.find((item) => item.card.name.toLowerCase().includes(needle))?.card
            if (!picked) {
                const numbered = numberedCollection(ctx.sender)
                picked =
                    numbered.find((item) => item.card.name.toLowerCase() === needle)?.card ??
                    numbered.find((item) => item.card.name.toLowerCase().includes(needle))?.card
                source = 'collection'
            }
            if (!picked) {
                await ctx.reply(`No card *${query}* in your deck or collection 🛑 (see ${ctx.prefix}deck)`)
                return
            }
        }

        // Move exactly one copy: decrement the sender's row, or delete it when it was the last copy.
        if (!picked) {
            await ctx.reply(`No card *${query}* in your deck or collection 🛑 (see ${ctx.prefix}deck)`)
            return
        }
        const moved =
            source === 'deck'
                ? db.transferDeckCardCopy(ctx.sender, target, picked.id)
                : db.transferCardCopy(ctx.sender, target, picked.id)
        if (!moved) {
            await ctx.reply(`Could not send *${picked.name}*. 🛑`)
            return
        }
        const receiver = await targetName(ctx, target).catch(() => '')
        await ctx.reply(`✅ Sent *${picked.name}* to ${receiver || jidToNumber(target)}. It is in their deck.`)
    },
})

ari({
    name: 'animetop',
    description: 'Highest card collectors for one anime or series',
    category: 'games',
    aliases: ['atop', 'topanime', 'animecol', 'animeboard'],
    usage: 'animetop <anime> | animetop',
    cooldownMs: 1000,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return

        // Every series in the catalog, keyed case-insensitively.
        const series = new Map<string, Card[]>()
        for (const card of CARDS) {
            const key = card.series.trim().toLowerCase()
            if (!key) continue
            const bucket = series.get(key) ?? []
            bucket.push(card)
            series.set(key, bucket)
        }

        const rows = db.allCards().filter((row) => CARD_BY_ID.has(row.card_id))
        const ownerName = (jid: string): string =>
            latestNameFor(jid) || (sameUser(jid, ctx.sender) ? ctx.senderName : '') || jidToNumber(jid) || 'unknown'

        /** Rank every owner of a set of cards by copies held. */
        const rank = (cards: Card[]): Array<{ jid: string; total: number }> => {
            const ids = new Set(cards.map((card) => card.id))
            const byUser = new Map<string, { total: number }>()
            for (const row of rows) {
                if (!ids.has(row.card_id)) continue
                const current = byUser.get(row.user_jid) ?? { total: 0 }
                current.total += row.copies
                byUser.set(row.user_jid, current)
            }
            return [...byUser.entries()]
                .map(([jid, value]) => ({ jid, ...value }))
                .sort((a, b) => b.total - a.total)
        }

        const medals = ['🥇', '🥈', '🥉', '▸', '▸']

        const query = ctx.args.join(' ').trim().toLowerCase()
        if (!query) {
            const list = [...series.entries()]
                .map(([key, cards]) => ({ key, name: cards[0]?.series ?? key, count: cards.length }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            const shown = list.slice(0, 15).map((entry) => `▸ *${entry.name}* — ${entry.count} cards`)

            const overall = rank(CARDS).slice(0, 5)
            const board = overall.length
                ? overall.map((entry, index) => `${medals[index] ?? '▸'} *${ownerName(entry.jid)}* — ${entry.total} cards`)
                : ['_nobody owns a card yet_']

            await ctx.reply(
                [
                    '🏆 *Top collectors*',
                    ...board,
                    '',
                    '🎬 *ᴀɴɪᴍᴇ*',
                    ...shown,
                ].join('\n'),
            )
            return
        }

        const matches = [...series.entries()].filter(
            ([key, cards]) => key === query || key.startsWith(query) || key.includes(query) || cards[0]?.series.toLowerCase().includes(query),
        )
        if (!matches.length) {
            await ctx.reply(`No anime called *${ctx.args.join(' ')}* in the catalog. 🛑\n▸ Try *${ctx.prefix}animetop* for the list.`)
            return
        }
        if (matches.length > 1) {
            const names = matches.slice(0, 8).map(([, cards]) => `▸ *${cards[0]?.series}*`)
            await ctx.reply(
                [`Several anime match *${ctx.args.join(' ')}*:`, ...names, '', `▸ Be more specific.`].join('\n'),
            )
            return
        }

        const [, cards] = matches[0] as [string, Card[]]
        const title = cards[0]?.series ?? ctx.args.join(' ')
        const board = rank(cards)
        if (!board.length) {
            await ctx.reply(`Nobody owns a *${title}* card yet. 🛑`)
            return
        }

        const lines = board.slice(0, 10).map((entry, index) => {
            const medal = medals[index] ?? '▸'
            return `${medal} *${ownerName(entry.jid)}* — ${entry.total} cards`
        })
        await ctx.reply(
            [
                `🏆 *${title} collectors*`,
                '',
                ...lines,
            ].join('\n'),
        )
    },
})

ari({
    name: 'cardtocoll',
    description: 'Move every staged deck card into your binder',
    category: 'games',
    aliases: ['m2coll', 'm2c', 'tocollect'],
        usage: 'cardtocoll [all|number|name]',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        const query = ctx.args.join(' ').trim()

        if (!query || query.toLowerCase() === 'all') {
            const deck = deckOf(ctx.sender)
            if (!deck.length) {
                await ctx.reply('Your deck is empty. Claim drops with *' + ctx.prefix + 'claim* first. \u274c')
                return
            }
            const result = db.moveToCollection(ctx.sender)
            await ctx.reply('\u2705 Moved *' + result.moved + '* card' + (result.moved === 1 ? '' : 's') + ' from your deck to your collection.')
            return
        }

        // A number is the card's DECK position (1..deck length), the same numbers .deck and .tc use.
        if (/^#?\d+$/.test(query)) {
            const deck = deckOf(ctx.sender)
            const n = Number(query.replace(/^#/, ''))
            const slot = n >= 1 ? deck[n - 1] : undefined
            if (!slot) {
                await ctx.reply(`No card #${n} in your deck 🛑 (deck numbers run 1-${deck.length}, see ${ctx.prefix}deck)`)
                return
            }
            const moved = db.moveToCollection(ctx.sender, slot.card.id)
            await ctx.reply(`\u2705 Moved *${slot.card.name}* to your collection (${moved.moved} cop${moved.moved === 1 ? 'y' : 'ies'}).`)
            return
        }

        const cards = findCards(query)
        if (!cards.length) {
            await ctx.reply('No card matches *' + query + '*. \u274c')
            return
        }
        let total = 0
        for (const card of cards) {
            const result = db.moveToCollection(ctx.sender, card.id)
            total += result.moved ?? 0
        }
        if (!total) {
            await ctx.reply('That card is not in your deck. \u274c')
            return
        }
        await ctx.reply('\u2705 Moved ' + total + ' card' + (total === 1 ? '' : 's') + ' to your collection.')
    },
})

ari({
    name: 'agb',
    description: 'Activate or kill the collection game in this group (anchor only)',
    category: 'games',
    aliases: ['activategame', 'gamebot'],
    usage: 'agb live [days] [-ht] [-pk] | agb poke [off] | agb gamble [off] | agb kill',
    ownerOnly: true,
    modOk: true,
    hidden: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const flagHt = ctx.args.some((arg) => arg === '-ht' || arg === '--ht')
        const flagPk = ctx.args.some((arg) => arg === '-pk' || arg === '--pk')
        const args = ctx.args.filter((arg) => !['-ht', '--ht', '-pk', '--pk'].includes(arg))
        const action = (args[0] ?? '').toLowerCase()

        if (action === 'live' || action === 'on') {
            if (!ctx.isGroup) {
                await ctx.reply('Game activation happens in groups. \u274c')
                return
            }
            const days = Number(args[1]) || 0
            db.setGameActive(ctx.chat, true, days || undefined)
            // -pk is the only way .agb live turns pokemon on. Without it, pokemon keeps
            // whatever it already was (a pokemon-only group stays on).
            if (flagPk) db.setPokeEnabled(ctx.chat, true)

            if (flagHt) {
                // .agb live 30 -ht -> whole game live 30 days, t5-S unlocked too
                const until = Date.now() + (days || 1) * 24 * 60 * 60 * 1000
                db.setHighTierUntil(ctx.chat, until)
                await ctx.reply(
                    '\ud83c\udccf Collection game is *LIVE* in this group' +
                    (days ? ' for *' + days + ' day' + (days === 1 ? '' : 's') + '* (auto-kills after)' : '') + '.\n' +
                    '\ud83d\udc8e High tier (t5-S) unlocked here' + (days ? ' for the same window' : ' for *1 day* (add a number of days)') + '.\n' +
                    't1-t4 stay hourly everywhere.' +
                    (flagPk ? '\n\ud83d\udc3e Pokemon is *ON* here' + (days ? ' for the same window' : '') + '. Use .pstart to begin.' : ''),
                )
                return
            }

            await ctx.reply(
                '\ud83c\udccf Collection game is *LIVE* in this group' +
                (days ? ' for *' + days + ' day' + (days === 1 ? '' : 's') + '* (auto-kills after).' : '.') +
                ' Drops, claims, duels and chains are on.' +
                (flagPk ? '\n\ud83d\udc3e Pokemon is *ON* here' + (days ? ' for the same window' : '') + '. Use .pstart to begin.' : ''),
            )
            return
        }

        if (action === 'poke') {
            if (!ctx.isGroup) {
                await ctx.reply('Pokemon activation happens in groups. \u274c')
                return
            }
            const pokeOff = (args[1] ?? '').toLowerCase() === 'off'
            // Pokemon only: never touches the cards activation, and pokemon-only
            // groups keep cards off.
            db.setPokemonToggle(ctx.chat, !pokeOff)
            await ctx.reply(
                pokeOff
                    ? '\ud83d\udc3e Pokemon is *OFF* here.'
                    : '\ud83d\udc3e Pokemon is *ON* here. Use .pstart to begin.',
            )
            return
        }

        if (action === 'gamble') {
            if (!ctx.isGroup) {
                await ctx.reply('Casino activation happens in groups. \u274c')
                return
            }
            // Casino has its own switch: never touches cards, pokemon or the collection game.
            const gambleOff = (args[1] ?? '').toLowerCase() === 'off'
            db.setCasinoEnabled(ctx.chat, !gambleOff)
            await ctx.reply(
                gambleOff
                    ? '\ud83c\udfb0 Casino is *OFF* here.'
                    : '\ud83c\udfb0 Casino is *ON* here. Try .slots or .mine.',
            )
            return
        }

        if (action === 'kill' || action === 'off') {
            if (!ctx.isGroup) {
                await ctx.reply('Game switching happens in groups. \u274c')
                return
            }
            db.setGameActive(ctx.chat, false)
            db.setPokeEnabled(ctx.chat, false)
            await ctx.reply('\u274c Collection game and pokemon killed here. This group is back to the plain bot.')
            return
        }

        await ctx.reply('Usage: ' + ctx.prefix + 'agb live [days] [-ht] [-pk] (cards, -ht adds t5-S, -pk adds pokemon) | ' + ctx.prefix + 'agb poke [off] (pokemon only) | ' + ctx.prefix + 'agb kill (everything off) \u274c')
    },
})

ari({
    name: 'spawn',
    description: 'Spawn a card by name with optional tier filter (anchor/admin)',
    category: 'games',
    aliases: ['sp'],
    usage: 'spawn <name> [t1-t6|s]',
    hidden: true,
    cooldownMs: 0,
    run: async (ctx) => {
        if (await gameGuard(ctx)) return
        if (!ctx.isGroup) {
            await ctx.reply('Card drops happen in groups. \u274c')
            return
        }
        if (ctx.isMod && !ctx.isOwner) {
            await ctx.reply('Owner only. \u274c')
            return
        }
        if (!ctx.isAdmin && !ctx.isOwner) {
            await ctx.reply('Admins only. \u274c')
            return
        }

        const raw = ctx.args.join(' ').trim()
        if (!raw) {
            await ctx.reply(
                [
                    '*Spawn usage*',
                    `${ctx.prefix}spawn <name>`,
                    `${ctx.prefix}spawn <name> t5`,
                    `${ctx.prefix}spawn t5`,
                ].join('\n'),
            )
            return
        }

        const tierMatch = raw.match(/(?:^|\s)(?:t|tier)\s*([1-6sS])\s*$/)
        const wantedTier = tierMatch?.[1] ? tierMatch[1].toUpperCase() : null
        const query = tierMatch && tierMatch.index != null ? raw.slice(0, tierMatch.index).trim() : raw

        // Keep the VPS catalog close to the live site without stalling this
        // command; a stale catalog is refreshed in the background.
        refreshCatalogSoon()

        const ofTier = (list: Card[]): Card[] =>
            wantedTier ? list.filter((card) => String(card.tier ?? '').toUpperCase() === wantedTier) : list

        let cards = query ? findCards(query) : []
        let pool = ofTier(cards)

        // A named search that finds nothing may be a catalog that is behind
        // the site, so re-read it once and try again. A tier mismatch also
        // refreshes: the site can move a card to a new tier before the
        // background refresh catches up.
        if (query && (!cards.length || !pool.length) && (await refreshCatalogNow())) {
            cards = findCards(query)
            pool = ofTier(cards)
        }

        if (!query) {
            // A bare tier means "any card from that tier". The offline catalog
            // carries no tiers, so fall back to that tier's rarity bucket.
            pool = ofTier(CARDS)
            if (!pool.length && wantedTier) {
                const rarity = rarityForTier(wantedTier)
                pool = CARDS.filter((card) => card.rarity === rarity)
            }
            if (!pool.length) {
                await ctx.reply(`No cards in tier *${wantedTier}*.`)
                return
            }
        }

        if (query && !cards.length) {
            await ctx.reply(`No card matches *${query}*.`)
            return
        }

        if (!pool.length) {
            const tiers = [...new Set(cards.map((card) => String(card.tier ?? '?').toUpperCase()))].sort(
                (a, b) => tierWeight(a) - tierWeight(b),
            )
            await ctx.reply(
                [
                    `No *${query}* card in tier *${wantedTier}*.`,
                    tiers.length ? `Available: ${tiers.map((tier) => `T${tier}`).join(', ')}` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
            return
        }

        // One random pick, avoiding cards this chat has just been given.
        const card = pickFreshCard(ctx.chat, pool)
        forceDrop(ctx.chat, card)
        await ctx.sock.sendMessage(
            ctx.chat,
            cardMedia(await cardArt(card), cardDropCaption(card, ctx.prefix)),
        )
    },
})

import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import {
    CURRENCY_NAME,
    MAX_BUY,
    SHOP,
    type ShopItem,
    WORK_COOLDOWN_MS,
    balanceOf,
    buyItem,
    doWork,
    findShopItem,
    formatWait,
    inventoryOf,
    money,
    workStatus,
} from '../../features/economy.js'
import { cardPrice, collectionOf } from '../../features/tcg.js'
import { profileOf } from '../../features/game-stats.js'
import { economyGuard } from '../../features/tcg.js'

ari({
    name: 'work',
    description: 'Work a shift for coins (1h cooldown)',
    category: 'fun',
    aliases: ['job'],
    usage: 'work',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const status = workStatus(ctx.sender)
        if (!status.ready) {
            await ctx.reply(`you already clocked out. back in *${formatWait(status.waitMs)}* ⏳`)
            return
        }

        const result = doWork(ctx.sender)
        if (!result) {
            await ctx.reply('no shift available right now. try again soon ⏳')
            return
        }

        const lines = [`💼 you ${result.flavor} and earned *${money(result.amount)}*`]
        if (result.doubled) lines.push('🍀 lucky charm doubled your pay!')
        lines.push(`Balance: *${money(result.balance)}*`, '', `next shift in ${Math.round(WORK_COOLDOWN_MS / 3_600_000)}h.`)
        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'shop',
    description: `Browse the ${CURRENCY_NAME} shop`,
    category: 'fun',
    aliases: ['store'],
    usage: 'shop',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const groups: Array<{ title: string; icon: string; ids: string[] }> = [
            { title: 'card pulls', icon: '🎴', ids: ['pull_ticket'] },
            { title: 'pokemon supplies', icon: '🎒', ids: ['potion', 'super_potion'] },
            { title: 'boosts', icon: '⚡', ids: ['lucky_charm', 'streak_freeze'] },
        ]

        const lines = [
            `💰 *${CURRENCY_NAME.toLowerCase()} · ꜱʜᴏᴘ*`,
            '_everything here is bought with your wallet, never the vault_',
        ]

        for (const group of groups) {
            const items = group.ids
                .map((id) => SHOP.find((entry) => entry.id === id))
                .filter((entry): entry is ShopItem => Boolean(entry))
            if (!items.length) continue

            lines.push('', `${group.icon} *${group.title}*`)
            for (const item of items) {
                lines.push(`▸ *${item.name}* — *${money(item.price)}*`)
                lines.push(`   _${item.description}_`)
            }
        }

        lines.push(
            '',
            `▸ *${ctx.prefix}buy <item> [qty]* · max *${MAX_BUY}* per order`,
            `▸ Example: *${ctx.prefix}buy potion 2*`,
            `▸ *${ctx.prefix}inv* shows what you already own`,
        )
        await ctx.reply(lines.join('\n'))
    },
})

ari({
    name: 'buy',
    description: 'Buy an item from the shop',
    category: 'fun',
    aliases: [],
    usage: 'buy <item> [qty]',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const words = [...ctx.args]
        let qty = 1
        const last = words[words.length - 1]
        if (words.length > 1 && last && /^\d+$/.test(last)) {
            qty = Number.parseInt(last, 10)
            words.pop()
        }
        if (qty < 1 || qty > MAX_BUY) {
            await ctx.reply(`qty has to be between 1 and ${MAX_BUY} 🛑`)
            return
        }

        const query = words.join(' ')
        if (!query) {
            await ctx.reply(`what do you want to buy? try *${ctx.prefix}shop* 🛑`)
            return
        }

        const item = findShopItem(query)
        if (!item) {
            await ctx.reply(`no item called *${query}* in the shop. check *${ctx.prefix}shop* 🛑`)
            return
        }

        const result = buyItem(ctx.sender, item, qty)
        if (!result.ok) {
            await ctx.reply(`not enough ${CURRENCY_NAME}. need *${money(result.need)}*, you have *${money(result.balance)}*.`)
            return
        }

        await ctx.reply(
            [
                `🧾 bought *${qty}x ${item.name}* for ${money(result.total)}`,
                `Balance: *${money(result.balance)}*`,
                `check *${ctx.prefix}inv* to see what you own.`,
            ].join('\n'),
        )
    },
})

ari({
    name: 'inv',
    description: 'Everything you own: wallet, cards, pokemon and items',
    category: 'fun',
    aliases: ['inventory', 'items', 'bag'],
    usage: 'inv',
    run: async (ctx) => {
        if (await economyGuard(ctx)) return
        const items = inventoryOf(ctx.sender)
        const collection = collectionOf(ctx.sender)
        const pokemon = db.pokeList(ctx.sender)
        const profile = profileOf(ctx.sender)
        const balance = balanceOf(ctx.sender)

        const cardValue = collection.cards.reduce(
            (sum, entry) => sum + cardPrice(entry.card) * entry.copies,
            0,
        )
        const pokePower = pokemon.reduce((sum, row) => sum + row.power, 0)
        const bestCard = collection.cards
            .slice()
            .sort((a, b) => cardPrice(b.card) - cardPrice(a.card))[0]

        const lines = [
            `🎒 *${ctx.senderName}'s inventory*`,
            '',
            `💰 Wallet   : *${money(balance)}*`,
            `🏦 Vault    : *${money(db.vault(ctx.sender))}*`,
            `🎴 Cards    : *${collection.total}* cards (worth ${money(cardValue)})`,
            `🐾 Pokemon  : *${pokemon.length}* caught (power ${pokePower.toLocaleString('en-US')})`,
            `🎮 Games    : ${profile.wins}W / ${profile.losses}L / ${profile.draws}D`,
        ]

        if (bestCard) {
            lines.push(`⚡ Best card: *${bestCard.card.name}* — ${money(cardPrice(bestCard.card) * bestCard.copies)}`)
        }

        lines.push('', '🎁 *Items*')
        if (items.length === 0) {
            lines.push(`_nothing bought yet — ${ctx.prefix}shop_`)
        } else {
            for (const entry of items) lines.push(`▸ ${entry.qty}x ${entry.name}`)
        }


        await ctx.reply(lines.join('\n'))
    },
})

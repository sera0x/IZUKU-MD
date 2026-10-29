import { db, rawDb } from '../db/index.js'
import { jidToNumber } from '../bot/helpers.js'
import { CARD_BY_ID, type Card } from './tcg.js'
import { balanceOf, money } from './economy.js'

/**
 * Player marketplace. A listing does NOT escrow the card: the seller keeps it
 * until someone buys. Every ownership check and every ryo/card move happens
 * inside one SQLite transaction (better-sqlite3 is synchronous), so two buyers
 * can never both take the same copy, and a sale that fails midway rolls back.
 */
export const MARKET = {
    /** Share of the sale price kept by the system. Seller gets the rest. */
    taxRate: 0.1,
    /** How long a listing stays live. */
    listingMs: 10 * 60_000,
    /** Active listings one seller may hold at once. */
    maxActivePerSeller: 5,
    minPrice: 1,
    maxPrice: 5_000_000,
} as const

rawDb.exec(`
    CREATE TABLE IF NOT EXISTS market_listings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_jid  TEXT NOT NULL,
        card_id     TEXT NOT NULL,
        price       INTEGER NOT NULL,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        buyer_jid   TEXT,
        sold_at     INTEGER,
        tax         INTEGER,
        seller_gets INTEGER
    );
    CREATE INDEX IF NOT EXISTS market_listings_status ON market_listings (status, expires_at);
`)

export interface Listing {
    id: number
    seller_jid: string
    card_id: string
    price: number
    status: string
    created_at: number
    expires_at: number
    buyer_jid: string | null
    sold_at: number | null
    tax: number | null
    seller_gets: number | null
}

const stmt = {
    byId: rawDb.prepare('SELECT * FROM market_listings WHERE id = ?'),
    activeCount: rawDb.prepare("SELECT COUNT(*) AS n FROM market_listings WHERE seller_jid = ? AND status = 'active'"),
    activeCardCount: rawDb.prepare(
        "SELECT COUNT(*) AS n FROM market_listings WHERE seller_jid = ? AND card_id = ? AND status = 'active'",
    ),
    insert: rawDb.prepare(
        'INSERT INTO market_listings (seller_jid, card_id, price, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    expireDue: rawDb.prepare("UPDATE market_listings SET status = 'expired' WHERE status = 'active' AND expires_at <= ?"),
    setStatus: rawDb.prepare('UPDATE market_listings SET status = ? WHERE id = ?'),
    activeList: rawDb.prepare(
        "SELECT * FROM market_listings WHERE status = 'active' AND expires_at > ? ORDER BY expires_at ASC LIMIT 30",
    ),
    collCopies: rawDb.prepare('SELECT copies FROM cards WHERE user_jid = ? AND card_id = ?'),
    deckCopies: rawDb.prepare('SELECT copies FROM deck_cards WHERE user_jid = ? AND card_id = ?'),
    decColl: rawDb.prepare('UPDATE cards SET copies = copies - 1 WHERE user_jid = ? AND card_id = ?'),
    delColl: rawDb.prepare('DELETE FROM cards WHERE user_jid = ? AND card_id = ? AND copies <= 0'),
    decDeck: rawDb.prepare('UPDATE deck_cards SET copies = copies - 1 WHERE user_jid = ? AND card_id = ?'),
    delDeck: rawDb.prepare('DELETE FROM deck_cards WHERE user_jid = ? AND card_id = ? AND copies <= 0'),
    upsertColl: rawDb.prepare(
        'INSERT INTO cards (user_jid, card_id, copies, first_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_jid, card_id) DO UPDATE SET copies = copies + 1',
    ),
    spend: rawDb.prepare('UPDATE users SET coins = coins - ? WHERE jid = ? AND coins >= ?'),
    credit: rawDb.prepare('UPDATE users SET coins = coins + ? WHERE jid = ?'),
    settle: rawDb.prepare(
        "UPDATE market_listings SET status = 'sold', buyer_jid = ?, sold_at = ?, tax = ?, seller_gets = ? WHERE id = ? AND status = 'active'",
    ),
}

const countOf = (row: unknown): number => Number((row as { n: number } | undefined)?.n ?? 0)

/** Copies a user holds across collection and deck, for one card. */
function totalCopies(user: string, cardId: string): number {
    const coll = (stmt.collCopies.get(user, cardId) as { copies: number } | undefined)?.copies ?? 0
    const deck = (stmt.deckCopies.get(user, cardId) as { copies: number } | undefined)?.copies ?? 0
    return coll + deck
}

/**
 * Pick one of the sender's own cards. A number is the collection position
 * (same numbering as .coll), anything else is a name match over collection then deck.
 */
export function pickOwned(user: string, query: string): Card | undefined {
    const needle = query.trim().replace(/^#/, '').toLowerCase()
    if (!needle) return undefined
    const coll = db.cards(user).filter((row) => CARD_BY_ID.has(row.card_id))
    if (/^\d+$/.test(needle)) return CARD_BY_ID.get(coll[Number(needle) - 1]?.card_id ?? '')
    const deck = db.deckOf(user).filter((row) => CARD_BY_ID.has(row.card_id))
    const owned = [...coll, ...deck]
        .map((row) => CARD_BY_ID.get(row.card_id))
        .filter((card): card is Card => Boolean(card))
    return (
        owned.find((card) => card.name.toLowerCase() === needle) ??
        owned.find((card) => card.name.toLowerCase().includes(needle))
    )
}

export type SellResult =
    | { ok: true; listing: Listing; card: Card }
    | { ok: false; reason: 'price' | 'nocard' | 'limit' | 'copies'; card?: Card }

export function sellCard(seller: string, query: string, price: number, now = Date.now()): SellResult {
    if (!Number.isSafeInteger(price) || price < MARKET.minPrice || price > MARKET.maxPrice) {
        return { ok: false, reason: 'price' }
    }
    const card = pickOwned(seller, query)
    if (!card) return { ok: false, reason: 'nocard' }
    db.user(seller)
    return rawDb.transaction((): SellResult => {
        stmt.expireDue.run(now)
        if (countOf(stmt.activeCount.get(seller)) >= MARKET.maxActivePerSeller) {
            return { ok: false, reason: 'limit', card }
        }
        // One listing per owned copy: you cannot list the same copy twice.
        if (countOf(stmt.activeCardCount.get(seller, card.id)) >= totalCopies(seller, card.id)) {
            return { ok: false, reason: 'copies', card }
        }
        const info = stmt.insert.run(seller, card.id, price, 'active', now, now + MARKET.listingMs)
        const listing = stmt.byId.get(info.lastInsertRowid) as Listing
        return { ok: true, listing, card }
    })()
}

export type BuyResult =
    | { ok: true; listing: Listing; card: Card; tax: number; sellerGets: number; balance: number }
    | { ok: false; reason: 'missing' | 'gone' | 'expired' | 'self' | 'seller_lost' | 'insufficient' | 'race'; need?: number; balance?: number; card?: Card }

/**
 * Buy a live listing. Order inside the transaction: check listing state and seller
 * ownership first (no writes), then take the buyer's ryo (conditional UPDATE, so a
 * short balance writes nothing), then move the card and credit the seller.
 * Any unexpected throw rolls the whole sale back.
 */
export function buyListing(buyer: string, listingId: number, now = Date.now()): BuyResult {
    db.user(buyer)
    try {
        return rawDb.transaction((): BuyResult => {
            const row = stmt.byId.get(listingId) as Listing | undefined
            if (!row) return { ok: false, reason: 'missing' }
            if (row.status !== 'active') return { ok: false, reason: 'gone' }
            if (row.expires_at <= now) {
                stmt.setStatus.run('expired', row.id)
                return { ok: false, reason: 'expired' }
            }
            if (row.seller_jid === buyer) return { ok: false, reason: 'self' }

            const card = CARD_BY_ID.get(row.card_id)
            const collHas = ((stmt.collCopies.get(row.seller_jid, row.card_id) as { copies: number } | undefined)?.copies ?? 0) > 0
            const deckHas = ((stmt.deckCopies.get(row.seller_jid, row.card_id) as { copies: number } | undefined)?.copies ?? 0) > 0
            if (!collHas && !deckHas) {
                // Seller moved or traded the card away: close the listing, take nothing.
                stmt.setStatus.run('void', row.id)
                return { ok: false, reason: 'seller_lost', card }
            }

            const debit = stmt.spend.run(row.price, buyer, row.price)
            if (debit.changes === 0) {
                return { ok: false, reason: 'insufficient', need: row.price, balance: balanceOf(buyer), card }
            }

            const tax = Math.floor(row.price * MARKET.taxRate)
            const sellerGets = row.price - tax
            db.user(row.seller_jid)
            stmt.credit.run(sellerGets, row.seller_jid)
            if (collHas) {
                stmt.decColl.run(row.seller_jid, row.card_id)
                stmt.delColl.run(row.seller_jid, row.card_id)
            } else {
                stmt.decDeck.run(row.seller_jid, row.card_id)
                stmt.delDeck.run(row.seller_jid, row.card_id)
            }
            stmt.upsertColl.run(buyer, row.card_id, now)

            const settled = stmt.settle.run(buyer, now, tax, sellerGets, row.id)
            if (settled.changes !== 1) throw new Error('listing changed during sale')

            const done = stmt.byId.get(row.id) as Listing
            return {
                ok: true,
                listing: done,
                card: card as Card,
                tax,
                sellerGets,
                balance: balanceOf(buyer),
            }
        })()
    } catch {
        return { ok: false, reason: 'race' }
    }
}

/** Expires overdue listings and returns the live ones, soonest-expiring first. */
export function activeListings(now = Date.now()): Listing[] {
    stmt.expireDue.run(now)
    return stmt.activeList.all(now) as Listing[]
}

export function timeLeft(listing: Listing, now = Date.now()): string {
    const ms = Math.max(0, listing.expires_at - now)
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.floor((ms % 60_000) / 1000)
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

const sellerTag = (jid: string): string => `…${jidToNumber(jid).slice(-4)}`

export function marketText(now = Date.now()): string {
    const rows = activeListings(now)
    if (rows.length === 0) {
        return ['💰 market is empty right now.', 'list a card with .sell <card name or number> <price>'].join('\n')
    }
    const lines = [`💰 market · ${rows.length} live`, '']
    for (const row of rows) {
        const name = CARD_BY_ID.get(row.card_id)?.name ?? row.card_id
        lines.push(`#${row.id} *${name}* · ${money(row.price)} · seller ${sellerTag(row.seller_jid)} · ⏳ ${timeLeft(row, now)}`)
    }
    lines.push('', `buy with .mbuy <id>. ${Math.round(MARKET.taxRate * 100)}% tax on each sale. listings close after 10 minutes.`)
    return lines.join('\n')
}

export function describeSell(result: SellResult): string {
    if (result.ok) {
        const { listing, card } = result
        const net = listing.price - Math.floor(listing.price * MARKET.taxRate)
        return [
            `💰 listed *${card.name}* as #${listing.id} for *${money(listing.price)}*`,
            `you get ${money(net)} after ${Math.round(MARKET.taxRate * 100)}% tax. it stays in your collection until sold, and closes in 10 minutes.`,
        ].join('\n')
    }
    switch (result.reason) {
        case 'price':
            return `price must be a whole number of Ryo from ${money(MARKET.minPrice)} to ${money(MARKET.maxPrice)} 🛑`
        case 'nocard':
            return 'no card of yours matches that. check .coll for numbers 🛑'
        case 'limit':
            return `you already have ${MARKET.maxActivePerSeller} live listings. wait for one to sell or expire 🛑`
        case 'copies':
            return `every copy of *${result.card?.name ?? 'that card'}* you own is already listed 🛑`
    }
}

export function describeBuy(result: BuyResult): string {
    if (result.ok) {
        return [
            `🛒 bought *${result.card.name}* (#${result.listing.id}) for *${money(result.listing.price)}*`,
            `it is in your collection now. balance: *${money(result.balance)}*`,
        ].join('\n')
    }
    switch (result.reason) {
        case 'missing':
            return 'no listing with that id 🛑'
        case 'gone':
            return 'that listing already sold or closed 🛑'
        case 'expired':
            return 'that listing just expired 🛑'
        case 'self':
            return 'you cannot buy your own listing 🛑'
        case 'seller_lost':
            return 'the seller no longer has that card, so the listing was closed. nothing was charged 🛑'
        case 'insufficient':
            return `you need *${money(result.need ?? 0)}* for that. you have *${money(result.balance ?? 0)}* 🛑`
        case 'race':
            return 'that sale did not go through (another purchase or change landed first). nothing was charged 🛑'
    }
}

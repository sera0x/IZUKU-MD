import { db } from '../db/index.js'

/**
 * The bot's money. Rebranding the whole game means editing these two values —
 * every user-facing amount goes through `money()`.
 */
export const CURRENCY_NAME = 'Ryo'
export const CURRENCY_SYMBOL = '¥'

export const money = (amount: number): string =>
    `${CURRENCY_SYMBOL}${Math.round(amount).toLocaleString('en-US')}`

/**
 * Payouts for a finished game win, so the economy is fed by play and not only
 * by the daily claim. Unknown games fall back to the base reward.
 */
export const GAME_REWARD: Record<string, number> = {
    tictactoe: 100,
    wordchain: 150,
    pokemon: 120,
}

export const BASE_GAME_REWARD = 80

/**
 * Hard ceiling on prize money per player per UTC day. Without it, two people
 * farming wordchain in a loop minted a fortune in one night; with it the
 * economy only grows as fast as the daily and work payouts intend.
 */
export const GAME_DAILY_CAP = 1200

/** Epoch days, so the cap resets at midnight UTC for everyone at once. */
export const dayIndex = (at = Date.now()): number => Math.floor(at / 86_400_000)

/** Pay a win, never above what is left of today's game cap. 0 means capped. */
export function rewardGameWin(userJid: string, game: string): number {
    const day = dayIndex()
    const earned = db.gameEarnedOn(userJid, day)
    const wanted = GAME_REWARD[game] ?? BASE_GAME_REWARD
    const amount = Math.max(0, Math.min(wanted, GAME_DAILY_CAP - earned))
    if (amount <= 0) return 0
    db.addGameEarning(userJid, day, amount)
    db.addCoins(userJid, amount)
    return amount
}

/** Currency handed out by `.daily` (base, before the streak bonus). Override with DAILY_COINS. */
export const DAILY_COINS = (() => {
    const value = Number.parseInt(process.env.DAILY_COINS ?? '500', 10)
    return Number.isFinite(value) && value > 0 ? value : 500
})()

export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Claiming again within this window keeps the streak alive. Past it, a streak freeze can save it. */
export const DAILY_GRACE_MS = 48 * 60 * 60 * 1000
/** Extra coins per streak day beyond the first, capped so the bonus stops growing. */
export const STREAK_STEP = 50
export const STREAK_CAP = 10

export const WORK_COOLDOWN_MS = 60 * 60 * 1000
export const WORK_MIN = 30
export const WORK_MAX = 90
export const MAX_BUY = 20

// ── Vault and robbery ────────────────────────────────────────────────────────

export const ROB_COOLDOWN_MS = 60 * 60 * 1000
/** Odds a robbery lands. Failing is normal: the fun is in the attempt. */
export const ROB_SUCCESS_CHANCE = 0.35
/** Below this wallet balance the target is "not worth it" and robbers walk off. */
export const ROB_MIN_WALLET = 150
/** Share of the victim's *wallet* a successful robbery takes. */
export const ROB_MIN_SHARE = 0.1
export const ROB_MAX_SHARE = 0.25

export interface VaultTotals {
    wallet: number
    vault: number
    total: number
}

export function vaultTotals(userJid: string): VaultTotals {
    const wallet = db.coins(userJid)
    const vault = db.vault(userJid)
    return { wallet, vault, total: wallet + vault }
}

/** Parse "all" / "half" / a plain amount against a ceiling. */
export function parseAmount(input: string, available: number): number | null {
    const raw = input.trim().toLowerCase().replace(/[,¥]/g, '')
    if (!raw) return null
    if (raw === 'all' || raw === 'max') return available
    if (raw === 'half') return Math.floor(available / 2)
    if (!/^\d+$/.test(raw)) return null
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : null
}

export function robStatus(userJid: string): { ready: boolean; waitMs: number } {
    const elapsed = Date.now() - db.robAt(userJid)
    if (elapsed >= ROB_COOLDOWN_MS) return { ready: true, waitMs: 0 }
    return { ready: false, waitMs: ROB_COOLDOWN_MS - elapsed }
}

export type RobFail = 'self' | 'broke' | 'pity' | 'caught'

export interface RobOutcome {
    ok: boolean
    error?: RobFail
    amount: number
    line: string
    victimWallet: number
    thiefBalance: number
}

const pick = (lines: string[]): string => lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? ''

/** Cheeky lines for a target with nothing worth taking. */
// Pronoun-free lines: chat names do not tell us anyone's gender.
const BROKE_LINES = [
    'this one is broke. let\u2019s leave it for now 🥲',
    'dust in the pockets. not worth the trip 💀',
    'robbing the poor? the streets have *standards* 🥴',
    'there is nothing there. nothing at all. walk away 😭',
    'found a receipt and a dream in that wallet. pass 🤧',
]

const CAUGHT_LINES = [
    'you tripped over a chair mid-heist. everybody saw 💀',
    'your hand slipped and you apologised out loud. embarrassing 😭',
    'the target turned around and you froze like a loading screen 🧍',
    'you grabbed a *hand* instead of a wallet. romantic, but no 🫠',
    'alarm went off. there was no alarm. you screamed anyway 📢',
]

const WIN_LINES = [
    'clean grab. nobody saw a thing 🥷',
    'in and out mid-sentence 🥷',
    'the target was busy typing. the wallet was not 💀',
    'you moved like a shadow. the ryo moved with you 🌑',
]

export function attemptRob(thiefJid: string, victimJid: string, victimName: string): RobOutcome {
    const thiefBalance = db.coins(thiefJid)

    if (thiefJid === victimJid) {
        return { ok: false, error: 'self', amount: 0, thiefBalance, victimWallet: thiefBalance, line: 'robbing yourself? the maths does not work, genius 🤡' }
    }

    const victimWallet = db.coins(victimJid)
    if (victimWallet < ROB_MIN_WALLET) {
        return { ok: false, error: 'broke', amount: 0, thiefBalance, victimWallet, line: `*${victimName}* — ${pick(BROKE_LINES)}` }
    }

    db.setRobAt(thiefJid, Date.now())

    if (Math.random() > ROB_SUCCESS_CHANCE) {
        return { ok: false, error: 'caught', amount: 0, thiefBalance, victimWallet, line: pick(CAUGHT_LINES) }
    }

    const share = ROB_MIN_SHARE + Math.random() * (ROB_MAX_SHARE - ROB_MIN_SHARE)
    const amount = Math.max(Math.floor(ROB_MIN_WALLET / 4), Math.floor(victimWallet * share))
    if (!db.spendCoins(victimJid, amount)) {
        return {
            ok: false,
            error: 'pity',
            amount: 0,
            thiefBalance,
            victimWallet,
            line: 'the ryo moved a second before you got there 😤',
        }
    }

    return { ok: true, amount, line: pick(WIN_LINES), victimWallet, thiefBalance: db.addCoins(thiefJid, amount) }
}

export interface ShopItem {
    id: string
    name: string
    price: number
    description: string
}

export const SHOP: ShopItem[] = [
    {
        id: 'pull_ticket',
        name: 'Pull ticket',
        price: 1800,
        description: 'the only way to pull a card — weighs the roll toward t4-S, sometimes it does not land',
    },
    {
        id: 'potion',
        name: 'Potion',
        price: 300,
        description: 'auto-used in a pokemon battle: heals 50% HP once you drop low',
    },
    {
        id: 'super_potion',
        name: 'Super potion',
        price: 700,
        description: 'auto-used before a normal potion: heals 80% HP in a battle',
    },
    {
        id: 'lucky_charm',
        name: 'Lucky charm',
        price: 1200,
        description: 'doubles your next `work` payout',
    },
    {
        id: 'streak_freeze',
        name: 'Streak freeze',
        price: 1500,
        description: 'if you miss a whole day of `daily`, this saves your streak once',
    },
]

export function findShopItem(query: string): ShopItem | undefined {
    const key = query.trim().toLowerCase().replace(/\s+/g, '_')
    return SHOP.find((item) => item.id === key || item.name.toLowerCase().replace(/\s+/g, '_') === key)
}

export function shopItemName(id: string): string {
    return SHOP.find((item) => item.id === id)?.name ?? id
}

export function formatWait(ms: number): string {
    const hours = Math.floor(ms / 3_600_000)
    const minutes = Math.max(1, Math.ceil((ms % 3_600_000) / 60_000))
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function balanceOf(user: string): number {
    return db.coins(user)
}

export function dailyStatus(user: string): { ready: boolean; waitMs: number } {
    const last = db.dailyAt(user)
    const elapsed = Date.now() - last
    if (elapsed >= DAILY_COOLDOWN_MS) return { ready: true, waitMs: 0 }
    return { ready: false, waitMs: DAILY_COOLDOWN_MS - elapsed }
}

export interface DailyResult {
    base: number
    bonus: number
    amount: number
    streak: number
    balance: number
    freezeUsed: boolean
    brokeStreak: boolean
}

export function claimDaily(user: string): DailyResult | null {
    if (!dailyStatus(user).ready) return null

    const last = db.dailyAt(user)
    const previous = db.dailyStreak(user)
    let streak = 1
    let freezeUsed = false
    let brokeStreak = false

    if (last > 0 && Date.now() - last < DAILY_GRACE_MS) {
        streak = previous + 1
    } else if (last > 0 && db.takeItem(user, 'streak_freeze', 1)) {
        streak = previous + 1
        freezeUsed = true
    } else if (last > 0) {
        brokeStreak = previous > 1
    }

    const bonus = Math.min(streak - 1, STREAK_CAP) * STREAK_STEP
    const amount = DAILY_COINS + bonus
    const balance = db.addCoins(user, amount)
    db.setDailyState(user, Date.now(), streak)

    return { base: DAILY_COINS, bonus, amount, streak, balance, freezeUsed, brokeStreak }
}

export function workStatus(user: string): { ready: boolean; waitMs: number } {
    const elapsed = Date.now() - db.workAt(user)
    if (elapsed >= WORK_COOLDOWN_MS) return { ready: true, waitMs: 0 }
    return { ready: false, waitMs: WORK_COOLDOWN_MS - elapsed }
}

const WORK_JOBS = [
    'fixed a bike for a neighbour',
    'did a shift at the konbini',
    'walked a stranger\u2019s dog across town',
    'streamed hot takes and got tips',        'sold homemade snacks at the school gate',
    'found a wallet under a vending machine',
    'delivered groceries on a bicycle',
    'busked outside the station',
    'tutored a kid in maths',
    'cleaned the pool at the gym',
    'sorted returns at a warehouse',
    'helped a cafe run its Saturday rush',
]

export interface WorkResult {
    amount: number
    flavor: string
    doubled: boolean
    balance: number
}

export function doWork(user: string): WorkResult | null {
    if (!workStatus(user).ready) return null

    let amount = WORK_MIN + Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1))
    const doubled = db.takeItem(user, 'lucky_charm', 1)
    if (doubled) amount *= 2

    const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)] ?? WORK_JOBS[0] ?? 'worked'
    const balance = db.addCoins(user, amount)
    db.setWorkAt(user, Date.now())

    return { amount, flavor: job, doubled, balance }
}

export type BuyResult =
    | { ok: true; item: ShopItem; qty: number; total: number; balance: number }
    | { ok: false; reason: 'insufficient'; need: number; balance: number }

export function buyItem(user: string, item: ShopItem, qty: number): BuyResult {
    const total = item.price * qty
    if (!db.spendCoins(user, total)) {
        return { ok: false, reason: 'insufficient', need: total, balance: balanceOf(user) }
    }
    db.addItem(user, item.id, qty)
    return { ok: true, item, qty, total, balance: balanceOf(user) }
}

export function inventoryOf(user: string): Array<{ id: string; name: string; qty: number }> {
    return db.items(user).map((row) => ({ id: row.item, name: shopItemName(row.item), qty: row.qty }))
}

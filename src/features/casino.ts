import { db } from '../db/index.js'
import { money, parseAmount } from './economy.js'

/**
 * Casino: Ryo betting games. Only runs in groups where a mod turned it on with
 * .agb gamble. Every round is server-side RNG and settles in one atomic write.
 */

export const MAX_BET = 100_000
export const COOLDOWN_MS = 5_000

/** Returns an integer in [0, n). */
export type Rand = (n: number) => number

let clock: () => number = () => Date.now()

/** Test seam: swap the RNG, the clock or the blackjack timeout. */
export function setCasinoHooks(hooks: { rand?: Rand; now?: () => number; }): void {
    if (hooks.now) clock = hooks.now
}

export function resetCasinoHooks(): void {
    clock = () => Date.now()
}

export interface CasinoCtx {
    chat: string
    sender: string
    isGroup: boolean
    prefix: string
    args: string[]
    reply(content: string): Promise<unknown>
    sendImage?(image: Buffer, caption: string): Promise<unknown>
}

/** Gate for every casino command. Refuses in DMs and in groups without .agb gamble. */
export async function casinoGate(ctx: CasinoCtx): Promise<boolean> {
    if (!ctx.isGroup) {
        await ctx.reply('The casino runs in groups only. 🛑')
        return true
    }
    if (!db.casinoEnabled(ctx.chat)) {
        await ctx.reply(`The casino is not open in this group. A mod can open it with ${ctx.prefix}agb gamble 🛑`)
        return true
    }
    return false
}

// Cooldown: one bet per user every 5s, across all casino games.
const lastBetAt = new Map<string, number>()

export function cooldownLeft(user: string): number {
    const last = lastBetAt.get(user)
    if (last === undefined) return 0
    return Math.max(0, last + COOLDOWN_MS - clock())
}


export type BetParse = { ok: true; bet: number } | { ok: false; reason: string }

export function parseBet(raw: string, balance: number): BetParse {
    const bet = parseAmount(raw, balance)
    if (bet === null) return { ok: false, reason: 'bet has to be a whole number of ryo, like 500. 🛑' }
    if (bet > MAX_BET) return { ok: false, reason: `max bet is ${money(MAX_BET)}. 🛑` }
    if (balance <= 0 || bet > balance) {
        return { ok: false, reason: `not enough ryo. your wallet is ${money(balance)}. 🛑` }
    }
    return { ok: true, bet }
}



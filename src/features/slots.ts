// Slots: 6 rows of 3 emoji reels, every row is a payline. Wins are tuned
// frequent (about 94pct return, roughly 1 in 3 rows shows a win) so the game
// feels alive without bleeding the house.
import { randomInt } from 'node:crypto'
import { db } from '../db/index.js'
import { balanceOf, money } from './economy.js'
import { weekKey } from './mine.js'
import type { CasinoCtx } from './casino.js'

export const SLOTS_MAX_BET = 100_000
export const SLOTS_ROWS = 3

// symbol, weight, 3-of-kind pay, 2-of-kind pay (x the row stake)
const SYMBOLS: Array<{ s: string; w: number; three: number; two: number }> = [
    { s: '🍒', w: 5, three: 5, two: 1 },
    { s: '🍋', w: 4, three: 8, two: 1 },
    { s: '🍇', w: 3, three: 15, two: 1 },
    { s: '🔔', w: 2, three: 40, two: 1 },
    { s: '💎', w: 1, three: 120, two: 2 },
    { s: '7️⃣', w: 1, three: 250, two: 2 },
]
const BAG: number[] = SYMBOLS.flatMap((sym, i) => Array<number>(sym.w).fill(i))

function rollSym(roll: (n: number) => number): number {
    const pick = BAG[roll(BAG.length)]
    return pick === undefined ? 0 : pick
}

export interface SlotsOutcome {
    grid: string[][]
    lineWins: number[]
    payout: number
    jackpot: boolean
}

export function spinSlots(bet: number, roll: (n: number) => number = randomInt): SlotsOutcome {
    const grid: string[][] = []
    const lineWins: number[] = []
    let payout = 0
    let jackpot = false

    for (let r = 0; r < SLOTS_ROWS; r += 1) {
        const picks = [rollSym(roll), rollSym(roll), rollSym(roll)]
        grid.push(picks.map((i) => SYMBOLS[i]!?.s ?? SYMBOLS[0]!.s))
        const [a = 0, b = 0, c = 0] = picks
        const rowStake = bet / SLOTS_ROWS
        if (a === b && b === c) {
            const pay = Math.floor(rowStake * SYMBOLS[a]!.three)
            lineWins.push(r)
            payout += pay
            if (SYMBOLS[a]!.three >= 120) jackpot = true
        } else if (a === b || b === c || a === c) {
            const sym = (a === b || a === c ? SYMBOLS[a]! : SYMBOLS[b]!) ?? SYMBOLS[0]!
            payout += Math.floor(rowStake * sym.two)
            lineWins.push(r)
        }
    }

    return { grid, lineWins, payout: Math.min(payout, bet * 50), jackpot }
}

export async function playSlots(ctx: CasinoCtx): Promise<void> {
    const bet = Number.parseInt(ctx.args[0] ?? '', 10)
    if (!Number.isFinite(bet) || bet <= 0) {
        await ctx.reply(`usage: ${ctx.prefix}slots <bet> 🛑`)
        return
    }
    if (bet > SLOTS_MAX_BET) {
        await ctx.reply(`max bet is ${money(SLOTS_MAX_BET)} 🛑`)
        return
    }
    if (balanceOf(ctx.sender) < bet) {
        await ctx.reply(`not enough ryo, your wallet is ${money(balanceOf(ctx.sender))} 🛑`)
        return
    }

    const outcome = spinSlots(bet)
    const debited = db.settleGamble(ctx.sender, bet, outcome.payout, bet, weekKey())
    if (!debited) {
        await ctx.reply('🛑 not enough ryo right now.')
        return
    }

    const net = outcome.payout - bet
    const result = net > 0 ? `🏆 won ${money(net)}` : outcome.payout === bet ? '🤝 push, bet back' : `💸 lost ${money(bet)}`
    const caption = [
        '🎰 slots',
        outcome.lineWins.length > 0
            ? `🍀 ${outcome.lineWins.length} winning line${outcome.lineWins.length > 1 ? 's' : ''}`
            : 'no winning lines',
        `${result} · 💰 wallet ${money(balanceOf(ctx.sender))}`,
        outcome.jackpot ? '💎💎💎 JACKPOT LINE 💎💎💎' : '',
    ].filter(Boolean).join('\n')

    // Pure emoji reels: no drawn image, the emojis ARE the machine.
    const reelLines = outcome.grid.map((row, r) => {
        const marks = outcome.lineWins.includes(r) ? ' ✦' : ''
        return `┃ ${row.join(' ')} ┃${marks}`
    })
    const header = outcome.jackpot ? '💫💎 *JACKPOT* 💎💫' : '🎰 *IZUKU SLOTS* 🎰'
    const board = [header, '', ...reelLines, '', caption].join('\n')
    await ctx.reply(board)
}

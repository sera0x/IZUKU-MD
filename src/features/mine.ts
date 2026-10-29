import { randomInt } from 'node:crypto'
import { db } from '../db/index.js'
import { money, balanceOf } from './economy.js'
import type { CasinoCtx } from './casino.js'
import { renderMineImage } from './mine-image.js'

export const MINE_MAX_BET = 100_000
export const MINE_COOLDOWN_MS = 5_000
export const MINE_GRID = 25
export const MINE_BOMBS = 5
const HOUSE_EDGE = 0.03
const KEY = (chat: string, user: string) => `mine:${chat}:${user}`

export interface MineGame {
    bet: number
    bombs: number[]
    picked: number[]
    lost: boolean
}

const lastMineAt = new Map<string, number>()

export function mineCooldownLeft(user: string, now = Date.now()): number {
    const at = lastMineAt.get(user)
    return at === undefined ? 0 : Math.max(0, MINE_COOLDOWN_MS - (now - at))
}

/** Multiplier after `safeCount` safe picks: fair odds for this grid, minus the house edge. */
export function mineMultiplier(safeCount: number): number {
    if (safeCount <= 0) return 1
    let fair = 1
    for (let i = 0; i < safeCount; i++) fair *= (MINE_GRID - i) / (MINE_GRID - MINE_BOMBS - i)
    return Math.floor(fair * (1 - HOUSE_EDGE) * 100) / 100
}

export function placeBombs(roll: (n: number) => number = randomInt): number[] {
    const bombs = new Set<number>()
    while (bombs.size < MINE_BOMBS) bombs.add(roll(MINE_GRID))
    return [...bombs].sort((a, b) => a - b)
}

export function loadMine(chat: string, user: string): MineGame | undefined {
    const raw = db.settingValue(KEY(chat, user))
    return raw ? (JSON.parse(raw) as MineGame) : undefined
}

export function mineGrid(game: MineGame, reveal: boolean): string {
    const rows: string[] = []
    for (let r = 0; r < 5; r++) {
        let row = ''
        for (let c = 0; c < 5; c++) {
            const i = r * 5 + c
            if (game.picked.includes(i)) row += game.bombs.includes(i) ? '💥' : '💎'
            else if (reveal && game.bombs.includes(i)) row += '💣'
            else row += '⬜'
        }
        rows.push(row)
    }
    return rows.join('\n')
}

async function sendBoard(ctx: CasinoCtx, game: MineGame, reveal: boolean, caption: string): Promise<void> {
    const image = await renderMineImage(game, reveal).catch(() => null)
    if (image && ctx.sendImage) {
        await ctx.sendImage(image, caption)
        return
    }
    await ctx.reply(`${caption}\n\n${mineGrid(game, reveal)}`)
}

export async function startMine(ctx: CasinoCtx, betRaw: string | undefined): Promise<void> {
    const bet = Number.parseInt(betRaw ?? '', 10)
    if (!Number.isFinite(bet) || bet <= 0) return void (await ctx.reply(`usage: ${ctx.prefix}mine <bet>`))
    if (bet > MINE_MAX_BET) return void (await ctx.reply(`max bet is ${money(MINE_MAX_BET)} 🛑`))
    if (loadMine(ctx.chat, ctx.sender)) return void (await ctx.reply(`you already have a mine game, ${ctx.prefix}cashout or pick a tile 🛑`))
    const left = mineCooldownLeft(ctx.sender)
    if (left > 0) return void (await ctx.reply(`wait ${Math.ceil(left / 1000)}s 🛑`))
    if (balanceOf(ctx.sender) < bet) return void (await ctx.reply(`not enough ryo 🛑`))
    lastMineAt.set(ctx.sender, Date.now())
    const game: MineGame = { bet, bombs: placeBombs(), picked: [], lost: false }
    const debited = db.settleGamble(ctx.sender, bet, 0, bet, weekKey(), { saveKey: KEY(ctx.chat, ctx.sender), saveValue: JSON.stringify(game) })
    if (!debited) return void (await ctx.reply(`not enough ryo 🛑`))
    await sendBoard(ctx, game, false, [
        `💣 mine: ${money(bet)} on the line`,
        '',
        '⚙️ how it works',
        '5 bombs are hidden in 25 tiles',
        'every safe tile raises your multiplier',
        '2 safe ≈ 1.5x · 5 safe ≈ 3.3x · 10 safe ≈ 17x',
        'hit a bomb and the bet is gone',
        `bank anytime with ${ctx.prefix}cashout`,
        '',
        `pick tiles: ${ctx.prefix}mpick 1 2 3 (single numbers work too)`,
    ].join('\n'))
}

export function weekKey(d = new Date()): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function pickMine(ctx: CasinoCtx, tiles: string[]): Promise<void> {
    const game = loadMine(ctx.chat, ctx.sender)
    if (!game) return void (await ctx.reply(`no mine game running, start one with ${ctx.prefix}mine <bet> 🛑`))
    const nums = [...new Set(tiles.map((t) => Number.parseInt(t, 10)))]
    if (nums.length === 0 || nums.some((n) => !Number.isFinite(n) || n < 1 || n > MINE_GRID)) {
        return void (await ctx.reply(`tiles are 1 to 25 🛑`))
    }
    const fresh = nums.map((n) => n - 1).filter((i) => !game.picked.includes(i))
    for (const i of fresh) {
        game.picked.push(i)
        if (game.bombs.includes(i)) {
            game.lost = true
            db.settleGamble(ctx.sender, 0, 0, game.bet, weekKey(), { clearKey: KEY(ctx.chat, ctx.sender) })
            return void (await sendBoard(ctx, game, true, `💥 boom. lost ${money(game.bet)}`))
        }
    }
    const safe = game.picked.length
    const mult = mineMultiplier(safe)
    if (safe >= MINE_GRID - MINE_BOMBS) {
        const payout = Math.floor(game.bet * mult)
        db.settleGamble(ctx.sender, 0, payout, game.bet, weekKey(), { clearKey: KEY(ctx.chat, ctx.sender) })
        return void (await sendBoard(ctx, game, false, `🏆 all safe tiles. paid ${money(payout)} (${mult}x)`))
    }
    db.settleGamble(ctx.sender, 0, 0, 0, weekKey(), { saveKey: KEY(ctx.chat, ctx.sender), saveValue: JSON.stringify(game) })
    await sendBoard(ctx, game, false, `💎 ${safe} safe, now ${mult}x (${money(Math.floor(game.bet * mult))})\n${ctx.prefix}cashout to bank`)
}

export async function cashoutMine(ctx: CasinoCtx): Promise<void> {
    const game = loadMine(ctx.chat, ctx.sender)
    if (!game) return void (await ctx.reply(`no mine game running 🛑`))
    const safe = game.picked.length
    if (safe === 0) return void (await ctx.reply(`pick a tile first 🛑`))
    const mult = mineMultiplier(safe)
    const payout = Math.floor(game.bet * mult)
    db.settleGamble(ctx.sender, 0, payout, game.bet, weekKey(), { clearKey: KEY(ctx.chat, ctx.sender) })
    await sendBoard(ctx, game, false, `🏆 banked ${money(payout)} (${mult}x on ${safe} safe)`)
}

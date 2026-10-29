/**
 * Tic-tac-toe, brought back from the legacy bot without the mongoose/economy
 * baggage. One game per chat, kept in memory and swept after 15 idle minutes,
 * mirrored to the cloud store so a restart does not lose an in-flight match.
 * The board is drawn as an AMOLED-black PNG; names come from the caption.
 */

import sharp from 'sharp'
import { sameUser } from '../bot/identity.js'

export interface Game {
    chat: string
    players: [string, string]
    marks: Record<string, 'X' | 'O'>
    board: Array<string | null>
    turn: string
    at: number
    /** when the current turn started; a turn older than TURN_TIMEOUT is dead */
    turnAt: number
}

/** A turn dies after this long (legacy-style fast games). */
export const TURN_TIMEOUT_MS = 60_000

export interface BoardLabels {
    x?: string
    o?: string
    turn?: string
}

const TTL = 15 * 60 * 1000
const games = new Map<string, Game>()

export const WIN_LINES: number[][] = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
]


export function gameOf(chat: string): Game | null {
    const game = games.get(chat)
    if (!game) return null
    if (Date.now() - game.at > TTL) {
        games.delete(chat)
        return null
    }
    return game
}

/** True when the player on turn has overstayed their window. */
export function turnExpired(game: Game): boolean {
    return Date.now() - game.turnAt > TURN_TIMEOUT_MS
}

/** A player only gets one live game at a time, whichever chat it is in. */
export function gameInvolving(user: string): Game | null {
    for (const [chat, game] of games) {
        if (Date.now() - game.at > TTL) {
            games.delete(chat)
            continue
        }
        if (Object.keys(game.marks).some((key) => sameUser(key, user))) return game
    }
    return null
}

export function startGame(chat: string, a: string, b: string): Game | null {
    if (gameOf(chat)) return null
    const game: Game = {
        chat,
        players: [a, b],
        marks: { [a]: 'X', [b]: 'O' },
        board: Array.from({ length: 9 }, () => null),
        turn: a,
        at: Date.now(),
        turnAt: Date.now(),
    }
    games.set(chat, game)
    return game
}

export function endGame(chat: string): boolean {
    return games.delete(chat)
}

export type MoveResult =
    | { ok: true; game: Game; player: string; mark: 'X' | 'O'; winner?: string; draw?: boolean }
    | { ok: false; reason: string }

export function move(chat: string, user: string, position: number): MoveResult {
    const game = gameOf(chat)
    if (!game) return { ok: false, reason: 'No game is running. Start one with `ttt @user`.' }

    // Stale turn: nobody moved in time, the game is dead. Say so plainly
    // instead of leaving both players stuck.
    if (turnExpired(game)) {
        games.delete(chat)
        return { ok: false, reason: '\u23f1 Turn timed out (60s). Game over \u2014 start again with `ttt @user`.' }
    }

    const mineKey = Object.keys(game.marks).find((key) => sameUser(key, user))
    if (!mineKey) {
        return {
            ok: false,
            reason: `This game is between two players already. Only they can move. 🛑`,
        }
    }
    user = mineKey
    if (!sameUser(game.turn, user)) return { ok: false, reason: 'Wait for your turn. ⏳' }
    if (!Number.isInteger(position) || position < 1 || position > 9) {
        return { ok: false, reason: 'Pick a slot from 1 to 9. 🛑' }
    }

    const index = position - 1
    if (game.board[index]) return { ok: false, reason: 'That slot is already taken. 🛑' }

    const mark = game.marks[user]
    if (!mark) return { ok: false, reason: 'This game is not yours. 🛑' }

    game.board[index] = mark
    game.at = Date.now()
    game.turnAt = Date.now()

    const winner = WIN_LINES.find((line) => line.every((cell) => game.board[cell] === mark))
    if (winner) {
        games.delete(chat)
        return { ok: true, game, player: user, mark, winner: user }
    }

    if (game.board.every(Boolean)) {
        games.delete(chat)
        return { ok: true, game, player: user, mark, draw: true }
    }

    game.turn = sameUser(game.players[0], user) ? game.players[1] : game.players[0]
    return { ok: true, game, player: user, mark }
}

/**
 * Monospace AMOLED-style board: a minimal frame, plain X and O marks, and a
 * subtle dot for empty squares. Sent inside a code block so WhatsApp renders
 * it in fixed-width type.
 */
export function renderBoard(game: Game): string {
    const cell = (index: number): string => {
        const value = game.board[index]
        return value === 'X' || value === 'O' ? value : '·'
    }

    const row = (start: number): string => `│ ${cell(start)} │ ${cell(start + 1)} │ ${cell(start + 2)} │`

    return [
        '┌───┬───┬───┐',
        row(0),
        '├───┼───┼───┤',
        row(3),
        '├───┼───┼───┤',
        row(6),
        '└───┴───┴───┘',
    ].join('\n')
}

// ── Image board ───────────────────────────────────────────────────────────────────────────────

const BOARD_SIZE = 1080
const BOARD_MARGIN = 90
const CELL = (BOARD_SIZE - BOARD_MARGIN * 2) / 3

/** Cell center for a 0-8 slot index. */
function cellCenter(index: number): { x: number; y: number } {
    return {
        x: BOARD_MARGIN + CELL * (index % 3) + CELL / 2,
        y: BOARD_MARGIN + CELL * Math.floor(index / 3) + CELL / 2,
    }
}

/**
 * Pure-black AMOLED board image: #000 canvas, dim grid, red X, blue O and
 * faint slot numbers on empty cells so players can see which number to send.
 * Falls back to the caller's text frame if rendering ever fails.
 */
export async function renderBoardImage(game: Game): Promise<Buffer> {
    const parts: string[] = []

    for (let i = 1; i <= 2; i += 1) {
        const line = BOARD_MARGIN + CELL * i
        parts.push(
            `<line x1="${line}" y1="${BOARD_MARGIN}" x2="${line}" y2="${BOARD_SIZE - BOARD_MARGIN}" stroke="#2c2c2e" stroke-width="6" stroke-linecap="round"/>`,
        )
        parts.push(
            `<line x1="${BOARD_MARGIN}" y1="${line}" x2="${BOARD_SIZE - BOARD_MARGIN}" y2="${line}" stroke="#2c2c2e" stroke-width="6" stroke-linecap="round"/>`,
        )
    }

    for (let index = 0; index < 9; index += 1) {
        const { x, y } = cellCenter(index)
        const value = game.board[index]

        if (value === 'X') {
            const d = 80
            parts.push(
                `<line x1="${x - d}" y1="${y - d}" x2="${x + d}" y2="${y + d}" stroke="#ff453a" stroke-width="26" stroke-linecap="round"/>`,
            )
            parts.push(
                `<line x1="${x + d}" y1="${y - d}" x2="${x - d}" y2="${y + d}" stroke="#ff453a" stroke-width="26" stroke-linecap="round"/>`,
            )
        } else if (value === 'O') {
            parts.push(
                `<circle cx="${x}" cy="${y}" r="86" fill="none" stroke="#0a84ff" stroke-width="26"/>`,
            )
        } else {
            parts.push(
                `<text x="${x}" y="${y}" font-size="130" font-family="sans-serif" fill="#3a3a3c" text-anchor="middle" dominant-baseline="central">${index + 1}</text>`,
            )
        }
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_SIZE}" height="${BOARD_SIZE}">`,
        `<rect width="${BOARD_SIZE}" height="${BOARD_SIZE}" fill="#000000"/>`,
        ...parts,
        '</svg>',
    ].join('')

    return sharp(Buffer.from(svg)).png().toBuffer()
}

// ── Cloud mirror ───────────────────────────────────────────────────────────────────────────────────

export interface SerializedGame {
    chat: string
    players: [string, string]
    marks: Record<string, 'X' | 'O'>
    board: Array<string | null>
    turn: string
    at: number
}

export function snapshotGames(): SerializedGame[] {
    const now = Date.now()
    const rows: SerializedGame[] = []
    for (const [chat, game] of games) {
        if (now - game.at > TTL) {
            games.delete(chat)
            continue
        }
        rows.push({
            chat: game.chat,
            players: [...game.players] as [string, string],
            marks: { ...game.marks },
            board: [...game.board],
            turn: game.turn,
            at: game.at,
        })
    }
    return rows
}

/** Restore synced games, skipping anything malformed or already expired. */
export function restoreGames(rows: unknown): number {
    if (!Array.isArray(rows)) return 0

    let restored = 0
    for (const entry of rows) {
        if (!entry || typeof entry !== 'object') continue
        const row = entry as Partial<SerializedGame>
        if (typeof row.chat !== 'string' || !row.chat.endsWith('@g.us')) continue
        if (!Array.isArray(row.players) || row.players.length !== 2) continue
        if (row.players.some((player) => typeof player !== 'string' || player.length === 0)) continue
        if (!row.marks || typeof row.marks !== 'object') continue
        if (!Array.isArray(row.board) || row.board.length !== 9) continue
        if (typeof row.turn !== 'string' || typeof row.at !== 'number') continue
        if (Date.now() - row.at > TTL) continue
        if (games.has(row.chat)) continue

        const [a, b] = row.players as [string, string]
        const board = row.board.map((cell) => (cell === 'X' || cell === 'O' ? cell : null))
        games.set(row.chat, {
            chat: row.chat,
            players: [a, b],
            marks: { [a]: 'X', [b]: 'O' },
            board,
            turn: row.turn,
            at: row.at,
            turnAt: row.at,
        })
        restored += 1
    }
    return restored
}

// ── Prefix-free input ─────────────────────────────────────────────────────────

const TTT_WORDS = new Set(['ttt', 'tictactoe', 'tic'])

/**
 * Tic-tac-toe does not need the command prefix: `ttt @user`, `ttt 5`,
 * `ttt end`, and a bare `5` while a game is live all work. Returns the
 * arguments to run the `.ttt` command with, or null when the text is not a
 * move at all.
 */
export function bareTttCommand(chat: string, body: string): { args: string } | null {
    const trimmed = body.trim()
    if (!trimmed) return null

    const [first, ...rest] = trimmed.split(/\s+/)
    const word = (first ?? '').toLowerCase().replace(/[.!?]+$/, '')
    if (TTT_WORDS.has(word)) return { args: rest.join(' ') }

    // A lone digit is only a move when the chat already has a game, so the
    // bot never treats ordinary counting chatter as a command.
    if (gameOf(chat) && /^[1-9]$/.test(trimmed)) return { args: trimmed }

    return null
}

/** Test seam so a suite can reset the shared state. */
export function clearGames(): void {
    games.clear()
}

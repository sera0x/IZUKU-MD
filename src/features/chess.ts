/**
 * Chess for two players in one chat.
 *
 * Self-contained rules engine (no dependency): legal move generation with
 * check detection, castling, en passant and promotion, and checkmate/stalemate
 * detection. The board is drawn as a cream-and-brown PNG, the same way
 * tic-tac-toe renders its grid, so every move comes back as a picture.
 */

import sharp from 'sharp'
import { sameUser } from '../bot/identity.js'

export type Color = 'w' | 'b'
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export interface Piece {
    type: PieceType
    color: Color
}

export interface Move {
    from: number
    to: number
    /** Set on a promoting pawn move. */
    promo?: PieceType
    /** 'castle-k' / 'castle-q' / 'ep' / 'double' — used for bookkeeping only. */
    flags?: string
}

export interface ChessGame {
    chat: string
    /** players[0] is white, players[1] is black. */
    players: [string, string]
    board: Array<Piece | null>
    turn: Color
    castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean }
    /** Square index a pawn may capture onto en passant, or null. */
    ep: number | null
    halfmove: number
    fullmove: number
    lastMove?: { from: number; to: number }
    at: number
    turnAt: number
}

/** A player has this long to move before the game is abandoned. */
export const TURN_TIMEOUT_MS = 5 * 60_000
const TTL = 60 * 60 * 1000

const games = new Map<string, ChessGame>()

// ── Squares ───────────────────────────────────────────────────────────────────

const FILES = 'abcdefgh'

/** 0 = a8, 63 = h1. */
export const squareIndex = (name: string): number => {
    const match = /^([a-h])([1-8])$/.exec(name.toLowerCase())
    if (!match) return -1
    const file = FILES.indexOf(match[1] as string)
    const rank = Number(match[2])
    return (8 - rank) * 8 + file
}

export const squareName = (index: number): string => {
    const file = FILES[index % 8] ?? '?'
    const rank = 8 - Math.floor(index / 8)
    return `${file}${rank}`
}

const fileOf = (index: number): number => index % 8
const rankOf = (index: number): number => 8 - Math.floor(index / 8)

const startBoard = (): Array<Piece | null> => {
    const board: Array<Piece | null> = Array.from({ length: 64 }, () => null)
    const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
    for (let file = 0; file < 8; file += 1) {
        board[file] = { type: back[file] as PieceType, color: 'b' }
        board[8 + file] = { type: 'p', color: 'b' }
        board[48 + file] = { type: 'p', color: 'w' }
        board[56 + file] = { type: back[file] as PieceType, color: 'w' }
    }
    return board
}

export function gameOf(chat: string): ChessGame | null {
    const game = games.get(chat)
    if (!game) return null
    if (Date.now() - game.at > TTL) {
        games.delete(chat)
        return null
    }
    return game
}

/** One live game per player, whichever chat it is in. */
export function gameInvolving(user: string): ChessGame | null {
    for (const [chat, game] of games) {
        if (Date.now() - game.at > TTL) {
            games.delete(chat)
            continue
        }
        if (game.players.some((player) => sameUser(player, user))) return game
    }
    return null
}

export function turnExpired(game: ChessGame): boolean {
    return Date.now() - game.turnAt > TURN_TIMEOUT_MS
}

export function startGame(chat: string, white: string, black: string): ChessGame | null {
    if (gameOf(chat)) return null
    const game: ChessGame = {
        chat,
        players: [white, black],
        board: startBoard(),
        turn: 'w',
        castling: { wk: true, wq: true, bk: true, bq: true },
        ep: null,
        halfmove: 0,
        fullmove: 1,
        at: Date.now(),
        turnAt: Date.now(),
    }
    games.set(chat, game)
    return game
}

export function endGame(chat: string): boolean {
    return games.delete(chat)
}

// ── Move generation ───────────────────────────────────────────────────────────

const KNIGHT_STEPS: Array<[number, number]> = [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
]
const BISHOP_DIRS: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
]
const ROOK_DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
]
const KING_DIRS: Array<[number, number]> = [...BISHOP_DIRS, ...ROOK_DIRS]

const inside = (file: number, rank: number): boolean =>
    file >= 0 && file < 8 && rank >= 1 && rank <= 8

const indexOf = (file: number, rank: number): number => (8 - rank) * 8 + file

const stepSquare = (index: number, df: number, dr: number): number => {
    const file = fileOf(index) + df
    const rank = rankOf(index) + dr
    if (!inside(file, rank)) return -1
    return indexOf(file, rank)
}

const enemy = (color: Color): Color => (color === 'w' ? 'b' : 'w')

/** Squares attacked by `color`, independent of whose king is where. */
function attacked(game: ChessGame, target: number, color: Color): boolean {
    const board = game.board

    // Pawns capture diagonally forward. White advances towards rank 8, so a
    // white pawn attacking `target` sits one rank below it.
    for (const df of [-1, 1]) {
        const from = stepSquare(target, df, color === 'w' ? -1 : 1)
        if (from < 0) continue
        const piece = board[from]
        if (piece && piece.color === color && piece.type === 'p') return true
    }

    for (const [df, dr] of KNIGHT_STEPS) {
        const from = stepSquare(target, df, dr)
        if (from < 0) continue
        const piece = board[from]
        if (piece && piece.color === color && piece.type === 'n') return true
    }

    for (const [df, dr] of KING_DIRS) {
        const from = stepSquare(target, df, dr)
        if (from < 0) continue
        const piece = board[from]
        if (piece && piece.color === color && piece.type === 'k') return true
    }

    for (const [df, dr] of BISHOP_DIRS) {
        let current = stepSquare(target, df, dr)
        while (current >= 0) {
            const piece = board[current]
            if (piece) {
                if (piece.color === color && (piece.type === 'b' || piece.type === 'q')) return true
                break
            }
            current = stepSquare(current, df, dr)
        }
    }

    for (const [df, dr] of ROOK_DIRS) {
        let current = stepSquare(target, df, dr)
        while (current >= 0) {
            const piece = board[current]
            if (piece) {
                if (piece.color === color && (piece.type === 'r' || piece.type === 'q')) return true
                break
            }
            current = stepSquare(current, df, dr)
        }
    }

    return false
}

export function inCheck(game: ChessGame, color: Color): boolean {
    const king = game.board.findIndex((piece) => piece && piece.color === color && piece.type === 'k')
    if (king < 0) return false
    return attacked(game, king, enemy(color))
}

function pseudoMoves(game: ChessGame, color: Color, from?: number): Move[] {
    const moves: Move[] = []
    const board = game.board

    const push = (start: number, to: number, flags?: string, promo?: PieceType): void => {
        moves.push(promo ? { from: start, to, flags, promo } : flags ? { from: start, to, flags } : { from: start, to })
    }

    for (let index = 0; index < 64; index += 1) {
        if (from !== undefined && index !== from) continue
        const piece = board[index]
        if (!piece || piece.color !== color) continue

        if (piece.type === 'p') {
            const dir = color === 'w' ? 1 : -1
            const startRank = color === 'w' ? 2 : 7
            const promoRank = color === 'w' ? 8 : 1

            const one = stepSquare(index, 0, dir)
            if (one >= 0 && !board[one]) {
                if (rankOf(one) === promoRank) {
                    for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) push(index, one, undefined, promo)
                } else {
                    push(index, one)
                    const two = stepSquare(index, 0, dir * 2)
                    if (rankOf(index) === startRank && two >= 0 && !board[two]) push(index, two)
                }
            }

            for (const df of [-1, 1]) {
                const to = stepSquare(index, df, dir)
                if (to < 0) continue
                const target = board[to]
                if (target && target.color !== color) {
                    if (rankOf(to) === promoRank) {
                        for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) push(index, to, undefined, promo)
                    } else push(index, to)
                } else if (!target && game.ep === to) {
                    push(index, to, 'ep')
                }
            }
            continue
        }

        if (piece.type === 'n' || piece.type === 'k') {
            const steps = piece.type === 'n' ? KNIGHT_STEPS : KING_DIRS
            for (const [df, dr] of steps) {
                const to = stepSquare(index, df, dr)
                if (to < 0) continue
                const target = board[to]
                if (!target || target.color !== color) push(index, to)
            }
            continue
        }

        const dirs = piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : KING_DIRS
        for (const [df, dr] of dirs) {
            let to = stepSquare(index, df, dr)
            while (to >= 0) {
                const target = board[to]
                if (!target) push(index, to)
                else {
                    if (target.color !== color) push(index, to)
                    break
                }
                to = stepSquare(to, df, dr)
            }
        }
    }

    if (color === 'w' && !from) {
        // Castling is generated by hand: king and rook must be untouched.
        void 0
    }

    return moves
}

function cloneGame(game: ChessGame): ChessGame {
    return {
        ...game,
        board: game.board.map((piece) => (piece ? { ...piece } : null)),
        castling: { ...game.castling },
    }
}

function applyToBoard(game: ChessGame, move: Move): ChessGame {
    const next = cloneGame(game)
    const piece = next.board[move.from]
    if (!piece) return next

    next.board[move.from] = null

    if (move.flags === 'ep') {
        const capturedRank = rankOf(move.to) + (piece.color === 'w' ? -1 : 1)
        next.board[indexOf(fileOf(move.to), capturedRank)] = null
    }

    next.board[move.to] = move.promo ? { type: move.promo, color: piece.color } : piece

    // Castling: move the rook with the king.
    if (piece.type === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
        const rank = rankOf(move.from)
        const rookFrom = fileOf(move.to) > fileOf(move.from) ? indexOf(7, rank) : indexOf(0, rank)
        const rookTo = fileOf(move.to) > fileOf(move.from) ? indexOf(5, rank) : indexOf(3, rank)
        next.board[rookFrom] = null
        next.board[rookTo] = game.board[rookFrom] ?? null
    }

    // Castling rights.
    if (piece.type === 'k') {
        if (piece.color === 'w') {
            next.castling.wk = false
            next.castling.wq = false
        } else {
            next.castling.bk = false
            next.castling.bq = false
        }
    }
    if (piece.type === 'r') {
        if (move.from === squareIndex('h1')) next.castling.wk = false
        if (move.from === squareIndex('a1')) next.castling.wq = false
        if (move.from === squareIndex('h8')) next.castling.bk = false
        if (move.from === squareIndex('a8')) next.castling.bq = false
    }
    if (move.to === squareIndex('h1')) next.castling.wk = false
    if (move.to === squareIndex('a1')) next.castling.wq = false
    if (move.to === squareIndex('h8')) next.castling.bk = false
    if (move.to === squareIndex('a8')) next.castling.bq = false

    // En passant target after a double pawn push.
    next.ep = null
    if (piece.type === 'p' && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
        const midRank = (rankOf(move.to) + rankOf(move.from)) / 2
        next.ep = indexOf(fileOf(move.from), midRank)
    }

    next.halfmove = piece.type === 'p' || game.board[move.to] ? 0 : game.halfmove + 1
    if (piece.color === 'b') next.fullmove = game.fullmove + 1
    next.turn = enemy(piece.color)
    next.at = Date.now()
    next.turnAt = Date.now()
    next.lastMove = { from: move.from, to: move.to }
    return next
}

/** Legal moves for a side, castling included, king safety enforced. */
export function legalMoves(game: ChessGame, color: Color = game.turn): Move[] {
    const moves = pseudoMoves(game, color)

    // Castling: king not in check, squares empty and not attacked.
    const rank = color === 'w' ? 1 : 8
    const kingFrom = indexOf(4, rank)
    const king = game.board[kingFrom]
    const rights = color === 'w' ? { k: game.castling.wk, q: game.castling.wq } : { k: game.castling.bk, q: game.castling.bq }
    if (king && king.type === 'k' && king.color === color && !attacked(game, kingFrom, enemy(color))) {
        if (rights.k) {
            const f = indexOf(5, rank)
            const g = indexOf(6, rank)
            const rook = game.board[indexOf(7, rank)]
            if (
                !game.board[f] &&
                !game.board[g] &&
                rook &&
                rook.type === 'r' &&
                rook.color === color &&
                !attacked(game, f, enemy(color)) &&
                !attacked(game, g, enemy(color))
            ) {
                moves.push({ from: kingFrom, to: g })
            }
        }
        if (rights.q) {
            const d = indexOf(3, rank)
            const c = indexOf(2, rank)
            const b = indexOf(1, rank)
            const rook = game.board[indexOf(0, rank)]
            if (
                !game.board[d] &&
                !game.board[c] &&
                !game.board[b] &&
                rook &&
                rook.type === 'r' &&
                rook.color === color &&
                !attacked(game, d, enemy(color)) &&
                !attacked(game, c, enemy(color))
            ) {
                moves.push({ from: kingFrom, to: c })
            }
        }
    }

    return moves.filter((move) => {
        const next = applyToBoard(game, move)
        const kingSquare = next.board.findIndex((piece) => piece && piece.color === color && piece.type === 'k')
        if (kingSquare < 0) return false
        return !attacked(next, kingSquare, enemy(color))
    })
}

export type MoveOutcome =
    | {
          ok: true
          game: ChessGame
          move: Move
          notation: string
          check: boolean
          checkmate: boolean
          stalemate: boolean
      }
    | { ok: false; reason: string }

/**
 * Turn what a player typed into a legal move. Accepts the square form
 * (`e2e4`, `e2-e4`, `e7e8q`) and normal chess notation (`Nf3`, `exd5`, `e4`,
 * `Nbd2`, `O-O`, `e8=Q`), which is far less to remember than both squares.
 */
export type MoveResolution =
    | { ok: true; move: Move }
    /** Several pieces can reach that square: the caller asks which one. */
    | { ok: false; reason: string; choices?: Move[] }

export function resolveMove(game: ChessGame, color: Color, input: string): MoveResolution {
    const raw = input.trim().replace(/[+#!?]+$/g, '')
    const clean = raw.toLowerCase().replace(/[\s-]/g, '')
    const moves = legalMoves(game, color)
    if (!clean) return { ok: false, reason: 'Just say where the piece goes — e.g. *e4* or *f3*. 🛑' }

    // Castling, written the way people actually write it.
    const castle = /^(o|0){2,3}$/.exec(clean)
    if (castle) {
        const king = game.board.findIndex((piece) => piece && piece.color === color && piece.type === 'k')
        const kingSide = castle[0].length === 2
        const to = squareIndex(`${kingSide ? 'g' : 'c'}${color === 'w' ? 1 : 8}`)
        const move = moves.find((entry) => entry.from === king && entry.to === to)
        if (!move) return { ok: false, reason: `${kingSide ? 'King-side' : 'Queen-side'} castling is not available right now. 🛑` }
        return { ok: true, move }
    }

    const squares = parseMoveLine(clean)
    if (squares) {
        const move = moves.find(
            (entry) => entry.from === squares.from && entry.to === squares.to && (entry.promo ?? 'q') === (squares.promo ?? 'q'),
        )
        if (move) return { ok: true, move }
        return { ok: false, reason: `${squareName(squares.from)} → ${squareName(squares.to)} is not a legal move. 🛑` }
    }

    // Plain words first: `pawn e4`, `knight f3`, `horse f3` — no notation to
    // remember. A piece letter (`Nf3`) still works for anyone used to it.
    const spoken = raw.toLowerCase().replace(/[\s-]+/g, ' ').trim()
    const worded = /^(pawn|knight|horse|bishop|rook|castle|queen|king)\s*([a-h][1-8])?\s*([a-h][1-8])(?:=?([qrbn]))?$/.exec(spoken)
    if (worded) {
        const named = PIECE_WORD[worded[1] as string] as PieceType
        const from = worded[2] ? squareIndex(worded[2]) : -1
        const to = squareIndex(worded[3] as string)
        const promo = worded[4] as PieceType | undefined
        const picks = moves.filter((entry) => {
            const piece = game.board[entry.from]
            if (!piece || piece.type !== named || entry.to !== to) return false
            if (from >= 0 && entry.from !== from) return false
            if (promo && (entry.promo ?? 'q') !== promo) return false
            return true
        })
        const single = collapsePromotions(picks)
        if (single.length === 1) return { ok: true, move: single[0] as Move }
        if (single.length > 1) return { ok: false, reason: '', choices: single.slice(0, 9) }
        return { ok: false, reason: `No ${worded[1]} can go to *${worded[3]}* right now. 🛑` }
    }

    // `.chess castle` — kingside if it is available, else queenside.
    if (/^(castle|castling|castleking|castlequeen)$/.test(clean)) {
        const king = game.board.findIndex((piece) => piece && piece.color === color && piece.type === 'k')
        const targets = clean === 'castlequeen' ? ['c'] : clean === 'castleking' ? ['g'] : ['g', 'c']
        const rank = color === 'w' ? 1 : 8
        for (const file of targets) {
            const move = moves.find((entry) => entry.from === king && entry.to === squareIndex(`${file}${rank}`))
            if (move) return { ok: true, move }
        }
        return { ok: false, reason: 'Castling is not available right now. 🛑' }
    }

    // Destination square only — the piece is optional. Any piece that can
    // legally get there is a candidate, so `e4` and `Nf3` both just work.
    const san = /^([kqrbn])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([qrbn]))?$/.exec(clean)
    if (!san) return { ok: false, reason: 'Just say where the piece goes — e.g. *e4* or *f3*. 🛑' }

    const letter = san[1] as PieceType | undefined
    const fromFile = san[2]
    const fromRank = san[3]
    const to = squareIndex(san[4] as string)
    const promo = san[5] as PieceType | undefined
    const matches = moves.filter((entry) => {
        if (entry.to !== to) return false
        const piece = game.board[entry.from]
        if (!piece) return false
        if (letter && piece.type !== letter) return false
        const square = squareName(entry.from)
        if (fromFile && square[0] !== fromFile) return false
        if (fromRank && square[1] !== fromRank) return false
        if (promo && (entry.promo ?? 'q') !== promo) return false
        return true
    })

    const single = collapsePromotions(matches)
    if (single.length === 1) return { ok: true, move: single[0] as Move }
    if (single.length > 1) return { ok: false, reason: '', choices: single.slice(0, 9) }
    return { ok: false, reason: `*${raw}* is not a legal move right now. 🛑` }
}

/** Parse `e2e4`, `e2-e4`, `e7e8q` (promotion optional, defaults to queen). */
export function parseMoveLine(input: string): { from: number; to: number; promo?: PieceType } | null {
    const clean = input.trim().toLowerCase().replace(/[\s-]/g, '')
    const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(clean)
    if (!match) return null
    const from = squareIndex(match[1] as string)
    const to = squareIndex(match[2] as string)
    if (from < 0 || to < 0) return null
    const promo = match[3] as PieceType | undefined
    return promo ? { from, to, promo } : { from, to }
}

/** Short algebraic-ish text for a played move, e.g. `♘ g1→f3`. */
function describe(game: ChessGame, move: Move): string {
    const piece = game.board[move.from]
    const name = piece ? piece.type.toUpperCase() : '?'
    const capture = game.board[move.to] || move.flags === 'ep' ? 'x' : '→'
    return `${name} ${squareName(move.from)}${capture}${squareName(move.to)}${move.promo ? '=' + move.promo.toUpperCase() : ''}`
}

/** Piece words, so a player never has to type a letter or notation. */
const PIECE_WORD: Record<string, PieceType> = {
    pawn: 'p',
    knight: 'n',
    horse: 'n',
    bishop: 'b',
    rook: 'r',
    castle: 'r',
    queen: 'q',
    king: 'k',
}

/**
 * A promotion is four legal moves from one square to one square; unless the
 * player named a piece, keep only the queen so it is not a menu.
 */
function collapsePromotions(moves: Move[]): Move[] {
    const seen = new Map<string, Move>()
    for (const move of moves) {
        const key = `${move.from}-${move.to}`
        const current = seen.get(key)
        if (!current) seen.set(key, move)
        else if ((move.promo ?? 'q') === 'q' && (current.promo ?? 'q') !== 'q') seen.set(key, move)
    }
    return [...seen.values()]
}

/**
 * A square more than one piece can reach leaves a short numbered menu open for
 * a couple of minutes, so the follow-up is just `.chess 2`. Kept in memory: a
 * restart only costs the player one repeated message.
 */
const CHOICE_KEY = (chat: string): string => chat
const choices = new Map<string, { user: string; color: Color; moves: Move[]; at: number }>()
const CHOICE_MS = 3 * 60_000

const PIECE_NAME: Record<PieceType, string> = {
    p: 'pawn',
    n: 'knight',
    b: 'bishop',
    r: 'rook',
    q: 'queen',
    k: 'king',
}

function choiceText(game: ChessGame, moves: Move[]): string {
    const sameType = new Map<PieceType, number>()
    for (const move of moves) {
        const piece = game.board[move.from]
        if (piece) sameType.set(piece.type, (sameType.get(piece.type) ?? 0) + 1)
    }

    const lines = moves.map((move, index) => {
        const piece = game.board[move.from]
        if (!piece) return `${index + 1}) ${squareName(move.from)} → *${squareName(move.to)}*`
        const name = PIECE_NAME[piece.type]
        const capture = game.board[move.to] ? ' takes' : ' →'
        // Two knights can reach the same square: then the from-square picks one.
        const command =
            (sameType.get(piece.type) ?? 0) > 1
                ? `${name} ${squareName(move.from)} ${squareName(move.to)}`
                : `${name} ${squareName(move.to)}`
        return `${index + 1}) ${name} ${squareName(move.from)}${capture} *${squareName(move.to)}*  ·  \`.chess ${command}\``
    })
    return ['🤔 Which piece? Say it like `.chess pawn e4`:', '', ...lines].join('\n')
}

export function playMove(chat: string, user: string, input: string): MoveOutcome {
    const game = gameOf(chat)
    if (!game) return { ok: false, reason: 'No chess game is running. Start one with `.chess @user`.' }

    if (turnExpired(game)) {
        games.delete(chat)
        choices.delete(CHOICE_KEY(chat))
        return { ok: false, reason: '⏱ Turn timed out (5 min). Game over — start again with `.chess @user`.' }
    }

    const playerIndex = game.players.findIndex((player) => sameUser(player, user))
    if (playerIndex < 0) return { ok: false, reason: 'This game is between two players already. 🛑' }

    const color: Color = playerIndex === 0 ? 'w' : 'b'
    if (game.turn !== color) return { ok: false, reason: 'Wait for your turn. ⏳' }

    // A bare number answers the "which piece?" question.
    const picked = /^(\d{1,2})$/.exec(input.trim())
    const open = choices.get(CHOICE_KEY(chat))
    let chosen: Move | undefined
    if (picked && open && open.user === user && open.color === color && Date.now() - open.at < CHOICE_MS) {
        choices.delete(CHOICE_KEY(chat))
        chosen = open.moves[Number(picked[1]) - 1]
        if (!chosen) return { ok: false, reason: 'That number is not on the list. 🛑' }
    }

    let legal: Move
    if (chosen) {
        legal = chosen
    } else {
        const resolved = resolveMove(game, color, input)
        if (!resolved.ok) {
            if (resolved.choices) {
                choices.set(CHOICE_KEY(chat), { user, color, moves: resolved.choices, at: Date.now() })
                return { ok: false, reason: choiceText(game, resolved.choices) }
            }
            return { ok: false, reason: resolved.reason }
        }
        legal = resolved.move
    }

    const notation = describe(game, legal)
    const next = applyToBoard(game, legal)
    const opponent = enemy(color)
    const replies = legalMoves(next, opponent)
    const check = inCheck(next, opponent)
    const checkmate = check && replies.length === 0
    const stalemate = !check && replies.length === 0

    if (checkmate || stalemate) games.delete(chat)
    else games.set(chat, next)

    return { ok: true, game: next, move: legal, notation, check, checkmate, stalemate }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const BOARD_SIZE = 1080
const MARGIN = 60
const CELL = (BOARD_SIZE - MARGIN * 2) / 8
// Classic cream-and-brown wood board: both colours stay readable on WhatsApp's
// dark and light themes, unlike the old near-black squares.
const LIGHT = '#f0d9b5'
const DARK = '#b58863'
const HIGHLIGHT = '#cdd26a'
const FRAME = '#3d2a1a'
const LABEL = '#f0d9b5'
const LIGHT_PIECE = { fill: '#ffffff', stroke: '#4a2d18', width: 2.2 }
const DARK_PIECE = { fill: '#120b06', stroke: '#fff3e0', width: 3.5 }

const GLYPHS: Record<PieceType, { w: string; b: string }> = {
    k: { w: '♔', b: '♚' },
    q: { w: '♕', b: '♛' },
    r: { w: '♖', b: '♜' },
    b: { w: '♗', b: '♝' },
    n: { w: '♘', b: '♞' },
    p: { w: '♙', b: '♟' },
}

/** Monospace text board, used if image rendering fails. */
export function renderBoard(game: ChessGame): string {
    const lines: string[] = []
    for (let rank = 8; rank >= 1; rank -= 1) {
        const row: string[] = []
        for (let file = 0; file < 8; file += 1) {
            const piece = game.board[indexOf(file, rank)]
            row.push(piece ? GLYPHS[piece.type][piece.color] : '·')
        }
        lines.push(`${rank} │ ${row.join(' ')}`)
    }
    lines.push('   ' + FILES.split('').join('  '))
    return lines.join('\n')
}

/** Board SVG at any size: cream/brown squares, coordinates, last move marked. */
function boardSvg(game: ChessGame, size: number): Buffer {
    const scale = size / BOARD_SIZE
    const cell = CELL * scale
    const margin = MARGIN * scale
    const parts: string[] = []

    for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
            const index = row * 8 + col
            const isLight = (row + col) % 2 === 0
            const highlighted =
                game.lastMove && (game.lastMove.from === index || game.lastMove.to === index)
            parts.push(
                `<rect x="${margin + col * cell}" y="${margin + row * cell}" width="${cell}" height="${cell}" fill="${highlighted ? HIGHLIGHT : isLight ? LIGHT : DARK}"/>`,
            )
        }
    }

    for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
            const index = row * 8 + col
            const piece = game.board[index]
            const x = margin + col * cell + cell / 2
            const y = margin + row * cell + cell / 2 + 12 * scale
            if (!piece) continue
            const colors = piece.color === 'w' ? LIGHT_PIECE : DARK_PIECE
            parts.push(
                `<text x="${x}" y="${y}" font-size="${cell * 0.72}" font-family="DejaVu Sans, sans-serif" text-anchor="middle" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${colors.width * scale}">${GLYPHS[piece.type][piece.color]}</text>`,
            )
        }
    }

    for (let file = 0; file < 8; file += 1) {
        parts.push(
            `<text x="${margin + file * cell + cell / 2}" y="${size - 16 * scale}" font-size="${34 * scale}" font-family="DejaVu Sans, sans-serif" fill="${LABEL}" text-anchor="middle">${FILES[file]}</text>`,
        )
    }
    for (let rank = 8; rank >= 1; rank -= 1) {
        parts.push(
            `<text x="${24 * scale}" y="${margin + (8 - rank) * cell + cell / 2 + 10 * scale}" font-size="${34 * scale}" font-family="DejaVu Sans, sans-serif" fill="${LABEL}" text-anchor="middle">${rank}</text>`,
        )
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`,
        `<rect width="${size}" height="${size}" fill="${FRAME}"/>`,
        ...parts,
        '</svg>',
    ].join('')

    return Buffer.from(svg)
}

/** Full-size board picture sent with every move. */
export async function renderBoardImage(game: ChessGame): Promise<Buffer> {
    return sharp(boardSvg(game, BOARD_SIZE)).png().toBuffer()
}

// ── Cloud mirror ──────────────────────────────────────────────────────────────

export function snapshotChessGames(): ChessGame[] {
    const now = Date.now()
    const rows: ChessGame[] = []
    for (const [chat, game] of games) {
        if (now - game.at > TTL) {
            games.delete(chat)
            continue
        }
        rows.push({ ...game, board: game.board.map((piece) => (piece ? { ...piece } : null)) })
    }
    return rows
}

export function restoreChessGames(rows: unknown): number {
    if (!Array.isArray(rows)) return 0
    let restored = 0
    for (const entry of rows) {
        if (!entry || typeof entry !== 'object') continue
        const row = entry as Partial<ChessGame>
        if (typeof row.chat !== 'string' || !row.chat.endsWith('@g.us')) continue
        if (games.has(row.chat)) continue
        if (!Array.isArray(row.players) || row.players.length !== 2) continue
        if (row.players.some((player) => typeof player !== 'string' || !player)) continue
        if (!Array.isArray(row.board) || row.board.length !== 64) continue
        if (row.turn !== 'w' && row.turn !== 'b') continue
        if (typeof row.at !== 'number' || Date.now() - row.at > TTL) continue

        games.set(row.chat, {
            chat: row.chat,
            players: [row.players[0] as string, row.players[1] as string],
            board: row.board.map((piece) =>
                piece && typeof piece === 'object' && 'type' in piece && 'color' in piece
                    ? { type: (piece as Piece).type, color: (piece as Piece).color }
                    : null,
            ),
            turn: row.turn,
            castling: row.castling ?? { wk: true, wq: true, bk: true, bq: true },
            ep: typeof row.ep === 'number' ? row.ep : null,
            halfmove: row.halfmove ?? 0,
            fullmove: row.fullmove ?? 1,
            lastMove: row.lastMove,
            at: row.at,
            turnAt: row.turnAt ?? row.at,
        })
        restored += 1
    }
    return restored
}

/** Test seam. */
export function clearChessGames(): void {
    games.clear()
}

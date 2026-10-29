import { config } from '../config.ts'
import { jidToNumber } from '../bot/helpers.js'
import { phoneDigitsFor } from '../bot/identity.js'
import { syncSoon } from './cloud.js'
import { recordGame } from './game-stats.js'
import { money, rewardGameWin } from './economy.js'

export type WordChainPhase = 'joining' | 'playing'

export interface WordChainPlayer {
    key: string
    jid: string
    name: string
}

export interface WordChainGame {
    chat: string
    startedBy: string
    phase: WordChainPhase
    lastWord: string
    used: Set<string>
    startedAt: number
    players: Map<string, WordChainPlayer>
    order: string[]
    turnIndex: number
    joinDeadline: number
    turnDeadline: number
    timer?: ReturnType<typeof setTimeout>
    countdown?: ReturnType<typeof setInterval>
    group: boolean
    accepted: number
    notify: (text: string) => Promise<unknown>
}

const STARTERS = [
    'apple',
    'banana',
    'grape',
    'lemon',
    'mango',
    'tiger',
    'river',
    'stone',
    'cloud',
    'dream',
    'earth',
    'flame',
    'ghost',
    'honey',
    'ivory',
    'jungle',
    'knife',
    'light',
    'magic',
    'night',
    'ocean',
    'piano',
    'queen',
    'radio',
    'sugar',
    'train',
    'unity',
    'voice',
    'water',
    'youth',
    'zebra',
] as const

const LOCAL_WORDS = new Set([
    ...STARTERS,
    'able',
    'about',
    'above',
    'actor',
    'adore',
    'after',
    'again',
    'agent',
    'agile',
    'alarm',
    'album',
    'alert',
    'alien',
    'align',
    'alive',
    'allow',
    'alone',
    'amber',
    'angel',
    'anger',
    'angle',
    'animal',
    'ankle',
    'apart',
    'arena',
    'argue',
    'arise',
    'armor',
    'arrow',
    'aside',
    'asset',
    'atlas',
    'audio',
    'avoid',
    'awake',
    'award',
    'aware',
    'badge',
    'baker',
    'basic',
    'beach',
    'beard',
    'beast',
    'begin',
    'being',
    'below',
    'bench',
    'berry',
    'birth',
    'black',
    'blade',
    'blank',
    'blast',
    'blaze',
    'blend',
    'bless',
    'blind',
    'block',
    'bloom',
    'board',
    'boast',
    'bonus',
    'brain',
    'brave',
    'bread',
    'break',
    'brick',
    'bridge',
    'brief',
    'bring',
    'broad',
    'brown',
    'brush',
    'build',
    'cabin',
    'cable',
    'camel',
    'candy',
    'carry',
    'catch',
    'cause',
    'chain',
    'chair',
    'chalk',
    'charm',
    'chase',
    'cheap',
    'check',
    'cheer',
    'chess',
    'chest',
    'chief',
    'child',
    'chill',
    'chime',
    'choir',
    'chord',
    'claim',
    'class',
    'clean',
    'clear',
    'clerk',
    'click',
    'cliff',
    'climb',
    'clock',
    'close',
    'cloth',
    'cloud',
    'coach',
    'coast',
    'color',
    'coral',
    'couch',
    'count',
    'court',
    'cover',
    'craft',
    'crane',
    'crash',
    'cream',
    'creek',
    'crisp',
    'cross',
    'crowd',
    'crown',
    'curve',
    'cycle',
    'daily',
    'dance',
    'dear',
    'debit',
    'decay',
    'delay',
    'delta',
    'dense',
    'depth',
    'diary',
    'digit',
    'diner',
    'dirty',
    'dodge',
    'doubt',
    'dozen',
    'draft',
    'drain',
    'drama',
    'drawn',
    'dress',
    'drift',
    'drink',
    'drive',
    'eager',
    'eagle',
    'early',
    'earth',
    'eight',
    'elder',
    'elite',
    'empty',
    'enjoy',
    'entry',
    'equal',
    'error',
    'event',
    'every',
    'exact',
    'exist',
    'extra',
    'fable',
    'faith',
    'false',
    'fancy',
    'fatal',
    'fault',
    'favor',
    'feast',
    'fence',
    'field',
    'fifth',
    'fight',
    'final',
    'first',
    'flame',
    'flash',
    'fleet',
    'flesh',
    'float',
    'flood',
    'floor',
    'flour',
    'fluid',
    'focus',
    'force',
    'forest',
    'frame',
    'fresh',
    'front',
    'frost',
    'fruit',
    'giant',
    'given',
    'glass',
    'globe',
    'glory',
    'grace',
    'grade',
    'grain',
    'grand',
    'grant',
    'grass',
    'great',
    'green',
    'greet',
    'group',
    'guard',
    'guess',
    'guest',
    'guide',
    'happy',
    'heart',
    'heavy',
    'hello',
    'honey',
    'horse',
    'hotel',
    'house',
    'human',
    'ideal',
    'image',
    'index',
    'inner',
    'input',
    'issue',
    'jelly',
    'jewel',
    'joint',
    'judge',
    'juice',
    'knock',
    'known',
    'label',
    'large',
    'laser',
    'later',
    'laugh',
    'layer',
    'learn',
    'leave',
    'legal',
    'lemon',
    'level',
    'light',
    'limit',
    'liver',
    'lobby',
    'local',
    'lodge',
    'logic',
    'lucky',
    'lunch',
    'magic',
    'major',
    'maker',
    'maple',
    'match',
    'maybe',
    'mayor',
    'medal',
    'media',
    'merit',
    'metal',
    'might',
    'minor',
    'model',
    'money',
    'month',
    'motor',
    'mount',
    'mouse',
    'movie',
    'music',
    'night',
    'noble',
    'noise',
    'north',
    'novel',
    'nurse',
    'ocean',
    'offer',
    'often',
    'olive',
    'opera',
    'orbit',
    'order',
    'other',
    'outer',
    'owner',
    'paint',
    'panel',
    'paper',
    'party',
    'pasta',
    'patch',
    'pause',
    'peace',
    'peach',
    'pearl',
    'phase',
    'phone',
    'photo',
    'piano',
    'piece',
    'pilot',
    'pitch',
    'place',
    'plain',
    'plane',
    'plant',
    'plate',
    'point',
    'pound',
    'power',
    'press',
    'price',
    'pride',
    'prime',
    'print',
    'prize',
    'proof',
    'proud',
    'queen',
    'quick',
    'quiet',
    'radio',
    'raise',
    'range',
    'rapid',
    'reach',
    'ready',
    'realm',
    'relax',
    'reply',
    'right',
    'rival',
    'river',
    'roast',
    'robot',
    'rocky',
    'round',
    'route',
    'royal',
    'rural',
    'scale',
    'scene',
    'scope',
    'score',
    'sense',
    'serve',
    'seven',
    'shade',
    'shake',
    'shape',
    'share',
    'sharp',
    'sheep',
    'sheet',
    'shelf',
    'shell',
    'shift',
    'shine',
    'shirt',
    'shock',
    'shore',
    'short',
    'sight',
    'skill',
    'slate',
    'sleep',
    'slice',
    'slope',
    'small',
    'smart',
    'smile',
    'smoke',
    'solid',
    'sound',
    'south',
    'space',
    'spare',
    'spark',
    'speak',
    'speed',
    'spell',
    'spend',
    'spice',
    'spine',
    'spite',
    'split',
    'spoke',
    'sport',
    'staff',
    'stage',
    'stake',
    'stand',
    'start',
    'state',
    'steam',
    'steel',
    'stick',
    'still',
    'stock',
    'stone',
    'store',
    'storm',
    'story',
    'stove',
    'study',
    'style',
    'sugar',
    'suite',
    'sweet',
    'swift',
    'table',
    'taste',
    'teach',
    'teeth',
    'thank',
    'theme',
    'there',
    'thick',
    'thing',
    'think',
    'third',
    'those',
    'three',
    'throw',
    'tiger',
    'title',
    'today',
    'topic',
    'total',
    'touch',
    'tough',
    'tower',
    'trace',
    'track',
    'trade',
    'trail',
    'train',
    'treat',
    'trend',
    'trial',
    'tribe',
    'trick',
    'truck',
    'truly',
    'trust',
    'truth',
    'uncle',
    'under',
    'union',
    'unity',
    'until',
    'upper',
    'urban',
    'usage',
    'usual',
    'valid',
    'value',
    'video',
    'vein',
    'voice',
    'voter',
    'water',
    'weary',
    'weave',
    'wheel',
    'where',
    'which',
    'while',
    'white',
    'whole',
    'woman',
    'world',
    'worry',
    'worth',
    'would',
    'write',
    'wrong',
    'yield',
    'young',
    'youth',
    'zebra',
    'zesty',
])

const games = new Map<string, WordChainGame>()
const dictionaryCache = new Map<string, boolean>()
const DICTIONARY_CACHE_MAX = 500
const DICTIONARY_RETRY_MS = 60_000
let dictionaryDownUntil = 0

const clean = (word: string): string => word.toLowerCase().replace(/[^a-z]/g, '')
const keyOf = (chat: string): string => chat

const BASE_MIN_LETTERS = 4
const MAX_MIN_LETTERS = 8

/** Words get one letter longer every few accepted turns, then cap out. */
export function minimumLetters(game: WordChainGame): number {
    return Math.min(MAX_MIN_LETTERS, BASE_MIN_LETTERS + Math.floor(game.accepted / 3))
}

const neededPlayers = (game: WordChainGame): number =>
    // A chain needs at least two humans everywhere, groups and DMs alike.
    game.group ? Math.max(2, config.wordchain.minPlayers) : 2

const playerKey = (jid: string): string => phoneDigitsFor(jid) || jidToNumber(jid) || jid

export const timeLeft = (deadline: number): number =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000))

function clearTimer(game: WordChainGame): void {
    if (game.timer) {
        clearTimeout(game.timer)
        game.timer = undefined
    }
    if (game.countdown) {
        clearInterval(game.countdown)
        game.countdown = undefined
    }
}

// Joining-phase countdown: every 10s until the deadline, remind the group to
// join ("60s / 50s / ... / 10s left"). Only fires while still in the lobby.
function armJoinCountdown(game: WordChainGame): void {
    if (game.countdown) clearInterval(game.countdown)
    let nextMark = Math.floor((game.joinDeadline - Date.now()) / 10_000) * 10_000
    game.countdown = setInterval(() => {
        if (games.get(keyOf(game.chat)) !== game || game.phase !== 'joining') {
            if (game.countdown) clearInterval(game.countdown)
            game.countdown = undefined
            return
        }
        const left = game.joinDeadline - Date.now()
        if (left <= 0) {
            if (game.countdown) clearInterval(game.countdown)
            game.countdown = undefined
            return
        }
        if (Math.abs(left - nextMark) <= 250) {
            nextMark -= 10_000
            const secs = Math.round(left / 1000)
            const names = [...game.players.values()].map((e) => `*${e.name}*`).join(', ')
            void announce(
                game,
                `\u23f3 *${secs}s* left to join the word chain! Type *join* to play.${names ? `\nIn: ${names}` : ''}`,
            )
        }
    }, 500)
    game.countdown.unref?.()
}

export function currentPlayer(game: WordChainGame): WordChainPlayer | undefined {
    const key = game.order[game.turnIndex]
    return key ? game.players.get(key) : undefined
}

function addPlayer(game: WordChainGame, input: { jid: string; name?: string }): WordChainPlayer {
    const key = playerKey(input.jid)
    const existing = game.players.get(key)
    if (existing) {
        if (input.name?.trim()) existing.name = input.name.trim()
        return existing
    }

    const player: WordChainPlayer = {
        key,
        jid: input.jid,
        name: input.name?.trim() || jidToNumber(input.jid) || key,
    }
    game.players.set(key, player)
    return player
}

function armTimer(game: WordChainGame): void {
    clearTimer(game)
    const deadline = game.phase === 'joining' ? game.joinDeadline : game.turnDeadline
    const delay = Math.max(0, deadline - Date.now())
    const timer = setTimeout(() => {
        game.timer = undefined
        void onTimeout(game)
    }, delay)
    timer.unref?.()
    game.timer = timer
}

async function announce(game: WordChainGame, text: string): Promise<void> {
    await game.notify(text).catch(() => undefined)
}

function beginPlaying(game: WordChainGame): void {
    clearTimer(game)

    const first = STARTERS[Math.floor(Math.random() * STARTERS.length)] as string
    game.phase = 'playing'
    game.lastWord = first
    game.used = new Set([first])
    game.startedAt = Date.now()
    game.accepted = 0
    game.order = [...game.players.keys()]
    game.turnIndex = 0
    game.turnDeadline = Date.now() + config.wordchain.turnMs
    armTimer(game)
}

function endGame(game: WordChainGame): void {
    clearTimer(game)
    games.delete(keyOf(game.chat))
}

async function onTimeout(game: WordChainGame): Promise<void> {
    if (games.get(keyOf(game.chat)) !== game) return

    if (game.phase === 'joining') {
        const required = neededPlayers(game)
        if (game.players.size < required) {
            endGame(game)
            await announce(
                game,
                `Word chain cancelled — only *${game.players.size}* player(s) joined. At least *${required}* are needed. 🛑`,
            )
            return
        }

        beginPlaying(game)
        await announce(game, startMessage(game))
        return
    }

    const active = currentPlayer(game)
    if (!active) {
        endGame(game)
        await announce(game, 'Word chain ended because nobody is left to play. 🛑')
        return
    }

    game.players.delete(active.key)
    game.order = game.order.filter((key) => key !== active.key)
    recordGame(active.jid, 'wordchain', 'loss')
    syncSoon()

    const remaining = [...game.players.values()]
    if (remaining.length <= 1) {
        endGame(game)
        const winner = remaining[0]
        let reward = 0
        if (winner) {
            recordGame(winner.jid, 'wordchain', 'win')
            reward = rewardGameWin(winner.jid, 'wordchain')
            syncSoon()
        }
        await announce(
            game,
            winner
                ? `*${active.name}* ran out of time and is disqualified 🛑.\n*${winner.name}* wins the word chain ✅.\n` +
                    (reward > 0 ? `💰 Prize: *${money(reward)}*` : '💤 Daily game cap reached — no prize this time.')
                : `*${active.name}* ran out of time and is disqualified 🛑.\nGame over.`,
        )
        return
    }

    if (game.turnIndex >= game.order.length) game.turnIndex = 0
    game.turnDeadline = Date.now() + config.wordchain.turnMs
    armTimer(game)

    const next = currentPlayer(game)
    await announce(
        game,
        [
            `*${active.name}* ran out of time and is disqualified. 🛑`,
            `Players left : ${remaining.map((player) => `*${player.name}*`).join(', ')}`,
            next
                ? `Next : *${next.name}* — send a word starting with *${game.lastWord.slice(-1).toUpperCase()}* within *${Math.round(config.wordchain.turnMs / 1000)}s*.`
                : '',
        ]
            .filter(Boolean)
            .join('\n'),
    )
}

export function startMessage(game: WordChainGame): string {
    const player = currentPlayer(game)
    return [
        'Word chain started. ✅',
        `First word : *${game.lastWord}*`,
        `Turn : *${player?.name ?? 'unknown'}*`,
        `Send a word starting with *${game.lastWord.slice(-1).toUpperCase()}* within *${Math.round(config.wordchain.turnMs / 1000)}s*.`,
        `Minimum letters : *${minimumLetters(game)}*`,
    ].join('\n')
}

export interface WordChainStartOptions {
    group: boolean
    notify: (text: string) => Promise<unknown>
}

export function currentGame(chat: string): WordChainGame | undefined {
    return games.get(keyOf(chat))
}

export function startGame(
    chat: string,
    starter: { jid: string; name?: string },
    options: WordChainStartOptions,
): WordChainGame {
    const existing = games.get(keyOf(chat))
    if (existing) return existing

    const now = Date.now()
    const game: WordChainGame = {
        chat,
        startedBy: playerKey(starter.jid),
        phase: 'joining',
        lastWord: '',
        used: new Set(),
        startedAt: now,
        players: new Map(),
        order: [],
        turnIndex: 0,
        joinDeadline: now + config.wordchain.joinMs,
        turnDeadline: 0,
        group: options.group,
        accepted: 0,
        notify: options.notify,
    }

    games.set(keyOf(chat), game)

    // Opening a lobby does not join the starter. Players must type `join`;
    // in a direct chat that first join immediately begins the solo game.
    armTimer(game)
    if (game.group) armJoinCountdown(game)

    return game
}

export function joinGame(
    chat: string,
    player: { jid: string; name?: string },
): { ok: boolean; message: string; game?: WordChainGame } {
    const game = games.get(keyOf(chat))
    if (!game) return { ok: false, message: 'No word chain is running here. 🛑' }
    if (game.phase === 'playing') return { ok: false, message: 'The word chain already started. 🛑', game }

    const key = playerKey(player.jid)
    if (game.players.has(key)) return { ok: false, message: 'You already joined. 🛑', game }

    const added = addPlayer(game, player)
    const names = [...game.players.values()].map((entry) => `*${entry.name}*`).join(', ')

    if (!game.group) {
        beginPlaying(game)
        return { ok: true, message: startMessage(game), game }
    }

    return {
        ok: true,
        message: `*${added.name}* joined.\nPlayers (${game.players.size}) : ${names}\nClose in *${timeLeft(game.joinDeadline)}s*. ✅`,
        game,
    }
}

export function forceStart(
    chat: string,
    by: string,
): { ok: boolean; message: string; game?: WordChainGame } {
    const game = games.get(keyOf(chat))
    if (!game) return { ok: false, message: 'No word chain is running here. 🛑' }
    if (game.phase === 'playing') return { ok: false, message: 'The word chain already started. 🛑', game }
    if (playerKey(by) !== game.startedBy) {
        return { ok: false, message: 'Only the player who opened the lobby can start it early. 🛑', game }
    }
    if (game.players.size < neededPlayers(game)) {
        return {
            ok: false,
            message: `At least *${neededPlayers(game)}* players are needed to start. 🛑`,
            game,
        }
    }

    beginPlaying(game)
    return { ok: true, message: startMessage(game), game }
}

export function stopGame(chat: string): boolean {
    const game = games.get(keyOf(chat))
    if (!game) return false
    endGame(game)
    return true
}

export async function playWord(
    chat: string,
    sender: string,
    raw: string,
): Promise<{ handled: boolean; ok: boolean; message: string; game?: WordChainGame }> {
    const game = games.get(keyOf(chat))
    if (!game) return { handled: false, ok: false, message: 'No word chain is running here. 🛑' }
    if (game.phase !== 'playing') return { handled: false, ok: false, message: '' }

    const key = playerKey(sender)
    if (!game.players.has(key)) return { handled: false, ok: false, message: '' }

    const active = currentPlayer(game)
    if (!active) return { handled: true, ok: false, message: 'No active player is left. 🛑' }

    if (active.key !== key) {
        return { handled: true, ok: false, message: `It is *${active.name}*'s turn. 🛑` }
    }

    const word = clean(raw)
    if (word.length < 2) return { handled: true, ok: false, message: 'Send one word with letters only. 🛑' }
    if (game.used.has(word)) return { handled: true, ok: false, message: `*${word}* was already used. 🛑` }

    const required = minimumLetters(game)
    if (word.length < required) {
        return {
            handled: true,
            ok: false,
            message: `Words need at least *${required}* letters now. 🛑`,
        }
    }

    const nextLetter = game.lastWord.slice(-1)
    if (word[0] !== nextLetter) {
        return { handled: true, ok: false, message: `Next word must start with *${nextLetter.toUpperCase()}*. 🛑` }
    }

    if (!(await isRealWord(word))) {
        return { handled: true, ok: false, message: `*${word}* is not a valid English word. 🛑` }
    }

    const previousMinimum = minimumLetters(game)
    game.accepted += 1
    game.used.add(word)
    game.lastWord = word
    game.turnIndex = (game.turnIndex + 1) % game.order.length
    game.turnDeadline = Date.now() + config.wordchain.turnMs
    armTimer(game)

    const next = currentPlayer(game)
    const nextMinimum = minimumLetters(game)
    return {
        handled: true,
        ok: true,
        message: [
            `*${word}* accepted. ✅`,
            `Next letter : *${word.slice(-1).toUpperCase()}*`,
            `Next : *${next?.name ?? 'unknown'}*`,
            `Minimum letters : *${nextMinimum}*${nextMinimum > previousMinimum ? ' (difficulty up) ✅' : ''}`,
            `Time : *${Math.round(config.wordchain.turnMs / 1000)}s*`,
        ].join('\n'),
        game,
    }
}

async function isRealWord(word: string): Promise<boolean> {
    if (LOCAL_WORDS.has(word)) return true
    const cached = dictionaryCache.get(word)
    if (cached !== undefined) return cached

    // When the free dictionary is down, do not make every turn wait for a
    // timeout. Accept moderate alphabetic words until the API is retried.
    if (Date.now() < dictionaryDownUntil) return word.length >= 4

    try {
        const response = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
            { signal: AbortSignal.timeout(3500) },
        )

        // Only a real 404 means "not a word". Cloudflare/rate-limit/5xx
        // responses used to reject valid words such as "nuke" and "november".
        if (response.status === 404) {
            if (dictionaryCache.size >= DICTIONARY_CACHE_MAX) dictionaryCache.clear()
            dictionaryCache.set(word, false)
            return false
        }

        if (response.ok) {
            if (dictionaryCache.size >= DICTIONARY_CACHE_MAX) dictionaryCache.clear()
            dictionaryCache.set(word, true)
            return true
        }

        dictionaryDownUntil = Date.now() + DICTIONARY_RETRY_MS
        return word.length >= 4
    } catch {
        dictionaryDownUntil = Date.now() + DICTIONARY_RETRY_MS
        return word.length >= 4
    }
}

import { ari } from '../../bot/registry.js'
import { arenaGuard } from '../../features/tcg.js'
import { config } from '../../config.js'
import {
    currentGame,
    currentPlayer,
    forceStart,
    joinGame,
    minimumLetters,
    playWord,
    startGame,
    stopGame,
    timeLeft,
    type WordChainGame,
} from '../../features/wordchain.js'

const BASE_MIN_LETTERS = 4

const namesOf = (game: WordChainGame): string =>
    [...game.players.values()].map((player) => `*${player.name}*`).join(', ') || 'nobody yet'

const status = (game: WordChainGame | undefined, prefix: string): string => {
    if (!game) return 'No word chain is running here. 🛑'

    if (game.phase === 'joining') {
        return [
            '*Word chain lobby*',
            `Players (${game.players.size}) : ${namesOf(game)}`,
            'Join : *join*',
            `Closes in : *${timeLeft(game.joinDeadline)}s*`,
            `Need at least *${game.group ? config.wordchain.minPlayers : 1}* player(s).`,
            `${prefix}wcg start begins early.`,
        ].join('\n')
    }

    const player = currentPlayer(game)
    return [
        '*Word chain*',
        `Current word : *${game.lastWord}*`,
        `Next letter : *${game.lastWord.slice(-1).toUpperCase()}*`,
        `Turn : *${player?.name ?? 'unknown'}*`,
        `Time left : *${timeLeft(game.turnDeadline)}s*`,
        `Minimum letters : *${minimumLetters(game)}*`,
        `Players left : ${game.players.size} (${namesOf(game)})`,
        `Words used : ${game.used.size}`,
    ].join('\n')
}

const lobby = (game: WordChainGame, prefix: string): string =>
    [
        'Word chain lobby open. ✅',
        `Players : ${namesOf(game)}`,
        'Join : *join*',
        `Closes in : *${Math.round(config.wordchain.joinMs / 1000)}s*`,
        game.group
            ? `Need at least *${config.wordchain.minPlayers}* players. ${prefix}wcg start begins early.`
            : 'The first player to type *join* starts the game.',
        `Words will start at *${BASE_MIN_LETTERS}* letters and get harder as the game goes on.`,
    ].join('\n')

ari({
    name: 'wcg',
    description: 'Start or play the word chain game',
    category: 'games',
    aliases: ['wordchain'],
    usage: 'wcg | join | wcg start | wcg status | wcg stop | send a word',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await arenaGuard(ctx)) return

        const action = (ctx.args[0] ?? '').toLowerCase()
        const notify = (text: string): Promise<unknown> => ctx.sock.sendMessage(ctx.chat, { text })

        if (!action) {
            const existing = currentGame(ctx.chat)
            if (existing) {
                await ctx.reply(status(existing, ctx.prefix))
                return
            }

            const game = startGame(
                ctx.chat,
                { jid: ctx.sender, name: ctx.senderName },
                { group: ctx.isGroup, notify },
            )

            await ctx.reply(lobby(game, ctx.prefix))
            return
        }

        if (action === 'join' || action === 'j') {
            const result = joinGame(ctx.chat, { jid: ctx.sender, name: ctx.senderName })
            await ctx.reply(result.message)
            return
        }

        if (action === 'start') {
            const result = forceStart(ctx.chat, ctx.sender)
            await ctx.reply(result.message)
            return
        }

        if (action === 'stop' || action === 'end' || action === 'cancel') {
            await ctx.reply(stopGame(ctx.chat) ? 'Word chain stopped. ✅' : 'No word chain is running here. 🛑')
            return
        }

        if (action === 'status' || action === 'info') {
            await ctx.reply(status(currentGame(ctx.chat), ctx.prefix))
            return
        }

        const game = currentGame(ctx.chat)
        if (!game) {
            await ctx.reply('No word chain is running here. 🛑')
            return
        }
        if (game.phase === 'joining') {
            await ctx.reply('The game has not started yet. Type *join*. 🛑')
            return
        }

        const result = await playWord(ctx.chat, ctx.sender, ctx.text)
        await ctx.reply(
            result.handled
                ? result.message
                : `You are not a player in this word chain. Join the next one with *join*. 🛑`,
        )
    },
})

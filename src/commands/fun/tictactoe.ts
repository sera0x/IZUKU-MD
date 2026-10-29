import { jidToNumber } from '../../bot/helpers.js'
import { sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { arenaGuard } from '../../features/tcg.js'
import { syncSoon } from '../../features/cloud.js'
import { recordGame } from '../../features/game-stats.js'
import { money, rewardGameWin } from '../../features/economy.js'
import {
    endGame,
    gameInvolving,
    gameOf,
    move,
    renderBoard,
    renderBoardImage,
    startGame,
    type Game,
} from '../../features/tictactoe.js'

const HINT = 'send *1-9*'

ari({
    name: 'tictactoe',
    description: 'Play tic-tac-toe with someone in this group',
    category: 'games',
    aliases: ['ttt'],
    usage: 'ttt @user | ttt 1-9 | ttt end',
    groupOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        if (await arenaGuard(ctx)) return

        const argument = (ctx.args[0] ?? '').trim().toLowerCase()

        /** The sender's own pushname, otherwise the stored contact name. */
        const nameOf = async (jid: string): Promise<string> => {
            if (sameUser(jid, ctx.sender)) return ctx.senderName
            const stored = await targetName(ctx, jid).catch(() => '')
            return stored || jidToNumber(jid)
        }

        const playerNames = async (game: Game): Promise<{ x: string; o: string }> => {
            const [x, o] = await Promise.all([nameOf(game.players[0]), nameOf(game.players[1])])
            return { x, o }
        }

        const vs = (_g: Game, n: { x: string; o: string }): string => `${n.x} ❌ vs ⭕ ${n.o}`

        const sendBoard = async (game: Game, caption: string, mentions: string[] = []): Promise<void> => {
            // AMOLED-black board image; fall back to the text frame if the
            // renderer ever fails so a game never gets stuck mid-move.
            const image = await renderBoardImage(game).catch(() => null)
            if (image) {
                await ctx.sock.sendMessage(ctx.chat, { image, caption, mentions }, { quoted: ctx.msg })
            } else {
                const text = ['```', renderBoard(game), '```', caption].join('\n')
                await ctx.sock.sendMessage(ctx.chat, { text, mentions }, { quoted: ctx.msg })
            }
            // Mirror the move so a restart does not lose the match.
            syncSoon()
        }

        const game = gameOf(ctx.chat)

        if (argument === 'end' || argument === 'stop' || argument === 'cancel') {
            if (!game) {
                await ctx.reply('There is no game running here. 🛑')
                return
            }
            if (
                !Object.keys(game.marks).some((key) => sameUser(key, ctx.sender)) &&
                !ctx.isAdmin &&
                !ctx.isOwner
            ) {
                await ctx.reply('Only the players or an admin can end the game. 🛑')
                return
            }
            endGame(ctx.chat)
            syncSoon()
            await ctx.reply('Game ended. 🏁')
            return
        }

        const position = Number.parseInt(argument, 10)
        if (Number.isInteger(position) && /^\d$/.test(argument)) {
            const result = move(ctx.chat, ctx.sender, position)
            if (!result.ok) {
                await ctx.reply(result.reason)
                return
            }

            const names = await playerNames(result.game)
            const winner = result.winner
            const opponent = sameUser(result.game.players[0], result.player)
                ? result.game.players[1]
                : result.game.players[0]
            const lastMove = `Last move: ${result.mark} — ${await nameOf(result.player)}`

            if (winner) {
                recordGame(result.player, 'tictactoe', 'win')
                recordGame(opponent, 'tictactoe', 'loss')
                const reward = rewardGameWin(result.player, 'tictactoe')
                await sendBoard(
                    result.game,
                    [
                        `${vs(result.game, names)}`,
                        '',
                        `🏆 ${await nameOf(winner)} wins!`,
                        reward > 0 ? `💰 Prize: *${money(reward)}*` : '💤 Daily game cap reached — no prize this time.',
                        lastMove,
                    ].join('\n'),
                )
                return
            }

            if (result.draw) {
                recordGame(result.game.players[0], 'tictactoe', 'draw')
                recordGame(result.game.players[1], 'tictactoe', 'draw')
                await sendBoard(
                    result.game,
                    [`${vs(result.game, names)}`, '', '🤝 It is a draw.', lastMove].join('\n'),
                    result.game.players,
                )
                return
            }

            await sendBoard(
                result.game,
                [
                    `${vs(result.game, names)}`,
                    lastMove,
                    `Next turn: ${await nameOf(result.game.turn)}`,
                    HINT,
                ].join('\n'),
            )
            return
        }

        if (game) {
            const names = await playerNames(game)
            await sendBoard(
                game,
                [
                    `${vs(game, names)}`,
                    `Next turn: ${await nameOf(game.turn)}`,
                    HINT,
                ].join('\n'),
            )
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(
                `Usage: ${ctx.prefix}ttt @user 🛑\nNumbers on the board are the slots, e.g. *ttt 5*.`,
            )
            return
        }

        const opponent = await normalizeTarget(ctx, raw)
        if (sameUser(opponent, ctx.sender)) {
            await ctx.reply('You cannot play against yourself. 🛑')
            return
        }

        // Only one match per chat, and a player cannot be in two at once.
        const mine = gameInvolving(ctx.sender)
        if (mine) {
            await ctx.reply(`You already have a game running in another chat (*${mine.chat.split('@')[0]}*). 🛑`)
            return
        }

        const theirs = gameInvolving(opponent)
        if (theirs) {
            await ctx.reply(`${await nameOf(opponent)} is already in a game. 🛑`)
            return
        }

        const started = startGame(ctx.chat, ctx.sender, opponent)
        if (!started) {
            await ctx.reply('A game is already running here. 🛑')
            return
        }

        const names = await playerNames(started)
        await sendBoard(
            started,
            [
                `${vs(started, names)}`,
                `${names.x} starts`,
                HINT,
            ].join('\n'),
        )
    },
})

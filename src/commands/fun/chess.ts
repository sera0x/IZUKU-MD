import { phoneDigitsFor, phoneJidFor, sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { syncSoon } from '../../features/cloud.js'
import {
    endGame,
    gameInvolving,
    gameOf,
    playMove,
    renderBoard,
    renderBoardImage,
    startGame,
    type ChessGame,
} from '../../features/chess.js'

const HINT = 'your move: name the piece and the square — `.chess pawn e4`'

const HOW_TO_PLAY = [
    '♟ *How to play chess*',
    '',
    '▸ *Start:* `.chess @user` — the challenger plays white and moves first.',
    '▸ *Move:* say the piece and the square you want it on.',
    '   `.chess pawn e4`  `.chess knight f3`  `.chess bishop b5`',
    '   (horse also works for knight: `.chess horse f3`)',
    '▸ *Two of the same piece can go there?* add where it comes from:',
    '   `.chess knight b1 d2`',
    '▸ *Castle:* `.chess castle` — or `.chess king g1`.',
    '▸ *Promote:* `.chess pawn e8` and it becomes a queen automatically.',
    '▸ *Stop:* `.chess end` (either player, or an admin).',
    '',
    'The board comes back as a picture after every move. You get 5 minutes per turn.',
].join('\n')

ari({
    name: 'chess',
    description: 'Play chess with someone in this group — the board comes back as an image',
    category: 'games',
    aliases: ['cboard'],
    usage: 'chess @user | chess e4 | chess 2 | chess end | chess help',
    groupOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        // Moves are written with spaces (`pawn e4`, `knight b1 d2`), so the whole
        // tail of the message is the argument, not just the first word.
        const argument = ctx.args.join(' ').trim().toLowerCase()

        /** Push name, stored contact name, then phone number. */
        const nameOf = async (jid: string): Promise<string> => {
            if (sameUser(jid, ctx.sender)) return ctx.senderName
            const stored = await targetName(ctx, jid).catch(() => '')
            if (stored) return stored
            const phone = phoneDigitsFor(jid) || (await phoneJidFor(ctx.sock, jid)).split('@')[0] || ''
            if (phone) return `+${phone}`
            const self = ctx.sock?.user
            if (self && (sameUser(self.id, jid) || sameUser(self.lid ?? '', jid))) return 'the bot'
            return 'that user'
        }

        /**
         * `@<digits>` tag for a player. WhatsApp only turns the text into a real
         * tag when the digits match an entry in `mentions`, so the label is the
         * jid's own user part and the client renders the saved contact name.
         */
        const tagOf = (jid: string): string => {
            const digits = jid.split('@')[0]?.split(':')[0] ?? ''
            return /^\d+$/.test(digits) ? `@${digits}` : 'that player'
        }

        const playersLine = (game: ChessGame): string =>
            `♔ ${tagOf(game.players[0])} (white) vs ${tagOf(game.players[1])} (black) ♚`

        /** Mention jids stay in whatever form the chat uses (LID or PN). */
        const mentionJids = (game: ChessGame): string[] => game.players.filter(Boolean)

        /**
         * Board message. Media messages must not carry a context-info card:
         * WhatsApp silently drops an image that also holds an externalAdReply,
         * which is why the board stopped arriving. The picture alone is the
         * board, so the card is not needed here.
         */
        const sendBoard = async (game: ChessGame, caption: string): Promise<void> => {
            const mentions = mentionJids(game)
            const image = await renderBoardImage(game).catch(() => null)
            if (image) {
                await ctx.sock.sendMessage(ctx.chat, { image, caption, mentions }, { quoted: ctx.msg })
            } else {
                const text = ['```', renderBoard(game), '```', caption].join('\n')
                await ctx.sock.sendMessage(ctx.chat, { text, mentions }, { quoted: ctx.msg })
            }
            syncSoon()
        }

        const sitting = gameOf(ctx.chat)

        if (argument === 'help' || argument === 'how' || argument === 'guide' || argument === 'rules') {
            await ctx.reply(HOW_TO_PLAY)
            return
        }

        if (argument === 'end' || argument === 'stop' || argument === 'cancel' || argument === 'resign') {
            if (!sitting) {
                await ctx.reply('There is no chess game running here. 🛑')
                return
            }
            if (!sitting.players.some((player) => sameUser(player, ctx.sender)) && !ctx.isAdmin && !ctx.isOwner) {
                await ctx.reply('Only the players or an admin can end the game. 🛑')
                return
            }
            endGame(ctx.chat)
            syncSoon()
            await ctx.reply('Game ended. 🏁')
            return
        }

        // Anything that is not a keyword or a tag is treated as a move attempt,
        // so a typo gets "not a legal move" instead of a silent board redraw.
        if (sitting && argument && !argument.startsWith('@')) {
            const result = playMove(ctx.chat, ctx.sender, argument)
            if (!result.ok) {
                await ctx.reply(result.reason)
                return
            }

            const game = result.game
            // After applying a move the turn belongs to the opponent, so the
            // mover is the other player.
            const moverTag = tagOf(game.turn === 'w' ? game.players[1] : game.players[0])
            const lines = playersLine(game)

            if (result.checkmate) {
                await sendBoard(game, [lines, '', `♟ ${result.notation}`, `🏆 Checkmate — ${moverTag} wins!`].join('\n'))
                return
            }

            if (result.stalemate) {
                await sendBoard(game, [lines, '', `♟ ${result.notation}`, '🤝 Stalemate — it is a draw.'].join('\n'))
                return
            }

            await sendBoard(
                game,
                [
                    lines,
                    '',
                    `♟ ${result.notation}${result.check ? ' — check!' : ''}`,
                    `Next turn: ${tagOf(game.turn)} (${game.turn === 'w' ? 'white' : 'black'})`,
                    HINT,
                ].join('\n'),
            )
            return
        }

        if (sitting) {
            await sendBoard(
                sitting,
                [
                    playersLine(sitting),
                    '',
                    `Next turn: ${tagOf(sitting.turn)} (${sitting.turn === 'w' ? 'white' : 'black'})`,
                    HINT,
                ].join('\n'),
            )
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(HOW_TO_PLAY)
            return
        }

        const opponent = await normalizeTarget(ctx, raw)
        if (sameUser(opponent, ctx.sender)) {
            await ctx.reply('You cannot play against yourself. 🛑')
            return
        }

        const self = ctx.sock?.user
        if (self && (sameUser(opponent, self.id) || sameUser(opponent, self.lid ?? ''))) {
            await ctx.reply('I can render the board, but I cannot play chess. Tag another person. 🛑')
            return
        }

        const mine = gameInvolving(ctx.sender)
        if (mine) {
            await ctx.reply(`You already have a chess game in another chat (*${mine.chat.split('@')[0]}*). 🛑`)
            return
        }

        const theirs = gameInvolving(opponent)
        if (theirs) {
            await ctx.reply(`${await nameOf(opponent)} is already in a chess game. 🛑`)
            return
        }

        const started = startGame(ctx.chat, ctx.sender, opponent)
        if (!started) {
            await ctx.reply('A chess game is already running here. 🛑')
            return
        }

        await sendBoard(
            started,
            [playersLine(started), '', `${tagOf(started.players[0])} starts — white moves first`, HINT].join('\n'),
        )
    },
})

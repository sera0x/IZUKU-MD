import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { pendingQuiz, startAnimeQuiz } from '../../features/anime-quiz.js'
import { money } from '../../features/economy.js'

ari({
    name: 'animequiz',
    description: 'Timed anime trivia, first correct answer wins',
    category: 'games',
    aliases: ['aquiz', 'aq'],
    usage: 'animequiz',
    cooldownMs: 8000,
    run: async (ctx) => {
        if (ctx.isGroup && !db.gameActive(ctx.chat) && !db.casinoEnabled(ctx.chat)) return
        if (!ctx.isGroup) {
            await ctx.reply('The quiz runs in groups only. 🛑')
            return
        }
        const running = pendingQuiz(ctx.chat)
        if (running) {
            await ctx.reply('a question is already live here, answer it 🛑')
            return
        }
        const started = startAnimeQuiz(ctx.chat, { reply: (c) => ctx.reply(c) })
        if (!started.started || !started.question) {
            await ctx.reply(started.reason ?? '🛑 could not start the quiz.')
            return
        }
        const q = started.question
        await ctx.reply(
            [
                '🧠 *ANIME QUIZ* · 30 seconds',
                '',
                '*' + q.question + '*',
                '',
                'first correct answer typed here wins 💰 *' + money(2000) + '* + ⭐ xp',
            ].join('\n'),
        )
    },
})

ari({
    name: 'quiztop',
    description: 'Anime trivia leaderboard',
    category: 'games',
    aliases: ['aqtop', 'qtop'],
    usage: 'quiztop',
    cooldownMs: 2000,
    run: async (ctx) => {
        const rows = db.quizTop(10)
        if (!rows.length) {
            await ctx.reply('No trivia wins yet. Start one with ' + ctx.prefix + 'aquiz 🧠')
            return
        }
        const lines = rows.map((r, i) => '*' + (i + 1) + '.* ' + (r.name || 'Scholar') + ' — ' + r.wins + ' wins')
        await ctx.reply(['🧠 *ANIME TRIVIA LEADERBOARD*', '', ...lines].join('\n'))
    },
})

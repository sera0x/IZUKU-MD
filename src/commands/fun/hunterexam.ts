import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { answerExam, examCooldownLeft, examProgress, hasLicense, startExam } from '../../features/hunter-exam.js'

ari({
    name: 'exam',
    description: 'Take the Hunter Exam: 3 phases, 45s each, win a permanent license',
    category: 'games',
    aliases: ['hunterexam', 'hexam'],
    usage: 'exam [answer]',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (ctx.isGroup && !db.gameActive(ctx.chat) && !db.casinoEnabled(ctx.chat)) return
        if (!ctx.isGroup) {
            await ctx.reply('The exam runs in groups only. 🛑')
            return
        }
        const arg = ctx.args.join(' ').trim()

        if (!arg) {
            if (examProgress(ctx.chat)) {
                await ctx.reply(examProgress(ctx.chat) as string)
                return
            }
            if (hasLicense(ctx.sender)) {
                await ctx.reply('🏆 u already hold a Hunter License.')
                return
            }
            const left = examCooldownLeft(ctx.sender)
            if (left > 0) {
                await ctx.reply('💀 *Hunter Dropout* cooldown — next attempt in *' + Math.ceil(left / 60_000) + ' min*')
                return
            }
            const start = startExam(ctx.chat, ctx.sender, { reply: (c) => ctx.reply(c) })
            await ctx.reply(start.message)
            return
        }

        const reply = answerExam(ctx.chat, ctx.sender, arg, { reply: (c) => ctx.reply(c) })
        if (reply === undefined) {
            await ctx.reply('🛑 no exam running for u. start one with *' + ctx.prefix + 'exam*')
            return
        }
        await ctx.reply(reply)
    },
})

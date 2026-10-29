import { ari } from '../../bot/registry.js'

ari({
    name: 'poll',
    description: 'Create a WhatsApp poll',
    category: 'tools',
    usage: 'poll question; option 1, option 2',
    run: async (ctx) => {
        const [question, raw] = ctx.text.split(';')
        const options = (raw ?? '')
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean)

        if (!question?.trim() || options.length < 2) {
            await ctx.reply(`Usage: ${ctx.prefix}poll question; option 1, option 2`)
            return
        }

        await ctx.poll(question.trim(), options)
    },
})

import { ari } from '../../bot/registry.js'

ari({
    name: 'pick',
    description: 'Pick one option at random',
    category: 'tools',
    aliases: ['choose'],
    usage: 'pick pizza | rice | noodles',
    run: async (ctx) => {
        const options = ctx.text
            .split(/[|,]/)
            .map((option) => option.trim())
            .filter(Boolean)

        if (options.length < 2) {
            await ctx.reply(`Usage: ${ctx.prefix}pick option 1 | option 2`)
            return
        }

        const choice = options[Math.floor(Math.random() * options.length)]
        await ctx.reply(`${choice} ✅`)
    },
})

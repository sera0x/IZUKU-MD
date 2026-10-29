import { ari } from '../../bot/registry.js'

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T

ari({
    name: 'coinflip',
    description: 'Flip a coin',
    category: 'fun',
    aliases: ['flip'],
    run: async (ctx) => {
        await ctx.reply(`${Math.random() < 0.5 ? 'Heads' : 'Tails'} ✅`)
    },
})

const ANSWERS = [
    'It is certain.',
    'Without a doubt.',
    'Most likely.',
    'Ask again later.',
    'Cannot predict now.',
    'Do not count on it.',
    'My sources say no.',
    'Very doubtful.',
] as const

ari({
    name: '8ball',
    description: 'Ask the magic eight ball a question',
    category: 'fun',
    aliases: ['eightball'],
    usage: '8ball will I win?',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply('Ask me something first. 🛑')
            return
        }
        await ctx.reply(`${pick(ANSWERS)} ✅`)
    },
})

ari({
    name: 'rate',
    description: 'Rate something out of 100',
    category: 'fun',
    usage: 'rate pizza',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply('Give me something to rate. 🛑')
            return
        }
        await ctx.reply(`*${ctx.text.slice(0, 60)}* ${Math.floor(Math.random() * 101)}/100`)
    },
})

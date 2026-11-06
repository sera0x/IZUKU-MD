import { ari } from '../../bot/registry.js'
import { contextInfoOf, jidToNumber } from '../../bot/helpers.js'

const TRUTHS = [
    'What is the last lie you told someone?',
    'Who in this chat do you trust the most?',
    'What is your most embarrassing habit?',
    'Have you ever pretended to be busy to avoid someone?',
    'What is one thing you would change about your past?',
] as const

const DARES = [
    'Send the last photo in your gallery.',
    'Type your name with your eyes closed.',
    'Send a voice note singing one line of any song.',
    'Message the third person in your recent chats "hey".',
    'Change your status to "I lost a dare" for an hour.',
] as const

const QUESTIONS = [
    'What is something you want to learn this year?',
    'What is the best advice you have received?',
    'What would you do with an extra hour every day?',
    'What is a small thing that makes your day better?',
    'What is one habit you want to build?',
] as const

const QUOTES = [
    'Ship it, then fix it.',
    'The best code is the code you did not have to write.',
    'Small steps every day beat big plans every year.',
    'Make it work, make it right, make it fast.',
    'If it is not tested, it is broken.',
] as const

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T

ari({
    name: 'truth',
    description: 'Get a random truth question',
    category: 'fun',
    run: async (ctx) => {
        await ctx.reply(`*Truth:* ${pick(TRUTHS)}`)
    },
})

ari({
    name: 'dare',
    description: 'Get a random dare',
    category: 'fun',
    run: async (ctx) => {
        await ctx.reply(`*Dare:* ${pick(DARES)}`)
    },
})

ari({
    name: 'question',
    description: 'Get a random question',
    category: 'fun',
    run: async (ctx) => {
        await ctx.reply(pick(QUESTIONS))
    },
})

ari({
    name: 'quote',
    description: 'Get a random quote',
    category: 'fun',
    aliases: ['inspire'],
    run: async (ctx) => {
        await ctx.reply(`“${pick(QUOTES)}”`)
    },
})

ari({
    name: 'ship',
    description: 'Ship two people (reply or mention one)',
    category: 'fun',
    usage: 'ship @user',
    run: async (ctx) => {
        const context = contextInfoOf(ctx.msg.message)
        const other = context?.participant ?? context?.mentionedJid?.[0]

        if (!other) {
            await ctx.reply('Reply to someone or mention them to ship them. 🛑')
            return
        }

        const score = Math.floor(Math.random() * 101)
        const bar = '█'.repeat(Math.round(score / 10)).padEnd(10, '░')
        await ctx.reply(
            `*${jidToNumber(ctx.sender)}* + *${jidToNumber(other)}*\n${bar} ${score}%`,
        )
    },
})

import { randomInt } from 'node:crypto'
import { ari } from '../../bot/registry.js'

const LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*_-+=?'

ari({
    name: 'password',
    description: 'Generate a random password',
    category: 'tools',
    aliases: ['passgen'],
    usage: 'password [length]',
    run: async (ctx) => {
        const requested = Number.parseInt(ctx.args[0] ?? '', 10)
        const length = Number.isFinite(requested) ? Math.min(Math.max(requested, 8), 64) : 16
        const alphabet = LETTERS + DIGITS + SYMBOLS

        let password = ''
        for (let index = 0; index < length; index += 1) {
            password += alphabet.charAt(randomInt(alphabet.length))
        }

        await ctx.reply(`\`\`\`\n${password}\n\`\`\` ✅`)
    },
})

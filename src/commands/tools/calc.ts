import { ari } from '../../bot/registry.js'

function evaluate(expression: string): number {
    let index = 0

    const peek = (): string => expression[index] ?? ''
    const skip = (): void => {
        while (/\s/.test(peek())) index += 1
    }

    const number = (): number => {
        skip()
        const start = index
        while (/[\d.]/.test(peek())) index += 1
        const value = Number(expression.slice(start, index))
        if (!Number.isFinite(value)) throw new Error('invalid number')
        return value
    }

    const primary = (): number => {
        skip()
        if (peek() === '(') {
            index += 1
            const value = addition()
            skip()
            if (peek() !== ')') throw new Error('missing )')
            index += 1
            return value
        }
        if (peek() === '-') {
            index += 1
            return -primary()
        }
        if (peek() === '+') {
            index += 1
            return primary()
        }
        return number()
    }

    const power = (): number => {
        let value = primary()
        skip()
        if (expression.startsWith('**', index) || peek() === '^') {
            index += expression.startsWith('**', index) ? 2 : 1
            value **= power()
        }
        return value
    }

    const multiplication = (): number => {
        let value = power()
        for (;;) {
            skip()
            const operator = peek()
            if (!['*', '/', '%'].includes(operator)) return value
            index += 1
            const next = power()
            if (operator === '*') value *= next
            if (operator === '/') value /= next
            if (operator === '%') value %= next
        }
    }

    const addition = (): number => {
        let value = multiplication()
        for (;;) {
            skip()
            const operator = peek()
            if (!['+', '-'].includes(operator)) return value
            index += 1
            const next = multiplication()
            value = operator === '+' ? value + next : value - next
        }
    }

    const result = addition()
    skip()
    if (index !== expression.length) throw new Error('invalid expression')
    return result
}

ari({
    name: 'calc',
    description: 'Evaluate a math expression',
    category: 'tools',
    aliases: ['math'],
    usage: 'calc (12 + 4) * 3',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply(`Usage: ${ctx.prefix}calc (12 + 4) * 3`)
            return
        }

        try {
            const result = evaluate(ctx.text)
            if (!Number.isFinite(result)) throw new Error('result is not finite')
            await ctx.reply(`${ctx.text} = ${result} ✅`)
        } catch {
            await ctx.reply('Invalid expression. 🛑')
        }
    },
})

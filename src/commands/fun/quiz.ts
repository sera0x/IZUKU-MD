import { ari } from '../../bot/registry.js'

interface TriviaQuestion {
    question: string
    correct_answer: string
    incorrect_answers: string[]
}

interface TriviaResponse {
    response_code?: number
    results?: TriviaQuestion[]
}

const decode = (value: string): string => {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

const shuffle = <T>(items: T[]): T[] => {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T]
    }
    return copy
}

ari({
    name: 'quiz',
    description: 'Answer a random trivia question',
    category: 'fun',
    aliases: ['trivia', 'quizme'],
    usage: 'quiz',
    cooldownMs: 5000,
    run: async (ctx) => {
        let data: TriviaResponse

        try {
            const response = await fetch(
                'https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986',
                { signal: AbortSignal.timeout(7000) },
            )
            if (!response.ok) throw new Error(`request failed (${response.status})`)
            data = (await response.json()) as TriviaResponse
        } catch {
            await ctx.reply('Could not fetch a quiz question right now. 🛑')
            return
        }

        const result = data.results?.[0]
        if (!result) {
            await ctx.reply('No quiz question available right now. Try again in a bit. 🛑')
            return
        }

        const question = decode(result.question)
        const answer = decode(result.correct_answer)
        const options = shuffle([answer, ...result.incorrect_answers.map(decode)])

        await ctx.poll(
            `Quiz: ${question.slice(0, 240)}`,
            options.map((option) => option.slice(0, 90)),
            (selection) => {
                const picked = selection.option === answer
                void selection.reply(
                    picked
                        ? `✅ Correct! The answer is *${answer}*.`
                        : `🛑 Wrong — *${selection.option}* is not it. The answer is *${answer}*.`,
                )
            },
        )
    },
})

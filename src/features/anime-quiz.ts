// Anime trivia quiz: one question at a time, 30s timer, first correct typed
// answer wins. Pays ryo, player xp and clan war points. Own leaderboard.
import { randomInt } from 'node:crypto'
import { db } from '../db/index.js'
import { db as dbx } from '../db/index.js'
import { money } from './economy.js'
import { weekKey } from './mine.js'

const WINDOW_MS = 30_000
const WIN_REWARD = 2_000
const WIN_XP = 25
const CLAN_POINTS = 15

export interface QuizQuestion {
    question: string
    answer: string
    hint: string
}

export interface PendingQuiz {
    chat: string
    question: QuizQuestion
    startedAt: number
    timer: NodeJS.Timeout
}

const pending = new Map<string, PendingQuiz>()

export function animeQuizQuestion(): QuizQuestion {
    const BANK: QuizQuestion[] = [
        { question: 'Which Demon Slayer uses Thunder Breathing?', answer: 'zenitsu', hint: 'starts with Z, sleeps to fight' },
        { question: 'What is Luffy\'s devil fruit power?', answer: 'rubber', hint: 'stretch' },
        { question: 'Who is the strongest sorcerer in Jujutsu Kaisen?', answer: 'gojo', hint: 'blindfold' },
        { question: 'What is Tanjiro\'s demon sister called?', answer: 'nezuko', hint: 'N' },
        { question: 'Which titan ate Eren\'s mother?', answer: 'smiling', hint: 'it was grinning' },
        { question: 'What village is Naruto from?', answer: 'leaf', hint: 'hidden in the leaves' },
        { question: 'Who killed Kite in Hunter x Hunter?', answer: 'pitou', hint: 'a royal guard, cat-like' },
        { question: 'What is Light Yagami\'s alias in Death Note?', answer: 'kira', hint: 'killer' },
        { question: 'Who is the Insect Hashira?', answer: 'shinobu', hint: 'butterfly estate' },
        { question: 'What is Ichigo\'s zanpakuto called?', answer: 'zangetsu', hint: 'cutting moon' },
        { question: 'What crew does Zoro join?', answer: 'straw', hint: 'they wear them' },
        { question: 'Who is known as the Copy Ninja?', answer: 'kakashi', hint: 'sharingan eye' },
        { question: 'What is the shinigami who follows Light called?', answer: 'ryuk', hint: 'loves apples' },
    ]
    return BANK[randomInt(BANK.length)] as QuizQuestion
}

export function pendingQuiz(chat: string): PendingQuiz | undefined {
    const quiz = pending.get(chat)
    if (!quiz) return undefined
    if (Date.now() - quiz.startedAt > WINDOW_MS + 5_000) {
        clearTimeout(quiz.timer)
        pending.delete(chat)
        return undefined
    }
    return quiz
}

export interface QuizDeps {
    reply(content: string): Promise<unknown>
}

export function startAnimeQuiz(chat: string, deps: QuizDeps): { started: boolean; question?: QuizQuestion; reason?: string } {
    if (pending.has(chat)) return { started: false, reason: 'a quiz is already running here 🛑' }
    const question = animeQuizQuestion()
    const timer = setTimeout(() => {
        const still = pending.get(chat)
        if (still && still.question.answer === question.answer) {
            pending.delete(chat)
            void deps.reply('⏱️ time! nobody got it\nthe answer was *' + question.answer + '*')
        }
    }, WINDOW_MS)
    pending.set(chat, { chat, question, startedAt: Date.now(), timer })
    return { started: true, question }
}

/** Returns the winning reply text, or undefined when nobody won yet. */
export function answerAnimeQuiz(chat: string, user: string, playerName: string, text: string): string | undefined {
    const quiz = pending.get(chat)
    if (!quiz) return undefined
    const guess = text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')
    const answer = quiz.question.answer.toLowerCase()
    if (!guess || !guess.includes(answer)) return undefined

    clearTimeout(quiz.timer)
    pending.delete(chat)

    dbx.addCoins(user, WIN_REWARD)
    db.addXp(chat, user, WIN_XP)
    const clan = db.clanOf(user)
    let clanLine = ''
    if (clan) {
        db.addClanWarPoints(clan.clan_id, CLAN_POINTS, weekKey())
        clanLine = '\n🛡️ *+' + CLAN_POINTS + ' clan points* for their clan'
    }
    return '🏆 *' + playerName + '* got it first!\n📜 ' + quiz.question.question + '\n✅ answer: *' + quiz.question.answer + '*\n💰 +' + money(WIN_REWARD) + ' · ⭐ +' + WIN_XP + ' xp' + clanLine
}

// Hunter exam: three phases, 45s each, one player per exam per chat.
// Phase 1 trivia, Phase 2 logic, Phase 3 speed. Pass all three for the
// Hunter License: permanent reward payout, player xp and clan war points.
import { db } from '../db/index.js'
import { money } from './economy.js'
import { weekKey } from './mine.js'

const PHASE_MS = 45_000
const LICENSE_REWARD = 10_000
const LICENSE_XP = 100
const CLAN_POINTS = 50
const COOLDOWN_MS = 6 * 60 * 60 * 1000

interface Phase {
    prompt: string
    accept: string[]
    hint: string
}

const PHASES: Phase[][] = [
    [
        { prompt: 'PHASE 1 · TRIVIA — which hunter family can read minds? (one word)', accept: ['kurta'], hint: 'scarlet eyes' },
        { prompt: 'PHASE 1 · TRIVIA — what is theexam island called? (two words)', accept: ['zeki'], hint: 'type zeki to pass' },
    ],
    [
        { prompt: 'PHASE 2 · LOGIC — a bee flies 30m in 10s. meters per second? (number)', accept: ['3'], hint: 'divide' },
        { prompt: 'PHASE 2 · LOGIC — 2, 6, 12, 20, ? (number)', accept: ['30'], hint: 'differences grow by 2' },
        { prompt: 'PHASE 2 · LOGIC — I am heavy forward, light backward. I am?', accept: ['ton'], hint: 'a unit' },
    ],
    [
        { prompt: 'PHASE 3 · SPEED — type the exam oath: i will hunt', accept: ['i will hunt'], hint: 'type it exactly' },
        { prompt: 'PHASE 3 · SPEED — type: license me', accept: ['license me'], hint: 'type it exactly' },
    ],
]

export interface ActiveExam {
    chat: string
    user: string
    startedAt: number
    phaseIndex: number
    round: number
    phaseStartedAt: number
    timer: NodeJS.Timeout
}

const exams = new Map<string, ActiveExam>()

const COOLDOWN_KEY = (jid: string) => 'hunter_exam_cooldown:' + jid
const LICENSE_KEY = (jid: string) => 'hunter_license:' + jid

export function examCooldownLeft(user: string): number {
    const raw = db.settingValue(COOLDOWN_KEY(user))
    if (!raw) return 0
    const until = Number.parseInt(raw, 10)
    return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0
}

export function hasLicense(user: string): boolean {
    return db.settingValue(LICENSE_KEY(user)) === 'licensed'
}

export function activeExam(chat: string): ActiveExam | undefined {
    const exam = exams.get(chat)
    if (!exam) return undefined
    const round = PHASES[exam.round] as Phase[]
    if (Date.now() - exam.startedAt > round.length * PHASE_MS + 10_000) {
        clearTimeout(exam.timer)
        exams.delete(chat)
        return undefined
    }
    return exam
}

function phaseTimeLeft(exam: ActiveExam): number {
    return Math.max(0, PHASE_MS - (Date.now() - exam.phaseStartedAt))
}

function armTimer(exam: ActiveExam, chat: string, deps: { reply(c: string): Promise<unknown> }): void {
    const phase = PHASES[exam.round]?.[exam.phaseIndex] as Phase
    exam.timer = setTimeout(() => {
        const still = exams.get(chat)
        if (!still || still.user !== exam.user) return
        const current = PHASES[still.round]?.[still.phaseIndex] as Phase
        if (current.prompt !== phase.prompt) return
        exams.delete(chat)
        db.setSetting(COOLDOWN_KEY(exam.user), String(Date.now() + COOLDOWN_MS))
        void deps.reply('⏱️ time ran out on phase ' + (still.phaseIndex + 1) + '.\n💀 *Hunter Dropout* — try again later, ' + nameLine(exam.user))
    }, PHASE_MS)
}

function nameLine(user: string): string {
    return db.user(user).name || user.split('@')[0] || 'hunter'
}

export function startExam(chat: string, user: string, deps: { reply(c: string): Promise<unknown> }): { started: boolean; message: string } {
    if (exams.has(chat)) return { started: false, message: 'an exam is already running here 🛑' }
    if (examCooldownLeft(user) > 0) {
        const mins = Math.ceil(examCooldownLeft(user) / 60_000)
        return { started: false, message: '💀 you dropped out recently. next attempt in *' + mins + ' min*' }
    }
    if (hasLicense(user)) {
        return { started: false, message: '🏆 you already hold a Hunter License. proud of u, no retakes' }
    }
    const exam: ActiveExam = { chat, user, startedAt: Date.now(), phaseIndex: 0, round: 0, phaseStartedAt: Date.now(), timer: setTimeout(() => undefined, 0) }
    exams.set(chat, exam)
    armTimer(exam, chat, deps)
    const first = PHASES[0]?.[0] as Phase
    return {
        started: true,
        message: [
            '📋 *HUNTER EXAM* · ' + nameLine(user),
            '',
            '3 phases · 45s each · answer with *' + '.exam <answer>*',
            '',
            first.prompt,
        ].join('\n'),
    }
}

export function answerExam(chat: string, user: string, text: string, deps: { reply(c: string): Promise<unknown> }): string | undefined {
    const exam = exams.get(chat)
    if (!exam || exam.user !== user) return undefined
    const phase = PHASES[exam.round]?.[exam.phaseIndex] as Phase
    const guess = text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')
    if (!guess) return undefined
    const hit = phase.accept.some((ok) => guess === ok || guess.includes(ok))
    if (!hit) {
        const left = Math.ceil(phaseTimeLeft(exam) / 1000)
        return '🛑 wrong. ' + left + 's left'
    }

    clearTimeout(exam.timer)
    const nextIndex = exam.phaseIndex + 1
    const cur = PHASES[exam.round] as Phase[]
    if (nextIndex >= cur.length && exam.round + 1 >= PHASES.length) {
        exams.delete(chat)
        db.setSetting(LICENSE_KEY(user), 'licensed')
        db.setSetting(COOLDOWN_KEY(user), String(Date.now() + COOLDOWN_MS))
        db.addCoins(user, LICENSE_REWARD)
        db.addXp(chat, user, LICENSE_XP)
        const clan = db.clanOf(user)
        let clanLine = ''
        if (clan) {
            db.addClanWarPoints(clan.clan_id, CLAN_POINTS, weekKey())
            clanLine = '\n🛡️ *+' + CLAN_POINTS + ' clan points* for their clan'
        }
        return '🏆 *HUNTER LICENSE GRANTED* 🎉\n' + nameLine(user) + ' passed all phases\n💰 +' + money(LICENSE_REWARD) + ' · ⭐ +' + LICENSE_XP + ' xp\n📄 permanent perks on ur profile' + clanLine
    }
    if (nextIndex >= cur.length) {
        exam.round += 1
        exam.phaseIndex = 0
    } else {
        exam.phaseIndex = nextIndex
    }
    exam.phaseStartedAt = Date.now()
    armTimer(exam, chat, deps)
    const nextPhase = PHASES[exam.round]?.[exam.phaseIndex] as Phase
    return '✅ phase cleared!\n' + nextPhase.prompt
}

export function examProgress(chat: string): string | undefined {
    const exam = exams.get(chat)
    if (!exam) return undefined
    const phase = PHASES[exam.round]?.[exam.phaseIndex] as Phase
    return '📋 exam in progress for *' + nameLine(exam.user) + '*\nphase ' + (exam.phaseIndex + 1) + ' of 3\n' + phase.prompt + '\nhint: ' + phase.hint
}

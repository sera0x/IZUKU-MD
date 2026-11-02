import type { WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'

const log = createLogger(config.logLevel, { scope: 'badwords' })

export interface BadWordInput {
    sock: WASocket
    chat: string
    sender: string
    text: string
    isAdmin: boolean
    isBotAdmin: boolean
    deleteMessage: () => Promise<unknown>
    reply: (text: string) => Promise<unknown>
}

/**
 * Substring match, not a word-boundary one: this is meant to catch the obvious
 * cases ("fuck", "bitch") even when they are glued to punctuation, the same way
 * the antilink matcher works.
 */
export function findBadWord(text: string): string | undefined {
    if (!config.badWords.length) return undefined

    const lowered = text.toLowerCase()
    return config.badWords.find((word) => {
        const needle = word.trim().toLowerCase()
        return needle.length > 1 && lowered.includes(needle)
    })
}

/** Returns true when the message was blocked, so the pipeline stops there. */
export async function enforceBadWords(input: BadWordInput): Promise<boolean> {
    const settings = db.group(input.chat)
    if (!settings.antibadword || input.isAdmin) return false

    const word = findBadWord(input.text)
    if (!word) return false

    await input.deleteMessage().catch(() => undefined)

    const mention = `@${input.sender.split('@')[0]}`
    const total = db.warn(input.sender, input.chat, `Used the blocked word "${word}"`, config.botName)
    await input.reply(`${mention} that word is not allowed here. Warning ${total}/${config.warnLimit}.`)

    if (total >= config.warnLimit && input.isBotAdmin) {
        try {
            await input.sock.groupParticipantsUpdate(input.chat, [input.sender], 'remove')
            db.clearWarnings(input.sender, input.chat)
            await input.reply(`${mention} removed after ${config.warnLimit} warnings.`)
        } catch (error) {
            log.warn('could not remove %s: %s', input.sender, (error as Error).message)
        }
    }

    return true
}

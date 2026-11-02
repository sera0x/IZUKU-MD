import type { WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'

const log = createLogger(config.logLevel, { scope: 'antilink' })

export interface AntilinkInput {
    sock: WASocket
    chat: string
    sender: string
    text: string
    isAdmin: boolean
    isBotAdmin: boolean
    deleteMessage: () => Promise<unknown>
    reply: (text: string) => Promise<unknown>
    groupName: string
}

export async function enforceAntilink(input: AntilinkInput): Promise<boolean> {
    const settings = db.group(input.chat)
    if (!settings.antilink || input.isAdmin) return false

    const lowered = input.text.toLowerCase()
    const match = config.antilink.values.find((value) => lowered.includes(value.toLowerCase()))
    if (!match) return false

    await input.deleteMessage().catch(() => undefined)

    if (config.antilink.action === 'warn') {
        const total = db.warn(input.sender, input.chat, `Posted a ${match} link`, config.botName)
        await input.reply(`@${input.sender.split('@')[0]} links are not allowed here. Warning ${total}/${config.warnLimit}.`)
        if (total >= config.warnLimit && input.isBotAdmin) {
            await input.sock.groupParticipantsUpdate(input.chat, [input.sender], 'remove').catch(() => undefined)
            db.clearWarnings(input.sender, input.chat)
            await input.reply(`Removed @${input.sender.split('@')[0]} after ${config.warnLimit} warnings.`)
        }
        return true
    }

    if (!input.isBotAdmin) {
        await input.reply('Link detected. Make me an admin so I can remove it.')
        return true
    }

    try {
        await input.sock.groupParticipantsUpdate(input.chat, [input.sender], 'remove')
        await input.reply(`@${input.sender.split('@')[0]} removed for posting a link in *${input.groupName}*.`)
    } catch (error) {
        log.warn('could not remove %s: %s', input.sender, (error as Error).message)
    }

    return true
}

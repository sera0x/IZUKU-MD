import { db } from '../db/index.js'
import { jidToNumber } from '../bot/helpers.js'

const duration = (ms: number): string => {
    const minutes = Math.floor(ms / 60_000)
    if (minutes < 1) return 'less than a minute'
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
    return `${Math.floor(hours / 24)} day(s)`
}

export async function clearAfkOnActivity(sender: string, reply: (text: string) => Promise<unknown>): Promise<void> {
    const user = db.user(sender)
    if (!user.afk_since) return

    const away = duration(Date.now() - user.afk_since)
    db.clearAfk(sender)
    await reply(`Welcome back. You were away for ${away}.`)
}

export async function notifyAfkMentions(
    mentioned: string[],
    sender: string,
    reply: (text: string) => Promise<unknown>,
): Promise<boolean> {
    let notified = false

    for (const jid of mentioned) {
        if (jid === sender) continue
        const user = db.user(jid)
        if (!user.afk_since) continue

        notified = true
        const reason = user.afk_reason?.trim() || 'no reason given'
        await reply(`@${jidToNumber(jid)} is away since ${duration(Date.now() - user.afk_since)} — ${reason}.`)
    }

    return notified
}

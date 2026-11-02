import type { WAMessage, WASocket } from 'baileys'

export interface PromptInput {
    sock: WASocket
    msg: WAMessage
    chat: string
    sender: string
    text: string
    reply(content: string, mentions?: string[]): Promise<unknown>
}

export type PromptHandler = (input: PromptInput) => Promise<void> | void

interface PendingPrompt {
    handler: PromptHandler
    expires: number
}

const TTL = 5 * 60 * 1000
const pending = new Map<string, PendingPrompt>()

const keyOf = (chat: string, sender: string): string => `${chat}|${sender}`

function clean(): void {
    const now = Date.now()
    for (const [key, value] of pending) {
        if (value.expires < now) pending.delete(key)
    }
}

export function setPrompt(chat: string, sender: string, handler: PromptHandler): void {
    clean()
    pending.set(keyOf(chat, sender), { handler, expires: Date.now() + TTL })
}

export function clearPrompt(chat: string, sender: string): void {
    pending.delete(keyOf(chat, sender))
}

export function hasPrompt(chat: string, sender: string): boolean {
    clean()
    return pending.has(keyOf(chat, sender))
}

export async function handlePrompt(input: PromptInput): Promise<boolean> {
    clean()
    const key = keyOf(input.chat, input.sender)
    const entry = pending.get(key)
    if (!entry) return false

    pending.delete(key)
    try {
        await entry.handler(input)
    } catch (error) {
        await input.reply(`Prompt failed: ${error instanceof Error ? error.message : String(error)} 🛑`)
    }
    return true
}

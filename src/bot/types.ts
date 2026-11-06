import type { GroupMetadata, WASocket, WAMessage } from 'baileys'

export type Category = 'general' | 'group' | 'owner' | 'tools' | 'fun' | 'games' | 'media' | 'afk'

export interface CommandContext {

    readonly sock: WASocket

    readonly msg: WAMessage
    readonly chat: string
    readonly sender: string
    readonly senderName: string
    readonly isGroup: boolean
    readonly isOwner: boolean
    readonly isSudo: boolean
    readonly isMod: boolean
    readonly isAdmin: boolean
    readonly isBotAdmin: boolean

    readonly text: string
    readonly args: string[]

    readonly body: string
    readonly prefix: string

    readonly groupMetadata: () => Promise<GroupMetadata | undefined>
    reply(content: string, mentions?: string[]): Promise<unknown>
    replyImage(url: string, caption?: string): Promise<unknown>
    replyImageBuffer(buffer: Buffer, caption?: string): Promise<unknown>
    react(emoji: string): Promise<unknown>
    poll(question: string, options: string[], onSelect?: PollHandler): Promise<unknown>
    downloadQuoted(): Promise<{ buffer: Buffer; mimetype: string } | null>
    command: Command
}

export interface PollSelection {
    sock: WASocket
    chat: string
    sender: string
    msg: WAMessage
    option: string
    reply(content: string, mentions?: string[]): Promise<unknown>
}

export type PollHandler = (selection: PollSelection) => Promise<void> | void

export interface Command {
    name: string
    description: string
    category: Category
    aliases: string[]
    usage: string
    ownerOnly: boolean
    groupOnly: boolean
    adminOnly: boolean
    botAdmin: boolean
    hidden: boolean
    modOk: boolean

    cooldownMs?: number
    run: (ctx: CommandContext) => Promise<void> | void
}

export type CommandInput = Partial<Omit<Command, 'name' | 'run'>> & Pick<Command, 'name' | 'run'>

export interface OutgoingMessage {
    text?: string
    image?: { url: string }
    caption?: string
    quoted?: WAMessage
    react?: { text: string; key: WAMessage['key'] }
}

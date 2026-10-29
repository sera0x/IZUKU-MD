import type { proto } from 'baileys'
import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { createLogger } from '../../logger.js'
import {
    downloadMedia,
    extractText,
    quotedContext,
    unwrapMessage,
} from '../../bot/helpers.js'
import { findStoredMessage } from '../../features/message-store.js'

const log = createLogger(config.logLevel, { scope: 'save' })

const HINT = 'Reply to a message or a status with this command and I will forward it to your chat. 🛑'

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

const mediaTypeOf = (content: proto.IMessage): MediaType | null => {
    if (content.imageMessage) return 'image'
    if (content.videoMessage) return 'video'
    if (content.audioMessage) return 'audio'
    if (content.stickerMessage) return 'sticker'
    if (content.documentMessage) return 'document'
    return null
}

const extensionFor = (mimetype: string): string => {
    if (mimetype.includes('jpeg')) return 'jpg'
    if (mimetype.includes('png')) return 'png'
    if (mimetype.includes('webp')) return 'webp'
    if (mimetype.includes('gif')) return 'gif'
    if (mimetype.includes('mp4')) return 'mp4'
    if (mimetype.includes('ogg')) return 'ogg'
    if (mimetype.includes('mpeg')) return 'mp3'
    if (mimetype.includes('pdf')) return 'pdf'
    return 'bin'
}

ari({
    name: 'save',
    description: 'Forward the message or status you reply to into your own chat',
    category: 'tools',
    usage: 'save (reply to a status, text, image, video, audio, sticker or document)',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (!ctx.isSudo) {
            await ctx.reply('This command is owner-only. 🛑')
            return
        }

        const context = quotedContext(ctx.msg.message)
        // A status reply often only points at the status; the content itself is
        // the status message the bot already cached while it arrived.
        const statusMention = (context as { statusMentionMessageInfo?: unknown } | undefined)
            ?.statusMentionMessageInfo
        const statusReply = context?.remoteJid === 'status@broadcast' || Boolean(statusMention)
        const stored = context?.stanzaId ? findStoredMessage(context.stanzaId) : undefined

        const content =
            unwrapMessage(statusReply ? stored?.message : undefined) ??
            unwrapMessage(context?.quotedMessage) ??
            unwrapMessage(stored?.message)

        if (!content) {
            log.debug('save: nothing quotable in %s', JSON.stringify(Object.keys(ctx.msg.message ?? {})))
            await ctx.reply(
                statusReply
                    ? 'I could not find that status — I can only save statuses the bot received in the last 15 minutes. 🛑'
                    : HINT,
            )
            return
        }

        const type = mediaTypeOf(content)
        if (type) {
            const file = await downloadMedia(content, type).catch(() => null)
            if (!file) {
                await ctx.reply('Could not download that media 🛑')
                return
            }

            const caption = extractText(content)
            const payload =
                type === 'image'
                    ? { image: file.buffer, caption }
                    : type === 'video'
                      ? { video: file.buffer, caption, mimetype: file.mimetype }
                      : type === 'audio'
                        ? { audio: file.buffer, mimetype: file.mimetype }
                        : type === 'sticker'
                          ? { sticker: file.buffer }
                          : {
                                document: file.buffer,
                                mimetype: file.mimetype,
                                fileName: `saved.${extensionFor(file.mimetype)}`,
                            }

            await ctx.sock.sendMessage(ctx.sender, payload)
            await ctx.react('✅')
            return
        }

        const text = extractText(content).trim()
        if (!text) {
            await ctx.reply(HINT)
            return
        }

        await ctx.sock.sendMessage(ctx.sender, { text })
        await ctx.react('✅')
    },
})

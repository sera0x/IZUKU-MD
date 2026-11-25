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

        const statusMention = (context as { statusMentionMessageInfo?: unknown } | undefined)
            ?.statusMentionMessageInfo
        const statusReply = context?.remoteJid === 'status@broadcast' || Boolean(statusMention)
        const stored = context?.stanzaId ? findStoredMessage(context.stanzaId) : undefined

        const candidates = [
            unwrapMessage(statusReply ? stored?.message : undefined),
            unwrapMessage(context?.quotedMessage),
            unwrapMessage(stored?.message),
        ].filter((entry): entry is proto.IMessage => Boolean(entry))
        const content = candidates[0]

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
            let file: { buffer: Buffer; mimetype: string } | null = null
            let media = content
            for (const candidate of candidates) {
                const candidateType = mediaTypeOf(candidate)
                if (!candidateType) continue
                file = await downloadMedia(candidate, candidateType).catch(() => null)
                if (file) {
                    media = candidate
                    break
                }
            }
            if (!file) {
                await ctx.reply('Could not download that media — try replying again right after it arrives 🛑')
                return
            }

            const caption = extractText(media)
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

            await ctx.sock
                .sendMessage(ctx.sender, payload)
                .catch(() => ctx.sock.sendMessage(ctx.chat, payload, { quoted: ctx.msg }))
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

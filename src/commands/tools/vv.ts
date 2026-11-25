import type { proto } from 'baileys'
import { ari } from '../../bot/registry.js'
import { downloadMedia, quotedContext, unwrapMessage } from '../../bot/helpers.js'
import { findStoredMessage } from '../../features/message-store.js'
import type { CommandContext } from '../../bot/types.js'

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

const mediaTypeOf = (content: proto.IMessage): { type: MediaType; mimetype: string } | null => {
    if (content.imageMessage) return { type: 'image', mimetype: content.imageMessage.mimetype ?? 'image/jpeg' }
    if (content.videoMessage) return { type: 'video', mimetype: content.videoMessage.mimetype ?? 'video/mp4' }
    if (content.audioMessage) return { type: 'audio', mimetype: content.audioMessage.mimetype ?? 'audio/mp4' }
    if (content.stickerMessage) return { type: 'sticker', mimetype: content.stickerMessage.mimetype ?? 'image/webp' }
    if (content.documentMessage) {
        return { type: 'document', mimetype: content.documentMessage.mimetype ?? 'application/octet-stream' }
    }
    return null
}

async function sendRevealed(ctx: CommandContext, buffer: Buffer, mimetype: string): Promise<void> {
    if (mimetype.startsWith('image/')) {
        await ctx.sock.sendMessage(ctx.chat, { image: buffer }, { quoted: ctx.msg })
        return
    }
    if (mimetype.startsWith('video/')) {
        await ctx.sock.sendMessage(ctx.chat, { video: buffer, mimetype }, { quoted: ctx.msg })
        return
    }
    if (mimetype.startsWith('audio/')) {
        await ctx.sock.sendMessage(ctx.chat, { audio: buffer, mimetype }, { quoted: ctx.msg })
        return
    }
    await ctx.sock.sendMessage(
        ctx.chat,
        { document: buffer, mimetype, fileName: 'view-once' },
        { quoted: ctx.msg },
    )
}

ari({
    name: 'vv',
    description: 'Reveal a view-once image, video or audio message',
    category: 'tools',
    aliases: ['viewonce'],
    cooldownMs: 5000,
    run: async (ctx) => {
        const context = quotedContext(ctx.msg.message)
        const stored = context?.stanzaId ? findStoredMessage(context.stanzaId) : undefined

        const sources = [context?.quotedMessage, stored?.message]
        for (const source of sources) {
            const content = unwrapMessage(source)
            if (!content) continue
            const media = mediaTypeOf(content)
            if (!media) continue

            const file = await downloadMedia(content, media.type).catch(() => null)
            if (!file) continue

            await sendRevealed(ctx, file.buffer, file.mimetype || media.mimetype)
            return
        }

        const media = await ctx.downloadQuoted().catch(() => null)
        if (media) {
            await sendRevealed(ctx, media.buffer, media.mimetype)
            return
        }

        await ctx.reply('Reply to a view-once message. 🛑')
    },
})

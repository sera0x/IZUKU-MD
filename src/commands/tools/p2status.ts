import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { jidToNumber } from '../../bot/helpers.js'

const STATUS_JID = 'status@broadcast'

/**
 * WhatsApp only delivers a status to the recipients passed as its audience; a
 * status posted without one is dropped by the server. Everyone the bot knows,
 * plus every owner/sudo number, makes up that audience.
 */
async function statusAudience(sock: any): Promise<string[]> {
    const known = db.contactJids(1000)

    // Contacts the session stores as @lid have no phone jid; resolve them so the
    // status actually reaches those people too.
    for (const lid of db.contactLids(200)) {
        const mapped = await sock?.signalRepository?.lidMapping
            ?.getPNForLID(lid)
            .catch(() => null)
        if (typeof mapped === 'string' && mapped) known.push(jidNormalizedPhone(mapped))
    }

    const owners = [...config.owners, ...config.sudo]
        .filter((number) => number)
        .map((number) => `${number}@s.whatsapp.net`)
    const self = jidToNumber(sock?.user?.id ?? '')
    if (self) known.push(`${self}@s.whatsapp.net`)
    return [...new Set([...known, ...owners])].filter((jid) => jid.includes('@s.whatsapp.net'))
}

const jidNormalizedPhone = (jid: string): string => {
    const number = jidToNumber(jid)
    return number ? `${number}@s.whatsapp.net` : ''
}

const KIND = (mimetype: string): 'image' | 'video' | 'audio' | 'document' => {
    if (mimetype.startsWith('image/')) return 'image'
    if (mimetype.startsWith('video/')) return 'video'
    if (mimetype.startsWith('audio/')) return 'audio'
    return 'document'
}

const EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
}

ari({
    name: 'p2status',
    description: 'Post what you quote (image, video, audio or text) to your status',
    category: 'tools',
    aliases: ['poststatus', 'mystatus'],
    usage: 'p2status [caption] — reply to an image, video, audio or a text message',
    ownerOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const caption = ctx.args.join(' ').trim()
        const quotedText = (ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage as any)?.conversation
        const media = await ctx.downloadQuoted()

        const audience = (await statusAudience(ctx.sock)).filter(Boolean)
        if (!audience.length) {
            await ctx.reply('🛑 No status audience yet — the bot has not seen any contacts.')
            return
        }

        const sent = (): string =>
            [
                '✅ *Posted to status*',
                '',
                caption ? `▸ Caption: ${caption}` : '',
                `▸ Audience: *${audience.length}* contact(s)`,
                '▸ If it does not show up, the number may have no status privacy set for these contacts.',
            ]
                .filter(Boolean)
                .join('\n')

        const publish = async (payload: any): Promise<boolean> => {
            try {
                await ctx.sock.sendMessage(STATUS_JID, payload, {
                    backgroundColor: '#0f172a',
                    font: 1,
                    statusJidList: audience,
                } as any)
                return true
            } catch (error) {
                await ctx.react('🛑')
                await ctx.reply(`🛑 Posting failed: ${(error as Error).message}`)
                return false
            }
        }

        if (media) {
            const kind = KIND(media.mimetype)
            const fileName = `status.${EXT[media.mimetype] ?? 'bin'}`
            const payload =
                kind === 'image'
                    ? { image: media.buffer, caption }
                    : kind === 'video'
                      ? { video: media.buffer, caption, mimetype: media.mimetype }
                      : kind === 'audio'
                        ? { audio: media.buffer, mimetype: media.mimetype, ptt: media.mimetype.includes('ogg') }
                        : { document: media.buffer, mimetype: media.mimetype, fileName, caption }

            if (!(await publish(payload))) return
            await ctx.react('✅')
            await ctx.reply(sent())
            return
        }

        const text = caption || (quotedText ?? '').trim()
        if (!text) {
            await ctx.reply(
                [
                    '🛑 *Nothing to post*',
                    '',
                    `▸ Reply to an image, video, audio or text message`,
                    `▸ Or type *${config.prefix}p2status <text>*`,
                ].join('\n'),
            )
            return
        }

        if (!(await publish({ text }))) return
        await ctx.react('✅')
        await ctx.reply(sent())
    },
})

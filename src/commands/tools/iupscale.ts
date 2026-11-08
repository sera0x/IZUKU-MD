import { ari } from '../../bot/registry.js'
import { convert } from '../../bot/helpers.js'

const MAX_INPUT_BYTES = 25 * 1024 * 1024
const MAX_SIDE = 4096

const extensionFor = (mimetype: string): string => {
    if (mimetype.includes('png')) return 'png'
    if (mimetype.includes('webp')) return 'webp'
    if (mimetype.includes('gif')) return 'gif'
    return 'jpg'
}

ari({
    name: 'iupscale',
    description: 'Enlarge an image 2x or 4x with sharpening',
    category: 'tools',
    aliases: ['upscale', 'hd'],
    usage: 'iupscale [2|4] — reply to an image',
    cooldownMs: 5000,
    run: async (ctx) => {
        const factor = ctx.args[0] === '4' ? 4 : 2
        const media = await ctx.downloadQuoted()
        if (!media || !media.mimetype.startsWith('image/')) {
            await ctx.reply('Reply to an image with ' + ctx.prefix + 'iupscale [2|4] 🛑')
            return
        }
        if (media.buffer.byteLength > MAX_INPUT_BYTES) {
            await ctx.reply('That image is too large to upscale. 🛑')
            return
        }

        await ctx.react('⏳')
        try {

            const out = await convert(media.buffer, extensionFor(media.mimetype), 'png', [
                '-vf',
                `scale=min(iw*${factor}\\,${MAX_SIDE}):-2:flags=lanczos,unsharp=5:5:0.6:5:5:0`,
            ])
            await ctx.sock.sendMessage(
                ctx.chat,
                { image: out, caption: `🖼️ *Upscaled ${factor}x*` },
                { quoted: ctx.msg },
            )
            await ctx.react('✅')
        } catch (error) {
            await ctx.react('🛑')
            await ctx.reply(`Upscale failed: ${(error as Error).message} 🛑`)
        }
    },
})

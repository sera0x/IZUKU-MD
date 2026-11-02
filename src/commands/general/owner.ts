import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'

ari({
    name: 'owner',
    description: 'Show the bot owner contact',
    category: 'general',
    aliases: ['creator', 'contact'],
    run: async (ctx) => {
        const number = config.anchorNumber || config.owners[0]
        if (!number) {
            await ctx.reply('Owner number is not configured. 🛑')
            return
        }

        const vcard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${config.ownerName}`,
            `TEL;type=CELL;type=VOICE;waid=${number}:+${number}`,
            'END:VCARD',
        ].join('\n')

        await ctx.sock.sendMessage(
            ctx.chat,
            { contacts: { displayName: config.ownerName, contacts: [{ vcard }] } },
            { quoted: ctx.msg },
        )
    },
})

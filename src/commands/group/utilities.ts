import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'

ari({
    name: 'tagall',
    description: 'Mention every member in the group',
    category: 'group',
    usage: 'tagall your message',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const metadata = await ctx.groupMetadata()
        if (!metadata) {
            await ctx.reply('Could not read this group right now. 🛑')
            return
        }

        const mentions = metadata.participants.map((participant) => participant.id)
        const header = ctx.text || 'Attention everyone'
        const body = mentions.map((jid) => `• @${jidToNumber(jid)}`).join('\n')

        await ctx.sock.sendMessage(
            ctx.chat,
            { text: `*${header}*\n\n${body}`, mentions },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'ginfo',
    description: 'Show group information',
    category: 'group',
    aliases: ['groupinfo'],
    groupOnly: true,
    run: async (ctx) => {
        const metadata = await ctx.groupMetadata()
        if (!metadata) {
            await ctx.reply('Could not read this group right now. 🛑')
            return
        }

        const admins = metadata.participants.filter((participant) => participant.admin).length
        const created = metadata.creation
            ? new Date(metadata.creation * 1000).toLocaleDateString('en-GB')
            : 'unknown'
        const description = metadata.desc?.trim()
        const shortDescription = description && description.length > 300 ? `${description.slice(0, 300)}...` : description

        await ctx.reply(
            [
                '╭─ *Group*',
                `│ Name : ${metadata.subject}`,
                `│ Members : ${metadata.participants.length}`,
                `│ Admins : ${admins}`,
                `│ Created : ${created}`,
                `│ Locked : ${metadata.announce ? 'yes' : 'no'}`,
                shortDescription ? `│ About : ${shortDescription}` : '',
                '╰─',
            ]
                .filter(Boolean)
                .join('\n'),
        )
    },
})

ari({
    name: 'link',
    description: 'Get the group invite link',
    category: 'group',
    aliases: ['invite'],
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const code = await ctx.sock.groupInviteCode(ctx.chat)
        if (!code) {
            await ctx.reply('Could not create an invite link. 🛑')
            return
        }
        await ctx.reply(`https://chat.whatsapp.com/${code}`)
    },
})

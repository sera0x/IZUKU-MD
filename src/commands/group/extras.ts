import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'

ari({
    name: 'admins',
    description: 'List the group admins',
    category: 'group',
    aliases: ['gadmins', 'adminlist'],
    groupOnly: true,
    run: async (ctx) => {
        const metadata = await ctx.groupMetadata()
        if (!metadata) {
            await ctx.reply('Could not read this group right now. 🛑')
            return
        }

        const admins = metadata.participants.filter((participant) => participant.admin)
        if (!admins.length) {
            await ctx.reply('This group has no admins listed. 🛑')
            return
        }

        const body = admins
            .map((participant) => {
                const role = participant.admin === 'superadmin' ? 'owner' : 'admin'
                return `│ ${role === 'owner' ? '👑' : '🛡️'} @${jidToNumber(participant.id)}`
            })
            .join('\n')

        await ctx.sock.sendMessage(
            ctx.chat,
            {
                text: `╭─ *Admins* (${admins.length})\n${body}\n╰─`,
                mentions: admins.map((participant) => participant.id),
            },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'tagadmin',
    description: 'Mention every admin in the group',
    category: 'group',
    aliases: ['admincall'],
    usage: 'tagadmin meeting in 5 minutes',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const metadata = await ctx.groupMetadata()
        if (!metadata) {
            await ctx.reply('Could not read this group right now. 🛑')
            return
        }

        const admins = metadata.participants.filter((participant) => participant.admin)
        if (!admins.length) {
            await ctx.reply('This group has no admins listed. 🛑')
            return
        }

        const header = ctx.text || 'Admins, your attention please'
        const mentions = admins.map((participant) => participant.id)
        const body = admins.map((participant) => `• @${jidToNumber(participant.id)}`).join('\n')

        await ctx.sock.sendMessage(
            ctx.chat,
            { text: `*${header}*\n\n${body}`, mentions },
            { quoted: ctx.msg },
        )
    },
})

ari({
    name: 'resetlink',
    description: 'Revoke the group invite link and create a new one',
    category: 'group',
    aliases: ['revokelink', 'newlink'],
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        const code = await ctx.sock.groupRevokeInvite(ctx.chat).catch(() => null)
        if (!code) {
            await ctx.reply('Could not reset the invite link. Make sure I am an admin. 🛑')
            return
        }

        await ctx.reply(
            ['Old invite link revoked ✅', `New link: https://chat.whatsapp.com/${code}`].join('\n'),
        )
    },
})

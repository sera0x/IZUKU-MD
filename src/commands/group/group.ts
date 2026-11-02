import { jidNormalizedUser } from 'baileys'
import { ari } from '../../bot/registry.js'
import { contextInfoOf, jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget } from '../../bot/group-utils.js'
import type { CommandContext } from '../../bot/types.js'

const label = (jid: string): string => `@${jidToNumber(jid)}`

const afterAction = (text: string, action: string): string => {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.replace(new RegExp(`^${escaped}\\s*`, 'i'), '').trim()
}

const requireGroup = async (ctx: CommandContext): Promise<boolean> => {
    if (ctx.isGroup) return true
    await ctx.reply('This action only works in groups. 🛑')
    return false
}

const requireAdmin = async (ctx: CommandContext): Promise<boolean> => {
    if (ctx.isAdmin || ctx.isOwner) return true
    await ctx.reply('Admins only. 🛑')
    return false
}

const requireBotAdmin = async (ctx: CommandContext): Promise<boolean> => {
    if (ctx.isBotAdmin || ctx.isOwner) return true
    await ctx.reply('I need to be an admin to do that. 🛑')
    return false
}

ari({
    name: 'group',
    description: 'Create and manage groups',
    category: 'group',
    aliases: ['groups'],
    usage: 'group create <name> @user | add | kick | promote | demote | link | revoke | subject/rename | desc | open | close | leave | info',
    run: async (ctx) => {
        const action = (ctx.args[0] ?? 'info').toLowerCase()
        const rest = afterAction(ctx.text, action)

        if (action === 'create' || action === 'new') {
            if (!ctx.isOwner) {
                await ctx.reply('Only the owner can create groups. 🛑')
                return
            }

            const quoted = resolveTarget(ctx)
            const targetDigits = quoted ? jidToNumber(quoted) : ''
            let name = rest
                .replace(/@\d+/g, '')
                .replace(/\b\d{7,15}\b/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            if (targetDigits) {
                name = name.replace(new RegExp(`\\b\\+?${targetDigits}\\b`, 'g'), '').replace(/\s+/g, ' ').trim()
            }
            if (!name) {
                await ctx.reply('Give the new group a name. Example: .group create My Group @2348012345678 🛑')
                return
            }

            const self = jidNormalizedUser(ctx.sock.user?.id ?? '')
            const rawParticipants = [
                ...new Set([
                    ...(contextInfoOf(ctx.msg.message)?.mentionedJid ?? []),
                    ...(quoted ? [quoted] : []),
                ]),
            ]
            const participants = [
                ...new Set(await Promise.all(rawParticipants.map((jid) => normalizeTarget(ctx, jid)))),
            ].filter((jid) => jid && !(self && jidNormalizedUser(jid) === self))

            if (!participants.length) {
                await ctx.reply('Mention at least one person to add to the new group. 🛑')
                return
            }

            const group = await ctx.sock.groupCreate(name, participants)
            const code = await ctx.sock.groupInviteCode(group.id).catch(() => undefined)
            await ctx.reply(
                [
                    `Group *${group.subject || name}* created. ✅`,
                    code ? `https://chat.whatsapp.com/${code}` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
            await ctx.sock
                .sendMessage(group.id, {
                    text: `*${group.subject || name}* is live. say hi 👋`,
                    mentions: participants,
                })
                .catch(() => undefined)
            return
        }

        if (action === 'link' || action === 'invite') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            const code = await ctx.sock.groupInviteCode(ctx.chat)
            await ctx.reply(code ? `https://chat.whatsapp.com/${code}` : 'Could not create an invite link. 🛑')
            return
        }

        if (action === 'revoke') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            const code = await ctx.sock.groupRevokeInvite(ctx.chat)
            await ctx.reply(code ? `Invite link reset. ✅\nhttps://chat.whatsapp.com/${code}` : 'Could not reset the link. 🛑')
            return
        }

        if (action === 'subject' || action === 'name' || action === 'rename') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            if (!rest) {
                await ctx.reply('Give me the new group name. 🛑')
                return
            }
            await ctx.sock.groupUpdateSubject(ctx.chat, rest)
            await ctx.reply('Group name updated. ✅')
            return
        }

        if (action === 'desc' || action === 'description' || action === 'about') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            await ctx.sock.groupUpdateDescription(ctx.chat, rest)
            await ctx.reply(rest ? 'Group description updated. ✅' : 'Group description cleared. ✅')
            return
        }

        if (action === 'open' || action === 'close') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            await ctx.sock.groupSettingUpdate(ctx.chat, action === 'close' ? 'announcement' : 'not_announcement')
            await ctx.reply(action === 'close' ? 'Group closed — only admins can send messages. ✅' : 'Group opened. ✅')
            return
        }

        if (action === 'add' || action === 'kick' || action === 'promote' || action === 'demote') {
            if (!(await requireGroup(ctx)) || !(await requireAdmin(ctx)) || !(await requireBotAdmin(ctx))) return
            const target = resolveTarget(ctx)
            if (!target) {
                await ctx.reply('Mention, reply to, or give the number of the member. 🛑')
                return
            }
            if (action !== 'add' && jidToNumber(target) === jidToNumber(ctx.sock.user?.id ?? '')) {
                await ctx.reply('I cannot do that to myself. 🛑')
                return
            }

            const participantAction = (action === 'kick' ? 'remove' : action) as
                | 'add'
                | 'remove'
                | 'promote'
                | 'demote'
            const [result] = await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], participantAction)
            if (action === 'add' && result?.status && result.status !== '200') {
                await ctx.reply(`Could not add ${label(target)} (status ${result.status}). 🛑`)
                return
            }
            const verbs = {
                add: 'Added',
                kick: 'Removed',
                promote: 'Promoted',
                demote: 'Demoted',
            } as const
            await ctx.reply(`${verbs[action]} ${label(target)} ✅`)
            return
        }

        if (action === 'leave') {
            if (!(await requireGroup(ctx))) return
            if (!ctx.isOwner) {
                await ctx.reply('Only the owner can make me leave. 🛑')
                return
            }
            await ctx.reply('Leaving this group. ✅')
            await ctx.sock.groupLeave(ctx.chat)
            return
        }

        if (action === 'info') {
            if (!(await requireGroup(ctx))) return
            const metadata = await ctx.groupMetadata()
            if (!metadata) {
                await ctx.reply('Could not read this group right now. 🛑')
                return
            }
            const admins = metadata.participants.filter((participant) => participant.admin).length
            await ctx.reply(
                [
                    '╭─ *Group*',
                    `│ Name : ${metadata.subject}`,
                    `│ Members : ${metadata.participants.length}`,
                    `│ Admins : ${admins}`,
                    `│ Locked : ${metadata.announce ? 'yes' : 'no'}`,
                    metadata.desc?.trim() ? `│ About : ${metadata.desc.trim().slice(0, 200)}` : '',
                    '╰─',
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
            return
        }

        await ctx.reply(
            [
                '*Group actions*',
                `${ctx.prefix}group create <name> @user`,
                `${ctx.prefix}group add|kick|promote|demote @user`,
                `${ctx.prefix}group link|revoke`,
                `${ctx.prefix}group subject|rename <text>`,
                `${ctx.prefix}group desc <text>`,
                `${ctx.prefix}group open|close`,
                `${ctx.prefix}group leave`,
                `${ctx.prefix}group info`,
            ].join('\n'),
        )
    },
})


ari({
    name: 'leave',
    description: 'Make the bot leave this group (owner only)',
    category: 'group',
    aliases: ['exitgroup'],
    usage: 'leave',
    ownerOnly: true,
    groupOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        await ctx.reply('Leaving this group. ✅')
        await ctx.sock.groupLeave(ctx.chat)
    },
})

import { jidToNumber } from '../../bot/helpers.js'
import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { identityAliases, normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'

ari({
    name: 'unban',
    description: 'Unban a user from the bot, and add them back to the group',
    category: 'owner',
    usage: 'unban @user',
    ownerOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)

        if (!raw) {
            await ctx.reply('Tag or reply to the user you want to unban. 🛑')
            return
        }

        const target = await normalizeTarget(ctx, raw)
        const name = await targetName(ctx, target)
        const label = name || jidToNumber(target)
        const groupName = ctx.isGroup ? (await ctx.groupMetadata())?.subject : undefined

        // Clear the ban for every form of the account (phone JID and LID).
        // Clearing only one left the LID flagged, so the add-event guard kicked
        // the user straight back out with a goodbye message.
        const aliases = await identityAliases(ctx, raw)
        for (const jid of new Set([raw, target, ...aliases])) db.ban(jid, false)

        if (!ctx.isGroup) {
            await ctx.reply(`Unbanned ${label} from the bot ✅`)
            return
        }

        await ctx.sock
            .sendMessage(
                ctx.chat,
                {
                    text: `${label} has been unbanned from the bot${groupName ? ` in *${groupName}*` : ''} ✅`,
                },
                { quoted: ctx.msg },
            )
            .catch(() => undefined)

        for (const jid of new Set([target, raw, ...aliases])) {
            try {
                const [result] = await ctx.sock.groupParticipantsUpdate(ctx.chat, [jid], 'add')
                if (String(result?.status ?? '') === '200') {
                    await ctx.reply(`Unbanned ${label} from the bot and added them back to *${groupName ?? 'the group'}* ✅`)
                    return
                }
            } catch {
                continue
            }
        }

        await ctx.reply(`Unbanned ${label} from the bot, but WhatsApp would not let me add them back to *${groupName ?? 'the group'}* ✅`)
    },
})

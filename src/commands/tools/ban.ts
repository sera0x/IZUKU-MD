import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { identityAliases, normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { jidToNumber } from '../../bot/helpers.js'
import { cleanGroupName } from '../../features/text.js'

ari({
    name: 'ban',
    description: 'Ban a user from the bot, and remove them from the group',
    category: 'owner',
    usage: 'ban @user',
    ownerOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)

        if (!raw) {
            await ctx.reply('Tag or reply to the user you want to ban. 🛑')
            return
        }

        const target = await normalizeTarget(ctx, raw)
        if (config.owners.includes(jidToNumber(raw)) || config.owners.includes(jidToNumber(target))) {
            await ctx.reply('I will not ban an owner. 🛑')
            return
        }

        const name = await targetName(ctx, target)
        const label = name || jidToNumber(target)
        const subject = ctx.isGroup ? (await ctx.groupMetadata())?.subject : undefined
        const groupName = subject ? cleanGroupName(subject) : undefined

        // Ban every form of the account (phone JID and LID), otherwise the
        // auto-kick guard can still see one of them as unbanned and let them
        // back in, or ban them again under the form they rejoin with.
        const aliases = await identityAliases(ctx, raw)
        for (const jid of new Set([raw, target, ...aliases])) db.ban(jid, true)

        if (!ctx.isGroup) {
            await ctx.reply(`Banned ${label} from the bot ✅`)
            return
        }

        await ctx.sock
            .sendMessage(
                ctx.chat,
                {
                    text: `${label} has been banned from the bot${groupName ? ` in *${groupName}*` : ''}. 🛑`,
                },
                { quoted: ctx.msg },
            )
            .catch(() => undefined)

        for (const jid of new Set([target, raw, ...aliases])) {
            try {
                const [result] = await ctx.sock.groupParticipantsUpdate(ctx.chat, [jid], 'remove')
                if (String(result?.status ?? '') === '200') {
                    await ctx.reply(`Banned ${label} from *${groupName ?? 'the group'}* and bot ✅`)
                    return
                }
            } catch {
                continue
            }
        }

        await ctx.reply(`Banned ${label} from the bot, but I could not remove them from *${groupName ?? 'the group'}* ✅`)
    },
})

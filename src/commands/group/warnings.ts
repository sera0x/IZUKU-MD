import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetLabel, targetName } from '../../bot/group-utils.js'
import { sameUser } from '../../bot/identity.js'
import type { CommandContext } from '../../bot/types.js'

const cleanReason = (text: string, ...jids: string[]): string => {
    let reason = text
    for (const jid of jids) {
        const number = jidToNumber(jid)
        if (number) reason = reason.replace(new RegExp(`@?${number}`, 'g'), '')
    }
    return reason.replace(/@\S+/g, '').replace(/\s+/g, ' ').trim() || 'No reason given'
}

const labelFor = async (ctx: CommandContext, jid: string): Promise<string> => {
    const name = await targetName(ctx, jid)
    return name ? `*${name}*` : targetLabel(jid)
}

/**
 * Warnings written before the LID/phone normalisation fix may still live under
 * the raw LID. Match both aliases (and their digits) so old counts are kept.
 */
const warningRows = (ctx: CommandContext, target: string, raw: string) => {
    const digits = new Set([jidToNumber(target), jidToNumber(raw)].filter(Boolean))
    return db
        .warningsForGroup(ctx.chat)
        .filter(
            (row) =>
                sameUser(row.user_jid, target) ||
                sameUser(row.user_jid, raw) ||
                digits.has(jidToNumber(row.user_jid)),
        )
}

ari({
    name: 'warn',
    description: 'Warn a member; auto-kick at the limit',
    category: 'group',
    usage: 'warn @user reason',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Mention or reply to the member you want to warn. 🛑')
            return
        }

        const target = await normalizeTarget(ctx, raw)
        const label = await labelFor(ctx, target)
        const mentions = [...new Set([raw, target])]
        const reason = cleanReason(ctx.text, raw, target)
        const previous = warningRows(ctx, target, raw).length
        db.warn(target, ctx.chat, reason, ctx.senderName)
        const total = previous + 1
        await ctx.sock.sendMessage(
            ctx.chat,
            {
                text: `${label} warned (${total}/${config.warnLimit})\nReason: ${reason}`,
                mentions,
            },
            { quoted: ctx.msg },
        )

        if (total >= config.warnLimit) {
            if (!ctx.isBotAdmin) {
                await ctx.reply('Warning limit reached, but I need admin rights to remove them. 🛑')
                return
            }
            await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'remove')
            db.clearWarningsFor(
                [target, raw, ...warningRows(ctx, target, raw).map((row) => row.user_jid)],
                ctx.chat,
            )
            await ctx.sock.sendMessage(ctx.chat, {
                text: `Removed ${label} after ${config.warnLimit} warnings. ✅`,
                mentions,
            })
        }
    },
})

ari({
    name: 'warnings',
    description: 'List warnings for a member',
    category: 'group',
    usage: 'warnings @user',
    groupOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx) ?? ctx.sender
        const target = await normalizeTarget(ctx, raw)
        const label = await labelFor(ctx, target)
        const mentions = [...new Set([raw, target])]
        const rows = warningRows(ctx, target, raw)
        if (!rows.length) {
            await ctx.sock.sendMessage(ctx.chat, {
                text: `${label} has no warnings. ✅`,
                mentions,
            })
            return
        }

        await ctx.sock.sendMessage(ctx.chat, {
            text: [
                `${label} — ${rows.length}/${config.warnLimit}`,
                ...rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.reason} (by ${row.warned_by})`),
            ].join('\n'),
            mentions,
        })
    },
})

ari({
    name: 'resetwarn',
    description: 'Clear all warnings for a member',
    category: 'group',
    usage: 'resetwarn @user',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Mention or reply to the member. 🛑')
            return
        }
        const target = await normalizeTarget(ctx, raw)
        const label = await labelFor(ctx, target)
        const rows = warningRows(ctx, target, raw)
        db.clearWarningsFor(
            [target, raw, ...rows.map((row) => row.user_jid)],
            ctx.chat,
        )
        await ctx.sock.sendMessage(ctx.chat, {
            text: `Cleared warnings for ${label}. ✅`,
            mentions: [...new Set([raw, target])],
        })
    },
})

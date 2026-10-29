import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { displayNameFor, identityAliases, normalizeTarget, resolveTarget } from '../../bot/group-utils.js'
import { jidToNumber } from '../../bot/helpers.js'


// Reason = every word that is not the tag (@...), a raw number target, or a -Nd duration flag.
const daysOf = (args: string[]): number | null => {
    const m = args.find((arg) => /^-\d{1,3}d?$/.test(arg))
    if (!m) return null
    return Number(m.replace('d', '').replace('-', ''))
}

const reasonOf = (args: string[]): string => {
    const words = args.filter((arg) => !arg.startsWith('@') && !/^\d{7,}$/.test(arg) && !/^-\d{1,3}d?$/.test(arg))
    return words.join(' ').trim() || 'no reason'
}


ari({
    name: 'gban',
    modOk: true,
    description: 'Soft ban: stop a user using bot commands in this group only (they stay in the group)',
    category: 'group',
    usage: 'gban @user <reason>',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Tag or reply to the user you want to gban. 🛑')
            return
        }

        const target = await normalizeTarget(ctx, raw)
        if (config.owners.includes(jidToNumber(raw)) || config.owners.includes(jidToNumber(target))) {
            await ctx.reply('I will not gban an owner. 🛑')
            return
        }

        const reason = reasonOf(ctx.args)
        const days = daysOf(ctx.args)
        const expiresAt = days ? Date.now() + days * 24 * 60 * 60 * 1000 : null
        const banner = ctx.sender

        // Store every form of the account (phone JID and LID) so the check in
        // the pipeline matches however WhatsApp reports the sender.
        const aliases = await identityAliases(ctx, raw)
        const forms = new Set([raw, target, ...aliases].filter(Boolean))
        for (const jid of forms) db.gbanAdd(ctx.chat, jid, reason, ctx.sender, expiresAt)

        await ctx.sock
            .sendMessage(
                ctx.chat,
                {
                    text: `${displayNameFor(target).replace(/^@/, '')} has been banned by ${displayNameFor(banner).replace(/^@/, '')}${days ? ` for ${days} day${days === 1 ? '' : 's'}` : ''}. Reason: ${reason} 🛑`,
                },
                { quoted: ctx.msg },
            )
            .catch(() => undefined)
    },
})

ari({
    name: 'ungban',
    description: 'Lift a soft group ban so the user can use bot commands here again',
    category: 'group',
    usage: 'ungban @user',
    groupOnly: true,
    adminOnly: true,
    modOk: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Tag or reply to the user you want to ungban. 🛑')
            return
        }

        const target = await normalizeTarget(ctx, raw)
        const aliases = await identityAliases(ctx, raw)
        const forms = new Set([raw, target, ...aliases].filter(Boolean))
        let removed = false
        for (const jid of forms) if (db.gbanRemove(ctx.chat, jid)) removed = true

        await ctx.reply(
            removed
                ? `${displayNameFor(target).replace(/^@/, '')} can use the bot in this group again ✅`
                : `${displayNameFor(target).replace(/^@/, '')} is not gbanned here. 🛑`)
    },
})

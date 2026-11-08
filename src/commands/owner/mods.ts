import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { identityAliases, normalizeTarget, resolveTarget, tagOf } from '../../bot/group-utils.js'
import { jidToNumber } from '../../bot/helpers.js'

ari({
    name: 'addmod',
    description: 'Give a user mod access to the game commands (owner only, hidden)',
    category: 'owner',
    usage: 'addmod @user',
    ownerOnly: true,
    hidden: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Tag or reply to the user you want to make a mod. 🛑')
            return
        }
        const target = await normalizeTarget(ctx, raw)
        if (config.owners.includes(jidToNumber(raw)) || config.owners.includes(jidToNumber(target))) {
            await ctx.reply('That is an owner already. 🛑')
            return
        }
        const aliases = await identityAliases(ctx, raw)
        for (const jid of new Set([raw, target, ...aliases].filter(Boolean))) db.modAdd(jid, ctx.sender)

        await ctx.reply(`${tagOf(undefined, target)} is a mod now ✅`, [target])
    },
})

ari({
    name: 'delmod',
    description: 'Remove a user from the mod list (owner only, hidden)',
    category: 'owner',
    usage: 'delmod @user',
    ownerOnly: true,
    hidden: true,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Tag or reply to the mod you want to remove. 🛑')
            return
        }
        const target = await normalizeTarget(ctx, raw)
        const aliases = await identityAliases(ctx, raw)
        let removed = false
        for (const jid of new Set([raw, target, ...aliases].filter(Boolean))) if (db.modRemove(jid)) removed = true
        await ctx.reply(
            removed
                ? `${tagOf(undefined, target)} is no longer a mod ✅`
                : `${tagOf(undefined, target)} is not a mod. 🛑`,
            [target],
        )
    },
})

ari({
    name: 'mods',
    description: 'List the bot mods (owner only, hidden)',
    category: 'owner',
    usage: 'mods',
    ownerOnly: true,
    hidden: true,
    run: async (ctx) => {
        const list = db.modList()
        if (!list.length) {
            await ctx.reply('No mods yet. 🛑')
            return
        }
        await ctx.reply(['Mods:', ...list.map((jid) => `+${jidToNumber(jid)}`)].join('\n'))
    },
})

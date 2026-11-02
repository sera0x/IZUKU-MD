import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetName, usableName } from '../../bot/group-utils.js'
import { db } from '../../db/index.js'
import { progressBar, progressFor, rankLine } from '../../features/xp.js'

ari({
    name: 'rank',
    description: 'Show your activity level in this chat',
    category: 'general',
    aliases: ['level', 'xp'],
    usage: 'rank | rank @user',
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const name =
            usableName(raw ? (await targetName(ctx, target)) || '' : '') ||
            usableName(ctx.senderName) ||
            jidToNumber(target)

        const row = db.xp(ctx.chat, target)
        const progress = progressFor(row.xp)

        await ctx.reply(
            [
                `*${name}*`,
                `Level : ${progress.level} ${progressBar(progress)} ${progress.current}/${progress.needed}`,
                `XP    : ${progress.total}`,
                `Msgs  : ${row.messages}`,
                `Chat  : ${rankLine(ctx.chat, target)}`,
            ].join('\n'),
        )
    },
})

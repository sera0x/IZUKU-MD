import { config } from '../../config.js'
import { jidToNumber } from '../../bot/helpers.js'
import { phoneDigitsFor, sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName, usableName } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { progressBar, progressFor, rankLine } from '../../features/xp.js'

ari({
    name: 'profile',
    description: 'Show a player profile with level, XP and chat rank',
    aliases: ['p'],
    category: 'general',
    usage: 'profile | profile @user',
    cooldownMs: 0,
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const target = raw ? await normalizeTarget(ctx, raw) : ctx.sender
        const storedName = await targetName(ctx, target).catch(() => '')
        const name =
            usableName(storedName) ||
            (sameUser(target, ctx.sender) ? usableName(ctx.senderName) : '') ||
            jidToNumber(target) ||
            'unknown'

        const number = phoneDigitsFor(target) || jidToNumber(target) || 'unknown'
        const role = config.owners.includes(number)
            ? 'Owner'
            : config.sudo.includes(number)
              ? 'Sudo'
              : 'Member'

        const xp = db.xp(ctx.chat, target)
        const progress = progressFor(xp.xp)
        const chatRank = rankLine(ctx.chat, target)

        await ctx.reply(
            [
                `*${name}*`,
                `🪪 +${number} · ${role}`,
                '',
                '⚡ *ᴀᴄᴛɪᴠɪᴛʏ*',
                `⭐ *Level* : ${progress.level} ${progressBar(progress)} ${progress.current}/${progress.needed}`,
                `💬 *XP*    : ${progress.total}`,
                `📝 *Msgs*  : ${xp.messages}`,
                `🏆 *Chat rank* : ${chatRank}`,
            ].join('\n'),
        )
    },
})

import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'
import { applySetting } from '../../settings.js'

const toggles = (value: string | undefined): boolean | undefined => {
    const normalized = (value ?? '').toLowerCase()
    if (['on', 'enable', 'true', '1'].includes(normalized)) return true
    if (['off', 'disable', 'false', '0'].includes(normalized)) return false
    return undefined
}

const state = (value: number): string => (value ? 'on ✅' : 'off 🛑')

ari({
    name: 'antibadword',
    description: 'Block and delete messages containing bad words',
    category: 'group',
    aliases: ['badword', 'antiword'],
    usage: 'antibadword on|off | antibadword add <word> | antibadword del <word> | antibadword list',
    groupOnly: true,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()
        const group = db.group(ctx.chat)
        const value = ctx.args.slice(1).join(' ').trim()

        if (!action) {
            await ctx.reply(
                [
                    `Anti-badword is ${state(group.antibadword)}`,
                    `Blocked words : ${config.badWords.length}`,
                    `Use *${ctx.prefix}antibadword on|off* to toggle it here.`,
                    ctx.isOwner ? `Owners: *${ctx.prefix}antibadword add|del|list <word>*` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
            return
        }

        if (action === 'on' || action === 'off') {
            if (!ctx.isAdmin && !ctx.isOwner) {
                await ctx.reply('Admins only. 🛑')
                return
            }
            const next = action === 'on'
            db.updateGroup(ctx.chat, { antibadword: next })
            await ctx.reply(`Anti-badword ${next ? 'enabled ✅' : 'disabled 🛑'} in this group.`)
            return
        }

        if (!ctx.isOwner) {
            await ctx.reply('Only the owner can edit the word list. 🛑')
            return
        }

        if (action === 'list') {
            await ctx.reply(
                config.badWords.length
                    ? `*Blocked words* (${config.badWords.length})\n${config.badWords.join(', ')}`
                    : 'No blocked words stored. 🛑',
            )
            return
        }

        const word = value.toLowerCase().replace(/\s+/g, ' ').trim()
        if ((action === 'add' || action === 'del' || action === 'remove') && !word) {
            await ctx.reply(`Usage: ${ctx.prefix}antibadword ${action} <word> 🛑`)
            return
        }

        if (action === 'add') {
            if (config.badWords.includes(word)) {
                await ctx.reply(`*${word}* is already blocked. 🛑`)
                return
            }
            applySetting('ANTI_BAD_WORD', [...config.badWords, word].join(','))
            await ctx.reply(`Added *${word}* to the blocked list ✅`)
            return
        }

        if (action === 'del' || action === 'remove') {
            if (!config.badWords.includes(word)) {
                await ctx.reply(`*${word}* is not blocked. 🛑`)
                return
            }
            applySetting(
                'ANTI_BAD_WORD',
                config.badWords.filter((entry) => entry !== word).join(','),
            )
            await ctx.reply(`Removed *${word}* from the blocked list ✅`)
            return
        }

        await ctx.reply(
            `Usage: ${ctx.prefix}antibadword on|off | ${ctx.prefix}antibadword add|del|list <word> 🛑`,
        )
    },
})

ari({
    name: 'autosticker',
    description: 'Turn every image sent in this group into a sticker',
    category: 'group',
    aliases: ['autostick'],
    usage: 'autosticker on|off',
    groupOnly: true,
    run: async (ctx) => {
        const next = toggles(ctx.args[0])
        if (next === undefined) {
            const group = db.group(ctx.chat)
            await ctx.reply(`Auto-sticker is ${state(group.autosticker)}. Use *${ctx.prefix}autosticker on|off*.`)
            return
        }

        if (!ctx.isAdmin && !ctx.isOwner) {
            await ctx.reply('Admins only. 🛑')
            return
        }

        db.updateGroup(ctx.chat, { autosticker: next })
        await ctx.reply(`Auto-sticker ${next ? 'enabled ✅' : 'disabled 🛑'} in this group.`)
    },
})

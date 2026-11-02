import { ari, findCommand } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { jidToNumber } from '../../bot/helpers.js'
import { quotedStickerHash } from '../../features/sticker-triggers.js'

const shortHash = (hash: string): string => hash.slice(0, 8)

ari({
    name: 'setsticker',
    description: 'Bind a sticker to a command',
    category: 'tools',
    aliases: ['stickercommand', 'stickercmd'],
    usage: 'setsticker <command> | list | del — reply to a sticker',
    ownerOnly: true,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()

        if (action === 'list') {
            const triggers = db.stickerTriggers()
            if (!triggers.length) {
                await ctx.reply('No sticker commands saved. 🛑')
                return
            }

            await ctx.reply(
                [
                    '*Sticker commands*',
                    ...triggers.map((row) => `│ ${shortHash(row.hash)} → ${ctx.prefix}${row.command}`),
                ].join('\n'),
            )
            return
        }

        if (action === 'del' || action === 'delete' || action === 'remove') {
            const hash = quotedStickerHash(ctx.msg) || (ctx.args[1] ?? '').trim()
            if (!hash) {
                await ctx.reply('Reply to a sticker with this command to remove it. 🛑')
                return
            }

            const exact = hash.length === 32 ? hash : db.stickerTriggers().find((row) => row.hash.startsWith(hash))?.hash
            if (!exact || !db.removeStickerTrigger(exact)) {
                await ctx.reply('No sticker command matched that sticker. 🛑')
                return
            }

            await ctx.reply('Sticker command removed. ✅')
            return
        }

        if (!action) {
            await ctx.reply(
                [
                    'Reply to a sticker and use one of these:',
                    `${ctx.prefix}setsticker save`,
                    `${ctx.prefix}setsticker del`,
                    `${ctx.prefix}setsticker list`,
                ].join('\n'),
            )
            return
        }

        const command = findCommand(action)
        if (!command) {
            await ctx.reply(`Unknown command: *${action}* 🛑`)
            return
        }
        if (command.name === 'setsticker') {
            await ctx.reply('I cannot bind a sticker to itself. 🛑')
            return
        }

        const hash = quotedStickerHash(ctx.msg)
        if (!hash) {
            await ctx.reply('Reply to a sticker with this command so I can save it. 🛑')
            return
        }

        db.setStickerTrigger(hash, command.name, jidToNumber(ctx.sender))
        await ctx.reply(
            `Sticker saved. Sending it now runs *${ctx.prefix}${command.name}* ✅`,
        )
    },
})

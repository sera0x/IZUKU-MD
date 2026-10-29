import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'

const toggles = (value: string | undefined): boolean | undefined => {
    const normalized = (value ?? '').toLowerCase()
    if (['on', 'enable', 'true', '1'].includes(normalized)) return true
    if (['off', 'disable', 'false', '0'].includes(normalized)) return false
    return undefined
}

const state = (value: number): string => (value ? 'on ✅' : 'off 🛑')

ari({
    name: 'mute',
    description: 'Only admins can talk in this group',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        await ctx.sock.groupSettingUpdate(ctx.chat, 'announcement')
        await ctx.reply('Group muted. Admins only. ✅')
    },
})

ari({
    name: 'unmute',
    description: 'Let everyone talk again',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async (ctx) => {
        await ctx.sock.groupSettingUpdate(ctx.chat, 'not_announcement')
        await ctx.reply('Group unmuted. ✅')
    },
})

ari({
    name: 'welcome',
    description: 'Toggle welcome messages',
    category: 'group',
    usage: 'welcome on|off',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const next = toggles(ctx.args[0])
        if (next === undefined) {
            const group = db.group(ctx.chat)
            await ctx.reply(`Welcome messages are ${state(group.welcome)}. Use *${ctx.prefix}welcome on|off*.`)
            return
        }
        db.updateGroup(ctx.chat, { welcome: next })
        await ctx.reply(`Welcome messages ${next ? 'enabled ✅' : 'disabled 🛑'}.`)
    },
})

ari({
    name: 'goodbye',
    description: 'Toggle goodbye messages',
    category: 'group',
    usage: 'goodbye on|off',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const next = toggles(ctx.args[0])
        if (next === undefined) {
            const group = db.group(ctx.chat)
            await ctx.reply(`Goodbye messages are ${state(group.goodbye)}. Use *${ctx.prefix}goodbye on|off*.`)
            return
        }
        db.updateGroup(ctx.chat, { goodbye: next })
        await ctx.reply(`Goodbye messages ${next ? 'enabled ✅' : 'disabled 🛑'}.`)
    },
})

ari({
    name: 'antilink',
    description: 'Toggle link removal in this group',
    category: 'group',
    usage: 'antilink on|off',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const next = toggles(ctx.args[0])
        if (next === undefined) {
            const group = db.group(ctx.chat)
            await ctx.reply(
                `Antilink is ${state(group.antilink)} (action: *${config.antilink.action}*).\n` +
                    `Blocked: ${config.antilink.values.join(', ')}`,
            )
            return
        }
        db.updateGroup(ctx.chat, { antilink: next })
        await ctx.reply(`Antilink ${next ? 'enabled ✅' : 'disabled 🛑'}.`)
    },
})

ari({
    name: 'antifake',
    description: 'Toggle removal of blocked country codes',
    category: 'group',
    usage: 'antifake on|off',
    groupOnly: true,
    adminOnly: true,
    run: async (ctx) => {
        const next = toggles(ctx.args[0])
        if (next === undefined) {
            const group = db.group(ctx.chat)
            await ctx.reply(
                `Antifake is ${state(group.antifake)}. Blocked codes: ${config.blockedCountries.join(', ') || 'none'}`,
            )
            return
        }
        db.updateGroup(ctx.chat, { antifake: next })
        await ctx.reply(`Antifake ${next ? 'enabled ✅' : 'disabled 🛑'}.`)
    },
})

import { writeFileSync } from 'node:fs'
import { runtime } from '../../runtime.js'
import { ari } from '../../bot/registry.js'
import { applySetting, currentSettings, settingKeys } from '../../settings.js'
import { finishAndExit } from '../../bot/lifecycle.js'

ari({
    name: 'mode',
    description: 'Switch between public and private replies',
    category: 'owner',
    usage: 'mode public|private',
    ownerOnly: true,
    run: async (ctx) => {
        const next = (ctx.args[0] ?? '').toLowerCase()
        if (next !== 'public' && next !== 'private') {
            await ctx.reply(`Current mode: *${runtime.mode}*\nUse *${ctx.prefix}mode public|private*.`)
            return
        }

        applySetting('MODE', next)
        await ctx.reply(`Mode: ${next} ✅`)
    },
})

ari({
    name: 'setvar',
    description: 'Set a persisted runtime variable',
    category: 'owner',
    usage: 'setvar PREFIX=.',
    ownerOnly: true,
    run: async (ctx) => {
        const separator = ctx.text.indexOf('=')
        const key = separator > 0 ? ctx.text.slice(0, separator).trim() : ''
        const value = separator > 0 ? ctx.text.slice(separator + 1).trim() : ''

        if (!key || !value) {
            await ctx.reply(`Keys: ${settingKeys().join(', ')}\nUsage: ${ctx.prefix}setvar PREFIX=.`)
            return
        }

        try {
            const stored = applySetting(key, value)
            await ctx.reply(`${key.toUpperCase()}=${stored} ✅`)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'invalid setting'
            await ctx.reply(`${message} 🛑`)
        }
    },
})

ari({
    name: 'allvars',
    description: 'Show persisted runtime variables',
    category: 'owner',
    aliases: ['vars', 'allvar', 'getvar'],
    usage: 'vars [key]',
    ownerOnly: true,
    run: async (ctx) => {
        const values = currentSettings()
        const query = ctx.args[0]?.toUpperCase()

        if (query) {
            const value = values[query]
            await ctx.reply(value === undefined ? `Unknown setting: ${query} 🛑` : `${query}=${value}`)
            return
        }

        await ctx.reply(Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'))
    },
})

ari({
    name: 'restart',
    description: 'Restart the bot process',
    category: 'owner',
    ownerOnly: true,
    run: async (ctx) => {
        await ctx.reply('Restarting...')
        writeFileSync('data/restart', '1')
        // Drain in-flight sends, then exit 0; pm2 restarts the process.
        void finishAndExit('restart command')
    },
})

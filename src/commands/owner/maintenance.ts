import { ari, findCommand } from '../../bot/registry.js'
import { db } from '../../db/index.js'

const clean = (value: string): string => value.trim().toLowerCase().replace(/^[.#/!]/, '')

const AWAY = ['off', 'resume', 'enable', 'on', 'wake', 'unsuspend', 'back']

/**
 * Owner switch for taking a command out of service while it is being fixed.
 * The pipeline already refuses suspended commands; this is the only way to put
 * one on and take it off again.
 */
ari({
    name: 'maintenance',
    description: 'Take a command out of service for maintenance',
    category: 'owner',
    aliases: ['suspendcmd', 'disable'],
    ownerOnly: true,
    usage: 'maintenance <command> | maintenance list | maintenance off <command>',
    run: async (ctx) => {
        const [first = '', ...rest] = ctx.args.map(clean)

        if (AWAY.includes(first) && rest.length > 0) {
            const back = findCommand(rest[0]!)
            if (!back) {
                await ctx.reply(`No command called *${rest[0]}*. 🛑`)
                return
            }
            db.suspendedClear(back.name)
            await ctx.reply(`*${back.name}* is back in service. ✅`)
            return
        }

        if (!first || first === 'list') {
            const names = db.suspendedList()
            await ctx.reply(
                names.length
                    ? `🛠️ Suspended: ${names.join(', ')}\nUse *${ctx.prefix}maintenance off <command>* to bring one back.`
                    : `Nothing is suspended. Use *${ctx.prefix}maintenance <command>* to take one down.`,
            )
            return
        }

        const target = findCommand(first)
        if (!target) {
            await ctx.reply(`No command called *${first}*. 🛑`)
            return
        }

        if (target.ownerOnly) {
            await ctx.reply(`*${target.name}* is owner-only, so there is no point suspending it. 🛑`)
            return
        }

        db.suspendedSet(target.name)
        await ctx.reply(`*${target.name}* is suspended. 🛠️\nUse *${ctx.prefix}maintenance off ${target.name}* when it is fixed.`)
    },
})

ari({
    name: 'resume',
    description: 'Bring a suspended command back into service',
    category: 'owner',
    aliases: ['enable', 'back'],
    ownerOnly: true,
    usage: 'resume <command>',
    run: async (ctx) => {
        const name = clean(ctx.args[0] ?? '')
        if (!name) {
            const names = db.suspendedList()
            await ctx.reply(
                names.length
                    ? `Suspended: ${names.join(', ')}\nUse *${ctx.prefix}resume <command>*.`
                    : 'Nothing is suspended. ✅',
            )
            return
        }

        const target = findCommand(name)
        if (!target) {
            await ctx.reply(`No command called *${name}*. 🛑`)
            return
        }

        db.suspendedClear(target.name)
        await ctx.reply(`*${target.name}* is back in service. ✅`)
    },
})

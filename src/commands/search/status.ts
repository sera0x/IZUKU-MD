import { config } from '../../config.js'
import { runtime } from '../../runtime.js'
import { commandCount, ari } from '../../bot/registry.js'
import { applySetting } from '../../settings.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { jidToNumber, withTimeout } from '../../bot/helpers.js'
import { phoneJidFor } from '../../bot/identity.js'
import { createLogger } from '../../logger.js'

const log = createLogger(config.logLevel, { scope: 'about' })
import { formatUptime, memoryLine, platformLabel, runtimeLabel } from '../../features/system.js'

const botStatus = (): string =>
    [
        `╭─ *${config.botName}* status`,
        '│ State : online ✅',
        `│ Version : ${config.version}`,
        `│ Prefix : ${config.prefix}`,
        `│ Mode : ${runtime.mode}`,
        `│ Uptime : ${formatUptime(Date.now() - runtime.startedAt)}`,
        `│ Memory : ${memoryLine()}`,
        `│ Platform : ${platformLabel()}`,
        `│ Runtime : ${runtimeLabel()}`,
        `│ Commands : ${commandCount()}`,
        '╰─',
    ].join('\n')

ari({
    name: 'botstatus',
    description: 'Show the bot status card',
    category: 'general',
    aliases: ['stats'],
    run: async (ctx) => {
        await ctx.reply(botStatus())
    },
})

ari({
    name: 'about',
    description: 'Show a WhatsApp about status',
    category: 'general',
    usage: 'about [@user]',
    run: async (ctx) => {
        const raw = resolveTarget(ctx)
        const resolved = raw ? await normalizeTarget(ctx, raw) : await phoneJidFor(ctx.sock, ctx.sender)
        const target = resolved || ctx.sender
        const name = (await targetName(ctx, target)) || jidToNumber(target)

        // WhatsApp answers the status query with either a plain string or a
        // `{ status, setAt }` object depending on the client version.
        const query = async (jid: string): Promise<string> => {
            const result = await ctx.sock.fetchStatus(jid)
            const entry = result?.find((item) => item?.status !== undefined)
            const value = entry?.status as string | { status?: string | null } | undefined
            const text = typeof value === 'string' ? value : value?.status
            return typeof text === 'string' ? text.trim() : ''
        }

        // A silent USync failure would leave this command hanging forever, so
        // every lookup is bounded and a failure still gets a reply.
        const lookup = (jid: string): Promise<string> => withTimeout(query(jid), 6000, '')

        let about = await lookup(target)
        if (!about && target.endsWith('@lid')) {
            const mapped = await withTimeout(phoneJidFor(ctx.sock, target), 6000, '')
            if (mapped && mapped !== target) about = await lookup(mapped)
        }

        if (!about) {
            log.info('about lookup for %s returned nothing', target)
            await ctx.reply(
                `No about status for *${name}* — WhatsApp returned nothing, the about may be hidden. 🛑`,
            )
            return
        }

        await ctx.reply(
            [
                '╭─ *About*',
                `│ Name : ${name}`,
                `│ Number : +${jidToNumber(target)}`,
                `│ About : ${about}`,
                '╰─',
            ].join('\n'),
        )
    },
})

ari({
    name: 'status',
    description: 'Toggle automatic WhatsApp status viewing',
    category: 'tools',
    aliases: ['autostatus', 'statusview'],
    usage: 'status on|off | status delay <seconds> | status react <emoji|off>',
    ownerOnly: true,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()
        const rest = ctx.args.slice(1).join(' ').trim()

        if (action === 'delay') {
            if (!rest) {
                await ctx.reply(`Usage: ${ctx.prefix}status delay <seconds> 🛑`)
                return
            }

            try {
                const seconds = applySetting('AUTO_STATUS_DELAY', rest)
                await ctx.reply(`Status view delay set to *${seconds}s*. ✅`)
            } catch (error) {
                await ctx.reply(`${(error as Error).message} 🛑`)
            }
            return
        }

        if (action === 'react') {
            if (!rest) {
                await ctx.reply(`Usage: ${ctx.prefix}status react <emoji|off> 🛑`)
                return
            }

            const emoji = applySetting('AUTO_STATUS_REACT', rest)
            await ctx.reply(
                emoji === 'off' ? 'Status reactions off 🛑' : `Status reactions set to ${emoji} ✅`,
            )
            return
        }

        if (action !== 'on' && action !== 'off') {
            const delay = Math.round(config.status.delayMs / 1000)
            const react = config.status.react || 'off'
            await ctx.reply(
                [
                    `Automatic status viewing is ${runtime.autoReadStatus ? 'on ✅' : 'off 🛑'}`,
                    `Delay : ${delay}s`,
                    `Reaction : ${react}`,
                    `Use ${ctx.prefix}status on|off, ${ctx.prefix}status delay <seconds> or ${ctx.prefix}status react <emoji|off>.`,
                ].join('\n'),
            )
            return
        }

        applySetting('AUTO_READ_STATUS', action)
        await ctx.reply(action === 'on' ? 'Automatic status viewing on ✅' : 'Automatic status viewing off 🛑')
    },
})

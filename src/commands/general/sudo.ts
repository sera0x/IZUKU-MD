import type { CommandContext } from '../../bot/types.js'
import { jidToNumber } from '../../bot/helpers.js'
import { identityAliases, normalizeTarget, resolveTarget } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'

const listSudo = (): string =>
    config.sudo
        .map((number) => `+${number}${config.owners.includes(number) ? ' (owner)' : ''}`)
        .join(', ') || 'none'

async function targetNumber(ctx: CommandContext): Promise<string | null> {
    const raw = resolveTarget(ctx)
    if (!raw) {
        await ctx.reply('Tag, reply to, or type the number of the user. 🛑')
        return null
    }

    const target = await normalizeTarget(ctx, raw)
    const aliases = await identityAliases(ctx, raw).catch(() => [] as string[])

    for (const jid of [target, raw, ...aliases]) {
        if (!jid.endsWith('@s.whatsapp.net')) continue
        const number = jidToNumber(jid)
        if (/^\d{7,15}$/.test(number)) return number
    }

    if (target.endsWith('@lid') || raw.endsWith('@lid')) {
        await ctx.reply('I could not resolve that LID to a phone number. 🛑')
        return null
    }

    await ctx.reply('That is not a valid phone number. 🛑')
    return null
}

async function addSudo(ctx: CommandContext): Promise<void> {
    const number = await targetNumber(ctx)
    if (!number) return

    if (config.owners.includes(number)) {
        await ctx.reply(`+${number} is an owner and already has full access. 🛑`)
        return
    }

    if (config.sudo.includes(number)) {
        await ctx.reply(`+${number} is already a sudo user. 🛑`)
        return
    }

    applySetting('SUDO', [...config.sudo, number].join(','))
    await ctx.reply(`Added +${number} as a sudo user ✅`)
}

async function removeSudo(ctx: CommandContext): Promise<void> {
    const number = await targetNumber(ctx)
    if (!number) return

    if (config.anchorNumber && number === config.anchorNumber) {
        await ctx.reply(`+${number} is the permanent owner account and cannot be removed. 🛑`)
        return
    }

    if (config.owners.includes(number)) {
        await ctx.reply(
            [
                `+${number} is listed in *OWNER_NUMBER*, not as a sudo user.`,
                'Owners always keep full access, so there is no sudo entry to remove.',
                'Delete it from *OWNER_NUMBER* in `.env` to demote it. 🛑',
            ].join('\n'),
        )
        return
    }

    if (!config.sudo.includes(number)) {
        await ctx.reply(`+${number} is not a sudo user. 🛑`)
        return
    }

    applySetting(
        'SUDO',
        config.sudo.filter((entry) => entry !== number).join(','),
    )
    await ctx.reply(`Removed +${number} from sudo ✅`)
}

ari({
    name: 'sudo',
    description: 'Manage trusted sudo users',
    category: 'owner',
    aliases: ['setsudo'],
    usage: 'sudo | sudo add @user | sudo del @user | sudo clear',
    ownerOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        const action = (ctx.args[0] ?? '').toLowerCase()

        if (action && !['list', 'clear', 'add', 'del', 'remove', 'rm'].includes(action)) {
            await addSudo(ctx)
            return
        }

        if (!action || action === 'list') {
            await ctx.reply(`*Sudo users* (${config.sudo.length})\n${listSudo()}`)
            return
        }

        if (action === 'clear') {
            applySetting('SUDO', '')
            await ctx.reply('Sudo list cleared. Owners remain. ✅')
            return
        }

        if (action === 'del' || action === 'remove' || action === 'rm') {
            await removeSudo(ctx)
            return
        }

        await addSudo(ctx)
    },
})

ari({
    name: 'delsudo',
    description: 'Remove a sudo user',
    category: 'owner',
    aliases: ['rmsudo', 'unsudo'],
    usage: 'delsudo @user | delsudo 2348012345678',
    ownerOnly: true,
    cooldownMs: 0,
    run: async (ctx) => {
        await removeSudo(ctx)
    },
})

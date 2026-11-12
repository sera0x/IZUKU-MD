import { ari } from '../../bot/registry.js'
import { applyUpdate, checkForUpdate, updateNotice } from '../../bot/update-checker.js'
import { setPrompt } from '../../features/prompts.js'

async function install(reply: (content: string) => Promise<unknown>): Promise<void> {
    await reply(
        [
            '⬇️ *Updating…*',
            '',
            '▸ git fetch + merge',
            '▸ npm install',
            '▸ npm run build',
            '',
            'The bot restarts when the build finishes. Do not stop it.',
        ].join('\n'),
    )

    const result = await applyUpdate()
    if (!result.ok) {
        await reply(['🛑 *Update failed*', '', '```', result.output.slice(-1200), '```'].join('\n'))
        return
    }

    await reply(['✅ *Update installed*', '', 'Restarting now — back in a moment.'].join('\n'))
    setTimeout(() => process.exit(0), 1500)
}

ari({
    name: 'update',
    description: 'Check GitHub for a newer build, then install and restart',
    category: 'owner',
    ownerOnly: true,
    usage: 'update',
    cooldownMs: 0,
    run: async (ctx) => {
        const status = await checkForUpdate()
        if (status.error && !status.checked) {
            await ctx.reply(`Could not check GitHub: *${status.error}* 🛑`)
            return
        }
        if (!status.available) {
            await ctx.reply(['✅ *Already up to date*', '', `▸ Running: ${status.localSha.slice(0, 7)}`].join('\n'))
            return
        }

        await ctx.reply(
            [updateNotice(status), '', '▸ Reply *yes* to install it, *no* to abort.'].join('\n'),
        )

        setPrompt(ctx.chat, ctx.sender, async (input) => {
            const answer = input.text.trim().toLowerCase()
            if (!answer.startsWith('y')) {
                await input.reply('🛑 *Update aborted.* Nothing changed.')
                return
            }
            await install((content) => ctx.reply(content))
        })
    },
})

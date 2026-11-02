import { ari } from '../../bot/registry.js'

interface NpmPackage {
    name?: string
    description?: string
    'dist-tags'?: { latest?: string }
    homepage?: string
}

ari({
    name: 'npm',
    description: 'Look up an npm package',
    category: 'tools',
    usage: 'npm baileys',
    cooldownMs: 3000,
    run: async (ctx) => {
        const name = ctx.args[0]
        if (!name) {
            await ctx.reply(`Usage: ${ctx.prefix}npm baileys`)
            return
        }

        try {
            const response = await fetch(`https://registry.npmjs.org/${encodeURI(name)}`, {
                signal: AbortSignal.timeout(5000),
            })
            if (!response.ok) throw new Error('not found')
            const data = (await response.json()) as NpmPackage

            await ctx.reply(
                [
                    `*${data.name ?? name}*`,
                    data['dist-tags']?.latest ? `latest: ${data['dist-tags'].latest}` : '',
                    data.description ?? '',
                    data.homepage ? `home: ${data.homepage}` : '',
                    `https://www.npmjs.com/package/${data.name ?? name}`,
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
        } catch {
            await ctx.reply(`Package not found: *${name}* 🛑`)
        }
    },
})

import { config } from '../../config.js'
import { ari } from '../../bot/registry.js'

interface RepoStats {
    stargazers_count?: number
    forks_count?: number
}

ari({
    name: 'repo',
    description: 'Show the bot repository',
    category: 'general',
    aliases: ['git', 'script', 'sc'],
    run: async (ctx) => {
        const repo = config.links.repo
        let stats: RepoStats = {}

        try {
            const response = await fetch(repo.replace('https://github.com/', 'https://api.github.com/repos/'), {
                signal: AbortSignal.timeout(4000),
            })
            if (response.ok) stats = (await response.json()) as RepoStats
        } catch {
            stats = {}
        }

        await ctx.reply(
            [
                `*${config.botName}*`,
                `repo: ${repo}`,
                stats.stargazers_count === undefined
                    ? ''
                    : `stars: ${stats.stargazers_count} · forks: ${stats.forks_count ?? 0}`,
                `owner: ${config.ownerName}`,
                'stack: Bun · TypeScript · Baileys · SQLite',
            ]
                .filter(Boolean)
                .join('\n'),
        )
    },
})

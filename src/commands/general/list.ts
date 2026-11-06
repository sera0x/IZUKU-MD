import { ari, CATEGORIES, commandsByCategory, findCommand } from '../../bot/registry.js'
import { config } from '../../config.js'
import { boxBottom, smallCaps } from '../../features/text.js'
import type { Category, Command } from '../../bot/types.js'

const descriptionOf = (command: Command): string => command.description.trim() || 'No description'

const usageOf = (command: Command): string => {
    const usage = command.usage.trim()
    return usage ? `${config.prefix}${usage}` : `${config.prefix}${command.name}`
}

const flagsOf = (command: Command): string =>
    [
        command.ownerOnly ? 'owner' : '',
        command.groupOnly ? 'group' : '',
        command.adminOnly ? 'admin' : '',
        command.botAdmin ? 'bot admin' : '',
    ]
        .filter(Boolean)
        .join('/')

const commandLine = (command: Command): string => {
    const flags = flagsOf(command)
    return [
        `│ ▸ *${config.prefix}${command.name}* — ${descriptionOf(command)}`,
        `│   ↳ \`${usageOf(command)}\`${flags ? ` · ${flags}` : ''}`,
    ].join('\n')
}

function categoryBox(category: Category, commands: Command[]): string {
    const top = `╭─〔 *${smallCaps(category)}* · ${commands.length} 〕`
    return [top, ...commands.map(commandLine), boxBottom(top)].join('\n')
}

function commandCard(command: Command): string {
    const top = `╭─〔 *${config.prefix}${command.name}* 〕`
    return [
        top,
        `│ *Function* : ${descriptionOf(command)}`,
        `│ *Usage* : \`${usageOf(command)}\``,
        `│ *Category* : ${command.category}`,
        command.aliases.length
            ? `│ *Aliases* : ${command.aliases.map((alias) => `${config.prefix}${alias}`).join(', ')}`
            : '',
        flagsOf(command) ? `│ *Access* : ${flagsOf(command)}` : '',
        boxBottom(top),
    ]
        .filter(Boolean)
        .join('\n')
}

const visible = (commands: Command[], isOwner: boolean): Command[] =>
    commands
        .filter((command) => !command.ownerOnly || isOwner)
        .sort((a, b) => a.name.localeCompare(b.name))

ari({
    name: 'list',
    description: 'List every command with its function and usage',
    category: 'general',
    usage: 'list [category|command]',
    cooldownMs: 0,
    run: async (ctx) => {
        const query = ctx.args[0]?.toLowerCase()

        if (query) {
            const command = findCommand(query)
            if (command && (!command.ownerOnly || ctx.isOwner)) {
                await ctx.reply(commandCard(command))
                return
            }

            const category = CATEGORIES.find((name) => name.toLowerCase() === query)
            if (category) {
                const commands = visible(commandsByCategory().get(category) ?? [], ctx.isOwner)
                if (!commands.length) {
                    await ctx.reply('No commands in that category. 🛑')
                    return
                }
                await ctx.reply(categoryBox(category, commands))
                return
            }

            await ctx.reply(`No command or category named *${query}*. 🛑`)
            return
        }

        const sections: string[] = []
        let total = 0

        for (const category of CATEGORIES) {
            const commands = visible(commandsByCategory().get(category) ?? [], ctx.isOwner)
            if (!commands.length) continue
            total += commands.length
            sections.push(categoryBox(category, commands))
        }

        const top = `🍃 *ᴄᴏᴍᴍᴀɴᴅ ʟɪꜱᴛ*`
        const header = [
            top,
            `▸ *Prefix* : ${config.prefix}`,
            `▸ *Commands* : ${total}`,
            `▸ *Filter* : ${config.prefix}list <category|command>`,
        ].join('\n')
        const footer = `*${config.prefix}help <command>* for full details`
        await ctx.reply([header, '', sections.join('\n\n'), '', footer].join('\n'))
    },
})

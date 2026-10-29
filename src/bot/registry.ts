import type { Category, Command, CommandInput } from './types.js'

const commands = new Map<string, Command>()
const aliases = new Map<string, string>()
const byCategory = new Map<Category, Command[]>()

export const CATEGORIES: Category[] = ['general', 'group', 'tools', 'media', 'fun', 'afk', 'owner']

export function defineCommand(input: CommandInput): Command {
    const name = input.name.toLowerCase().trim()
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
        throw new Error(`Invalid command name: "${input.name}"`)
    }
    if (commands.has(name)) {
        throw new Error(`Duplicate command: "${name}"`)
    }

    const command: Command = {
        name,
        description: input.description ?? '',
        category: input.category ?? 'general',
        aliases: (input.aliases ?? []).map((alias) => alias.toLowerCase()),
        usage: input.usage ?? '',
        ownerOnly: input.ownerOnly ?? false,
        groupOnly: input.groupOnly ?? false,
        adminOnly: input.adminOnly ?? false,
        botAdmin: input.botAdmin ?? false,
        hidden: input.hidden ?? false,
        modOk: input.modOk ?? false,
        cooldownMs: input.cooldownMs,
        run: input.run,
    }

    for (const alias of command.aliases) {
        const existing = aliases.get(alias)
        if (commands.has(alias) || existing) {
            throw new Error(`Alias "${alias}" of "${name}" is already used by "${existing ?? alias}"`)
        }
        aliases.set(alias, name)
    }

    commands.set(name, command)
    const bucket = byCategory.get(command.category) ?? []
    bucket.push(command)
    byCategory.set(command.category, bucket)

    return command
}

export const ari = defineCommand
export const imd = defineCommand

export function findCommand(name: string): Command | undefined {
    const key = name.toLowerCase()
    const direct = commands.get(key)
    if (direct) return direct
    const target = aliases.get(key)
    return target ? commands.get(target) : undefined
}

export function allCommands(): Command[] {
    return [...commands.values()]
}

export function commandsByCategory(): Map<Category, Command[]> {
    return new Map([...byCategory.entries()].map(([category, list]) => [category, list.filter((c) => !c.hidden)]))
}

export function commandCount(): number {
    return commands.size
}

export function clearRegistry(): void {
    commands.clear()
    aliases.clear()
    byCategory.clear()
}

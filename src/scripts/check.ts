

process.env.DATABASE_PATH = ':memory:'
process.env.LOG_LEVEL = 'warn'

const { loadCommands } = await import('../bot/loader.js')
const { allCommands } = await import('../bot/registry.js')
const { db } = await import('../db/index.js')
const { config } = await import('../config.js')

let failures = 0

const fail = (message: string): void => {
    failures += 1
    console.error(`${message} ✗`)
}

const pass = (message: string): void => console.log(`✓ ${message}`)

if (!config.prefix) fail('prefix is empty')
else pass(`config loaded (prefix "${config.prefix}", mode ${config.mode})`)

if (config.owners.length === 0) console.warn('! OWNER_NUMBER not set (owner commands will be locked)')

if (!db.healthcheck()) fail('database healthcheck failed')
else pass(`sqlite ready at ${config.dbPath}`)

const report = await loadCommands()
if (report.failed.length) fail(`${report.failed.length} command file(s) failed to load`)
else pass(`${report.commands} commands loaded from ${report.loaded.length} files`)

const names = allCommands().map((command) => command.name)
if (new Set(names).size !== names.length) fail('duplicate command names detected')
else pass('command names are unique')

if (names.length === 0) fail('no commands registered')

const ownerCommands = allCommands().filter((command) => command.ownerOnly).length
const groupCommands = allCommands().filter((command) => command.groupOnly).length
pass(`${ownerCommands} owner-only, ${groupCommands} group-only commands`)

db.close()

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`)
    process.exit(1)
}
console.log('\nall checks passed')

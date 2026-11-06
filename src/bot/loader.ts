import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { commandCount } from './registry.js'

const log = createLogger(config.logLevel, { scope: 'loader' })

const commandsDir = fileURLToPath(new URL('../commands', import.meta.url))

function listModules(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) files.push(...listModules(full))
        else if (['.js', '.ts'].includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')) files.push(full)
    }


    return files.sort()
}

export interface LoadReport {
    loaded: string[]
    failed: Array<{ file: string; error: string }>
    commands: number
}

export async function loadCommands(): Promise<LoadReport> {
    const report: LoadReport = { loaded: [], failed: [], commands: 0 }
    const files = listModules(commandsDir)

    for (const file of files) {
        try {
            await import(pathToFileURL(file).href)
            report.loaded.push(file.slice(commandsDir.length + 1))
        } catch (error) {
            const message = error instanceof Error ? error.stack ?? error.message : String(error)
            report.failed.push({ file: file.slice(commandsDir.length + 1), error: message })
            log.error('failed to load %s: %s', file.slice(commandsDir.length + 1), message)
        }
    }

    report.commands = commandCount()
    log.info('loaded %d commands from %d files (%d failed)', report.commands, report.loaded.length, report.failed.length)
    return report
}

export { commandsDir }

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// config.env is the current name; .env stays supported so an install that has
// not been renamed yet keeps working.
const ENV_FILES = ['config.env', '.env']

function defaultEnvFile(): string {
    for (const name of ENV_FILES) {
        const file = resolve(process.cwd(), name)
        if (existsSync(file)) return file
    }
    return resolve(process.cwd(), ENV_FILES[0] as string)
}

export function loadEnvFile(file = defaultEnvFile()): void {
    if (!existsSync(file)) return

    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue

        const separator = line.indexOf('=')
        if (separator === -1) continue

        const key = line.slice(0, separator).trim()
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

        let value = line.slice(separator + 1).trim()
        const quote = value[0]
        if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
            value = value.slice(1, -1)
        } else {
            // Standard dotenv behaviour: drop a trailing `  # comment`. Without
            // this, `ANTI_DELETE=same  # off|same` became a mode that matched
            // nothing and silently disabled the feature.
            const comment = value.search(/\s#/)
            if (comment !== -1) value = value.slice(0, comment).trim()
        }

        if (process.env[key] === undefined) process.env[key] = value
    }
}

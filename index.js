import { existsSync } from 'node:fs'

const isBun = typeof globalThis.Bun !== 'undefined'
const entry = new URL(isBun ? './src/index.ts' : './dist/src/index.js', import.meta.url)

if (!existsSync(entry)) {
    console.error('[izuku] dist/ is missing. Run npm run build, or use Bun: bun index.js')
    process.exit(1)
}

await import(entry.href).catch((error) => {
    console.error('Failed to start IZUKU-MD:', error)
    process.exitCode = 1
})

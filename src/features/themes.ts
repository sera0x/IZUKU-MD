import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from '../config.ts'

export interface Theme {
    name: string
    title: string
    botName: string
    body: string
    footer: string
    images: string[]
}

interface ThemeFile {
    STRINGS?: {
        global?: {
            title?: string
            botName?: string
            body?: string
            footer?: string
            [key: string]: string | undefined
        }
    }
}

const themeDir = [resolve(process.cwd(), 'themes'), resolve(process.cwd(), 'legacy/Themes')].find((dir) =>
    existsSync(dir),
)

const clean = (value: string | undefined): string => (value ?? '').trim()

function readThemes(): Map<string, Theme> {
    const themes = new Map<string, Theme>()
    if (!themeDir) return themes

    for (const file of readdirSync(themeDir)) {
        if (!file.toLowerCase().endsWith('.json')) continue
        const name = file.slice(0, -5).toUpperCase()

        try {
            const parsed = JSON.parse(readFileSync(join(themeDir, file), 'utf8')) as ThemeFile
            const global = parsed.STRINGS?.global
            const images = Object.entries(global ?? {})
                .filter(([key, value]) => /^pic\d+$/i.test(key) && typeof value === 'string' && /^https?:/i.test(value))
                .sort(([a], [b]) => Number(a.slice(3)) - Number(b.slice(3)))
                .map(([, value]) => value as string)

            themes.set(name, {
                name,
                title: clean(global?.title) || name,
                botName: clean(global?.botName) || name,
                body: clean(global?.body) || 'WhatsApp bot',
                footer: clean(global?.footer) || config.ownerName,
                images,
            })
        } catch {
            continue
        }
    }

    return themes
}

const themes = readThemes()
const fallbackImages = themes.get('IZUKU')?.images ?? [...themes.values()][0]?.images ?? []

export const defaultTheme: Theme = {
    name: 'default',
    title: config.botName,
    botName: config.botName,
    body: 'WhatsApp bot',
    footer: config.ownerName,
    images: fallbackImages,
}

export function themeNames(): string[] {
    return [...themes.keys()].sort((a, b) => a.localeCompare(b))
}

export function getTheme(name: string | undefined): Theme | undefined {
    if (!name || name.toLowerCase() === 'default') return defaultTheme
    return themes.get(name.trim().toUpperCase())
}

export function themeFor(name: string | undefined): Theme {
    // No user-picked theme = plain menu: bot name only, no images.
    if (!name) return { ...defaultTheme, title: config.botName, botName: config.botName, footer: config.ownerName, images: [] }
    const theme = getTheme(name)
    if (!theme || theme.name === 'default') {
        return { ...defaultTheme, title: config.botName, botName: config.botName, footer: config.ownerName }
    }
    return theme
}

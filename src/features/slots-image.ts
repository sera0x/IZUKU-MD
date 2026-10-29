// Slots result image: real slot-machine look. Gold cabinet, marquee, 6x3 reel
// window. Reel symbols are twemoji PNGs composited by sharp (librsvg cannot
// draw color-emoji fonts, so SVG text is not usable for them).
import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROWS = 6
const COLS = 3
const CELL = 130
const PAD_X = 90
const PAD_Y = 190
const WIDTH = PAD_X * 2 + CELL * COLS
const HEIGHT = PAD_Y + 60 + CELL * ROWS + 60
const SYM_SIZE = 96
const CACHE_DIR = path.resolve('data/twemoji-cache')

function codepoints(sym: string): string {
    return [...sym].map((ch) => ch.codePointAt(0)!.toString(16)).join('-')
}

async function symbolPng(sym: string): Promise<Buffer | null> {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    const file = path.join(CACHE_DIR, codepoints(sym) + '.png')
    try {
        return await fs.readFile(file)
    } catch {}
    try {
        const res = await fetch('https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/' + codepoints(sym) + '.png', { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return null
        const buf = Buffer.from(await res.arrayBuffer())
        await fs.writeFile(file, buf)
        return buf
    } catch {
        return null
    }
}

export async function renderSlotsImage(grid: string[][], winners: number[], jackpot: boolean): Promise<Buffer> {
    const parts: string[] = []

    parts.push('<rect x="20" y="20" width="' + (WIDTH - 40) + '" height="' + (HEIGHT - 40) + '" rx="48" fill="#1a0d00" stroke="#ffd60a" stroke-width="10"/>')
    parts.push('<rect x="44" y="44" width="' + (WIDTH - 88) + '" height="' + (HEIGHT - 88) + '" rx="36" fill="#2d1600"/>')
    parts.push('<rect x="120" y="58" width="' + (WIDTH - 240) + '" height="86" rx="20" fill="#ffd60a"/>')
    parts.push('<text x="' + WIDTH / 2 + '" y="116" font-size="56" font-family="sans-serif" font-weight="bold" fill="#3a1d00" text-anchor="middle" dominant-baseline="central">IZUKU SLOTS</text>')
    parts.push('<rect x="' + (PAD_X - 30) + '" y="' + (PAD_Y - 40) + '" width="' + (CELL * COLS + 60) + '" height="' + (CELL * ROWS + 80) + '" rx="28" fill="#050505" stroke="#7a5200" stroke-width="6"/>')
    for (let c = 1; c < COLS; c += 1) {
        const x = PAD_X + c * CELL
        parts.push('<rect x="' + (x - 4) + '" y="' + (PAD_Y - 30) + '" width="8" height="' + (CELL * ROWS + 60) + '" fill="#7a5200"/>')
    }

    grid.forEach((_row, r) => {
        const y = PAD_Y + r * CELL
        if (winners.includes(r)) {
            parts.push('<rect x="' + (PAD_X - 16) + '" y="' + (y - 6) + '" width="' + (CELL * COLS + 32) + '" height="' + (CELL + 12) + '" rx="14" fill="none" stroke="#30d158" stroke-width="8"/>')
        }
    })

    if (jackpot) {
        parts.push('<rect x="44" y="44" width="' + (WIDTH - 88) + '" height="' + (HEIGHT - 88) + '" rx="36" fill="#ffd60a" opacity="0.12"/>')
        parts.push('<text x="' + WIDTH / 2 + '" y="' + (HEIGHT - 80) + '" font-size="52" font-family="sans-serif" font-weight="bold" fill="#ffd60a" text-anchor="middle" dominant-baseline="central">JACKPOT</text>')
    }

    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT + '">',
        '<rect width="' + WIDTH + '" height="' + HEIGHT + '" fill="#000000"/>',
        ...parts,
        '</svg>',
    ].join('')

    const base = sharp(Buffer.from(svg))
    const overlays = await Promise.all(
        grid.flatMap((row, r) =>
            row.map(async (sym, c) => ({
                input: await symbolPng(sym),
                left: Math.round(PAD_X + c * CELL + (CELL - SYM_SIZE) / 2),
                top: Math.round(PAD_Y + r * CELL + (CELL - SYM_SIZE) / 2),
            })),
        ),
    )
    const usable = overlays.filter((o): o is { input: Buffer; left: number; top: number } => !!o.input)
    if (usable.length) return base.composite(usable).png().toBuffer()
    return base.png().toBuffer()
}

// Mines board image, same look as the ttt board: pure-black canvas, 5x5
// tiles. Hidden tiles show their pick number, safe picks show a gem, bombs
// show the mine.
import sharp from 'sharp'
import type { MineGame } from './mine.js'

const SIZE = 900
const MARGIN = 70
const CELLS = 5
const CELL = (SIZE - MARGIN * 2) / CELLS

export function renderMineImage(game: MineGame, reveal: boolean): Promise<Buffer> {
    const parts: string[] = []

    for (let i = 0; i < CELLS; i += 1) {
        const line = MARGIN + CELL * i
        parts.push(`<line x1="${line}" y1="${MARGIN}" x2="${line}" y2="${SIZE - MARGIN}" stroke="#1c1c1e" stroke-width="5"/>`)
        parts.push(`<line x1="${MARGIN}" y1="${line}" x2="${SIZE - MARGIN}" y2="${line}" stroke="#1c1c1e" stroke-width="5"/>`)
    }

    for (let index = 0; index < 25; index += 1) {
        const cx = MARGIN + CELL * (index % CELLS) + CELL / 2
        const cy = MARGIN + CELL * Math.floor(index / CELLS) + CELL / 2
        const revealed = game.picked.includes(index)
        const isBomb = game.bombs.includes(index)
        const showBomb = reveal && isBomb

        let fill = '#0d0d0f'
        let label = String(index + 1)
        let emoji = false
        let fontSize = 58
        if (showBomb) {
            fill = '#3a1215'
            label = '💣'
            emoji = true
            fontSize = 96
        } else if (revealed) {
            fill = '#0f2a1a'
            label = '💎'
            emoji = true
            fontSize = 96
        }

        parts.push(
            `<rect x="${cx - CELL / 2 + 8}" y="${cy - CELL / 2 + 8}" width="${CELL - 16}" height="${CELL - 16}" rx="20" fill="${fill}" stroke="#2c2c2e" stroke-width="2"/>`,
        )
        parts.push(
            `<text x="${cx}" y="${cy}" font-size="${fontSize}" font-family="${emoji ? 'Noto Color Emoji' : 'sans-serif'}" fill="${emoji ? '#ffffff' : '#636366'}" text-anchor="middle" dominant-baseline="central">${label}</text>`,
        )
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">`,
        `<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>`,
        ...parts,
        '</svg>',
    ].join('')

    return sharp(Buffer.from(svg)).png().toBuffer()
}

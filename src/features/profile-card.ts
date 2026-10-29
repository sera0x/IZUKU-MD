import sharp from 'sharp'

/**
 * AMOLED profile card. The text caption carries every value too, so the
 * dashboard is a presentation layer only: if sharp ever fails the command
 * still works.
 */
export interface ProfileGameLine {
    label: string
    wins: number
    losses: number
    draws: number
}

export interface ProfileMarriage {
    name: string
    series: string
    imageUrl: string
}

export interface ProfileCardData {
    name: string
    number: string
    role: string
    wins: number
    losses: number
    draws: number
    played: number
    winRate: number
    streak: number
    best: number
    rank: number
    coins: number
    cardsUnique: number
    cardsTotal: number
    level: number
    levelCurrent: number
    levelNeeded: number
    chatRank: string
    topCard: string
    games: ProfileGameLine[]
}

const WIDTH = 1080
const HEIGHT = 1350

const escapeXml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')

const short = (value: string, max = 26): string =>
    value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

const text = (
    x: number,
    y: number,
    value: string,
    size: number,
    fill: string,
    weight = 400,
    anchor = 'start',
): string =>
    `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`

const panel = (x: number, y: number, w: number, h: number, stroke = '#242428'): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#0b0b0d" stroke="${stroke}" stroke-width="3"/>`

export async function renderProfileCard(data: ProfileCardData, marriage?: ProfileMarriage | null): Promise<Buffer> {
    const parts: string[] = []
    parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#000000"/>`)

    // Header
    parts.push(text(72, 92, 'PLAYER PROFILE', 30, '#8e8e93', 700))
    parts.push(text(72, 180, short(data.name, 22), 68, '#ffffff', 800))
    parts.push(text(72, 232, `+${data.number}  ·  ${data.role}`, 30, '#8e8e93', 400))

    // Rank badge
    parts.push(`<circle cx="918" cy="150" r="104" fill="#0b0b0d" stroke="#7c5cff" stroke-width="6"/>`)
    parts.push(text(918, 128, 'RANK', 24, '#8e8e93', 700, 'middle'))
    parts.push(text(918, 190, data.rank > 0 ? `#${data.rank}` : '—', 54, '#ffffff', 800, 'middle'))

    // Win / loss / draw boxes
    const boxes: Array<{ x: number; label: string; value: number; color: string }> = [
        { x: 72, label: 'WINS', value: data.wins, color: '#30d158' },
        { x: 390, label: 'LOSSES', value: data.losses, color: '#ff453a' },
        { x: 708, label: 'DRAWS', value: data.draws, color: '#ffd60a' },
    ]
    for (const box of boxes) {
        parts.push(panel(box.x, 300, 300, 150))
        parts.push(text(box.x + 30, 350, box.label, 24, '#8e8e93', 700))
        parts.push(text(box.x + 30, 420, String(box.value), 58, box.color, 800))
    }

    // Streak + win rate
    parts.push(panel(72, 480, 462, 118))
    parts.push(text(102, 526, 'STREAK', 22, '#8e8e93', 700))
    parts.push(
        text(
            102,
            574,
            `${data.streak}${data.best > 0 ? `  ·  best ${data.best}` : ''}`,
            40,
            '#ff9f0a',
            800,
        ),
    )
    parts.push(panel(546, 480, 462, 118))
    parts.push(text(576, 526, 'WIN RATE', 22, '#8e8e93', 700))
    parts.push(text(576, 574, `${data.winRate}%`, 40, '#64d2ff', 800))

    // Per-game record
    parts.push(text(72, 664, 'GAME RECORD', 26, '#8e8e93', 700))
    const games = data.games.slice(0, 3)
    if (games.length === 0) {
        parts.push(text(72, 724, 'No finished games yet.', 32, '#636366', 400))
    } else {
        games.forEach((game, index) => {
            const y = 700 + index * 78
            parts.push(panel(72, y, 936, 62, '#1c1c1e'))
            parts.push(text(102, y + 41, short(game.label, 30), 30, '#ffffff', 600))
            parts.push(
                text(
                    978,
                    y + 41,
                    `${game.wins}W  ${game.losses}L  ${game.draws}D`,
                    28,
                    '#c7c7cc',
                    600,
                    'end',
                ),
            )
        })
    }

    // Collection / economy / activity
    const bottomY = 960
    parts.push(panel(72, bottomY, 300, 130))
    parts.push(text(102, bottomY + 44, 'COINS', 22, '#8e8e93', 700))
    parts.push(text(102, bottomY + 98, data.coins.toLocaleString('en-US'), 40, '#ffd60a', 800))

    parts.push(panel(390, bottomY, 300, 130))
    parts.push(text(420, bottomY + 44, 'CARDS', 22, '#8e8e93', 700))
    parts.push(text(420, bottomY + 98, `${data.cardsUnique} / ${data.cardsTotal}`, 40, '#bf5af2', 800))

    parts.push(panel(708, bottomY, 300, 130))
    parts.push(text(738, bottomY + 44, 'CHAT LEVEL', 22, '#8e8e93', 700))
    parts.push(text(738, bottomY + 98, `${data.level}`, 40, '#30d158', 800))
    parts.push(
        text(
            738,
            bottomY + 128,
            `${data.levelCurrent}/${data.levelNeeded} xp  ·  ${data.chatRank}`,
            20,
            '#636366',
            400,
        ),
    )

    // Best card + marriage + footer
    parts.push(panel(72, 1120, 600, 108))
    parts.push(text(102, 1164, 'BEST CARD', 22, '#8e8e93', 700))
    parts.push(text(102, 1204, short(data.topCard || 'No cards yet', 34), 30, '#ffffff', 600))

    if (marriage) {
        parts.push(panel(690, 1120, 318, 108, '#7c5cff'))
        parts.push(text(714, 1150, 'MARRIED TO', 20, '#b7a8ff', 700))
        parts.push(text(714, 1188, short(marriage.name, 12), 28, '#ffffff', 800))
        parts.push(text(714, 1214, short(marriage.series, 13), 20, '#8e8e93', 500))
    }

    parts.push(text(540, 1290, 'IZUKU', 26, '#3a3a3c', 800, 'middle'))

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`,
        ...parts,
        '</svg>',
    ].join('')

    // Wife portrait composited beside the marriage panel. If the fetch or the
    // composite fails the card still renders, just without the photo.
    let wifePhoto: Buffer | undefined
    if (marriage?.imageUrl) {
        try {
            const response = await fetch(marriage.imageUrl, { signal: AbortSignal.timeout(8000) })
            if (response.ok) {
                wifePhoto = await sharp(Buffer.from(await response.arrayBuffer()))
                    .resize(96, 96, { fit: 'cover' })
                    .png()
                    .toBuffer()
            }
        } catch {
            wifePhoto = undefined
        }
    }

    const base = sharp(Buffer.from(svg))
    if (wifePhoto) {
        base.composite([{ input: wifePhoto, left: 900, top: 1044 }])
    }
    return base.png().toBuffer()
}

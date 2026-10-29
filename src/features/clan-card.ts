import sharp from 'sharp'

// AMOLED clan card, same family as the profile card. The caption already
// carries every value, so a failed render never blocks the command.
export interface ClanCardData {
    tag: string
    name: string
    leader: string
    officers: string[]
    memberCount: number
    maxMembers: number
    created: string
    topMembers: Array<{ name: string; role: string }>
    bio?: string | null
}

const WIDTH = 1080
const HEIGHT = 800

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

export async function renderClanCard(data: ClanCardData): Promise<Buffer> {
    const parts: string[] = []
    parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#000000"/>`)

    // Banner
    parts.push(`<rect x="0" y="0" width="${WIDTH}" height="180" fill="#0b0b0d"/>`)
    parts.push(`<rect x="0" y="177" width="${WIDTH}" height="6" fill="#7c5cff"/>`)
    parts.push(text(72, 88, data.tag, 34, '#7c5cff', 800))
    parts.push(text(72, 146, short(data.name, 24), 64, '#ffffff', 800))
    parts.push(text(1008, 110, `${data.memberCount}/${data.maxMembers}`, 44, '#8e8e93', 800, 'end'))
    parts.push(text(1008, 150, 'MEMBERS', 22, '#636366', 700, 'end'))

    // Bio (optional, shifts everything below when present)
    let cursor = 240
    if (data.bio) {
        parts.push(panel(72, cursor, 936, 110))
        parts.push(text(102, cursor + 42, 'BIO', 22, '#8e8e93', 700))
        parts.push(text(102, cursor + 88, short(data.bio, 90), 30, '#d1fae0', 500))
        cursor += 150
    }

    // Leader panel
    parts.push(panel(72, cursor, 936, 130))
    parts.push(text(102, cursor + 48, 'LEADER', 22, '#8e8e93', 700))
    parts.push(text(102, cursor + 102, short(data.leader, 30), 42, '#ffd60a', 800))
    cursor += 160

    // Officers panel
    parts.push(panel(72, cursor, 936, 130))
    parts.push(text(102, cursor + 48, 'OFFICERS', 22, '#8e8e93', 700))
    const officers = data.officers.length ? data.officers.slice(0, 2).map((o) => short(o, 20)).join('  ·  ') : 'none'
    parts.push(text(102, cursor + 102, officers, 34, data.officers.length ? '#ffffff' : '#636366', 600))
    cursor += 160

    // Roster preview
    parts.push(text(72, cursor + 56, 'TOP MEMBERS', 22, '#8e8e93', 700))
    const roster = data.topMembers.slice(0, 2)
    if (!roster.length) {
        parts.push(text(72, cursor + 108, 'No members yet.', 30, '#636366', 400))
    } else {
        roster.forEach((member, index) => {
            const y = cursor + 100 + index * 62
            parts.push(panel(72, y - 36, 936, 54, '#1c1c1e'))
            parts.push(text(102, y, `${member.role === 'leader' ? '👑' : '⭐'} ${short(member.name, 30)}`, 28, '#ffffff', 600))
        })
    }

    parts.push(text(72, 780, `FOUNDED ${data.created}`, 22, '#48484a', 500))
    parts.push(text(540, 780, 'IZUKU', 26, '#3a3a3c', 800, 'middle'))

    const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`, ...parts, '</svg>'].join('')
    return sharp(Buffer.from(svg)).png().toBuffer()
}

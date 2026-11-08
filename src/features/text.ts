const SMALL_CAPS: Record<string, string> = {
    a: 'ᴀ',
    b: 'ʙ',
    c: 'ᴄ',
    d: 'ᴅ',
    e: 'ᴇ',
    f: 'ꜰ',
    g: 'ɢ',
    h: 'ʜ',
    i: 'ɪ',
    j: 'ᴊ',
    k: 'ᴋ',
    l: 'ʟ',
    m: 'ᴍ',
    n: 'ɴ',
    o: 'ᴏ',
    p: 'ᴘ',
    q: 'ǫ',
    r: 'ʀ',
    s: 'ꜱ',
    t: 'ᴛ',
    u: 'ᴜ',
    v: 'ᴠ',
    w: 'ᴡ',
    x: 'x',
    y: 'ʏ',
    z: 'ᴢ',
}

export const smallCaps = (value: string): string =>
    value.toLowerCase().replace(/[a-z]/g, (character) => SMALL_CAPS[character] ?? character)

export const boxBottom = (top: string, character = '─'): string =>
    `╰${character.repeat(Math.max(0, [...top.replace(/\*/g, '')].length - 1))}`

export const cleanGroupName = (subject: string): string =>
    subject.replace(/\s+\d{7,15}$/, '').trim() || subject

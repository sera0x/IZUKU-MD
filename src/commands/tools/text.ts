import { ari } from '../../bot/registry.js'

const FLIPPED: Record<string, string> = {
    a: 'ɐ',
    b: 'q',
    c: 'ɔ',
    d: 'p',
    e: 'ǝ',
    f: 'ɟ',
    g: 'ƃ',
    h: 'ɥ',
    i: 'ᴉ',
    j: 'ɾ',
    k: 'ʞ',
    l: 'l',
    m: 'ɯ',
    n: 'u',
    o: 'o',
    p: 'd',
    q: 'b',
    r: 'ɹ',
    s: 's',
    t: 'ʇ',
    u: 'n',
    v: 'ʌ',
    w: 'ʍ',
    x: 'x',
    y: 'ʎ',
    z: 'z',
    '?': '¿',
    '!': '¡',
    '.': '˙',
    ',': "'",
    "'": ',',
}

const flip = (text: string): string =>
    [...text.toLowerCase()]
        .reverse()
        .map((character) => FLIPPED[character] ?? character)
        .join('')

ari({
    name: 'fliptext',
    description: 'Flip text upside down',
    category: 'tools',
    usage: 'fliptext hello',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply(`Usage: ${ctx.prefix}fliptext hello`)
            return
        }
        await ctx.reply(flip(ctx.text))
    },
})

ari({
    name: 'mock',
    description: 'Mock a piece of text',
    category: 'tools',
    usage: 'mock hello there',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply(`Usage: ${ctx.prefix}mock hello there`)
            return
        }
        await ctx.reply(
            [...ctx.text]
                .map((character, index) => (index % 2 ? character.toUpperCase() : character.toLowerCase()))
                .join(''),
        )
    },
})

ari({
    name: 'reverse',
    description: 'Reverse a piece of text',
    category: 'tools',
    usage: 'reverse hello there',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply(`Usage: ${ctx.prefix}reverse hello there`)
            return
        }
        // Array.from keeps emoji and accented characters intact instead of
        // ripping their surrogate pairs apart.
        await ctx.reply(Array.from(ctx.text).reverse().join(''))
    },
})

ari({
    name: 'spoiler',
    description: 'Hide text behind a WhatsApp spoiler',
    category: 'tools',
    aliases: ['hide'],
    usage: 'spoiler the butler did it',
    run: async (ctx) => {
        if (!ctx.text) {
            await ctx.reply(`Usage: ${ctx.prefix}spoiler the butler did it`)
            return
        }
        await ctx.reply(`||${ctx.text}||`)
    },
})

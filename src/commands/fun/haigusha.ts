import { ari } from '../../bot/registry.js'
import { fetchRandomCharacter, setSpawn, type HaiguShaCharacter } from '../../features/haigusha.js'
import { fetchMalArt } from '../../features/haigusha-art.js'

const cardCaption = (character: HaiguShaCharacter): string =>
    [
        '\u{1F31A} *Haigusha Spawn*',
        '',
        `*Name* : ${character.name}${character.nameKanji ? ` (${character.nameKanji})` : ''}`,
        `*Series* : ${character.series}`,
        `*Gender* : ${character.gender}`,
        `*Age* : ${character.age}`,
        '',
        character.about || 'No info available.',
        '',
        '\u25B8 Reply *.marry* within 3 minutes to marry them',
    ].join('\n')

ari({
    name: 'haigusha',
    description: 'Spawn a random anime character to marry',
    category: 'fun',
    usage: 'haigusha',
    cooldownMs: 5000,
    run: async (ctx) => {
        const character = await fetchRandomCharacter()
        if (!character) {
            await ctx.reply('The character API did not answer, try again later \u{1F327}\uFE0F')
            return
        }
        setSpawn(ctx.chat, character)
        // MAL 1000x1400 character art only: the free database with the best visuals.
        const art = await fetchMalArt(character.name, character.series, character.seriesEn, character.nameKanji, character.nameAlts)
        if (!art) {
            await ctx.reply('Couldn\u2019t load that character\u2019s art, try .haigusha again \u{1F327}\uFE0F')
            return
        }
        await ctx.replyImageBuffer(art, cardCaption(character))
    },
})

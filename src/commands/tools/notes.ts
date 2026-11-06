import { db } from '../../db/index.js'
import { ari } from '../../bot/registry.js'
import { setPrompt } from '../../features/prompts.js'

function listNotes(ctx: { chat: string }): string {
    const notes = db.notes(ctx.chat)
    if (!notes.length) return 'No notes yet.'
    return notes.map((note) => `${note.id}. ${note.body}`).join('\n')
}

ari({
    name: 'note',
    description: 'Save a note, or start a new note prompt',
    category: 'tools',
    usage: 'note [text] | note list | note del <id> | note clear',
    run: async (ctx) => {
        const [action, id] = ctx.args

        if (action === 'list') {
            await ctx.reply(listNotes(ctx))
            return
        }

        if (action === 'del' || action === 'delete') {
            const number = Number.parseInt(id ?? '', 10)
            if (!Number.isFinite(number)) {
                await ctx.reply(`Usage: ${ctx.prefix}note del 3`)
                return
            }
            const removed = db.removeNote(ctx.chat, number)
            await ctx.reply(removed ? 'Note deleted ✅' : 'Note not found 🛑')
            return
        }

        if (action === 'clear') {
            db.clearNotes(ctx.chat)
            await ctx.reply('Notes cleared ✅')
            return
        }

        if (!ctx.text.trim()) {
            setPrompt(ctx.chat, ctx.sender, async (input) => {
                const body = input.text.trim()
                if (!body || body.toLowerCase() === 'cancel') {
                    await input.reply('Note cancelled 🛑')
                    return
                }
                const note = db.addNote(input.chat, input.sender, body)
                await input.reply(`Note ${note.id} saved ✅`)
            })
            await ctx.reply('Send the note text now. Type cancel to stop.')
            return
        }

        const note = db.addNote(ctx.chat, ctx.sender, ctx.text.trim())
        await ctx.reply(`Note ${note.id} saved ✅`)
    },
})

ari({
    name: 'notes',
    description: 'List saved notes',
    category: 'tools',
    aliases: ['allnotes'],
    run: async (ctx) => {
        await ctx.reply(listNotes(ctx))
    },
})

import { ari } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { sendWildSpawn } from '../../features/poke-scheduler.js'

// Mods and owner: spawn a wild pokemon right now. Only in groups activated with
// .agb live or .agb poke (db.gameActive). Hidden from the menu.
ari({
    name: 'pspawn',
    description: 'Spawn a wild pokemon in this group now (owner/mod, hidden)',
    category: 'fun',
    usage: 'pspawn',
    modOk: true,
    hidden: true,
    run: async (ctx) => {
        if (!ctx.isGroup) {
            await ctx.reply('Run this in a group. 🛑')
            return
        }
        if (!db.gameActive(ctx.chat)) {
            await ctx.reply('Activate the group first with .agb live or .agb poke. 🛑')
            return
        }
        const sent = await sendWildSpawn(ctx.sock, ctx.chat)
        if (!sent) await ctx.reply('Could not spawn a pokemon right now, try again. 🛑')
    },
})

import { jidNormalizedUser } from 'baileys'
import { db } from '../db/index.js'
import { phoneDigitsFor } from '../bot/identity.js'

/**
 * Contact-name cache.
 *
 * The legacy bot kept every contact name from `contacts.upsert/update` and
 * used it in `getName`. Without it, a command like `.ban` can only name a
 * user who has already spoken or whose group metadata has been fetched.
 */

interface ContactLike {
    id?: string
    name?: string
    notify?: string
    verifiedName?: string
}

export function rememberContacts(contacts: readonly ContactLike[]): void {
    for (const contact of contacts) {
        if (!contact.id) continue

        const jid = jidNormalizedUser(contact.id)
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue

        // Levanter-style: only the user's OWN pushname (`notify`). The
        // address-book name is private to the phone owner and must not leak
        // into what the bot calls people.
        const name = (contact.notify || '').trim()
        if (!name) continue

        db.user(jid, name)

        // Lookups by phone number should find an @lid-only contact too.
        if (jid.endsWith('@lid')) {
            const digits = phoneDigitsFor(jid)
            if (digits) db.user(`${digits}@s.whatsapp.net`, name)
        }
    }
}

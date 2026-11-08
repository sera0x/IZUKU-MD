import { jidNormalizedUser } from 'baileys'
import { db } from '../db/index.js'
import { phoneDigitsFor } from '../bot/identity.js'

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

        const name = (contact.notify || '').trim()
        if (!name) continue

        db.user(jid, name)

        if (jid.endsWith('@lid')) {
            const digits = phoneDigitsFor(jid)
            if (digits) db.user(`${digits}@s.whatsapp.net`, name)
        }
    }
}

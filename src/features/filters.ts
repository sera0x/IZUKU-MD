import { db } from '../db/index.js'
import type { FilterRow } from '../db/index.js'

export const MIN_TRIGGER_LENGTH = 2

export function matchFilter(chat: string, text: string): FilterRow | null {
    if (!text) return null
    const lowered = text.toLowerCase()
    for (const filter of db.filters(chat)) {
        if (lowered.includes(filter.trigger)) return filter
    }
    return null
}

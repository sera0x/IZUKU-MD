import { db } from '../db/index.js'
import { money } from './economy.js'
import { weekKey } from './mine.js'

export const CLAN_MAX_MEMBERS = 10

export interface UpkeepReport {
    week: string
    paid: string[]
    failed: Array<{ name: string; moved: number; unplaced: number; into: string[] }>
}

/**
 * Sunday settle. Each clan pays the upkeep from its treasury. A clan that cannot
 * pay is dissolved and its members are moved to clans with room (or removed if none).
 * Returns what happened so the caller can send the group notice.
 */
export function runClanUpkeep(now = new Date()): UpkeepReport {
    const report: UpkeepReport = { week: weekKey(now), paid: [], failed: [] }
    const upkeep = db.clanUpkeep()
    for (const clan of db.clanList()) {
        if (db.payClanUpkeep(clan.id, upkeep)) {
            report.paid.push(clan.name)
            continue
        }
        const res = db.reassignClan(clan.id, CLAN_MAX_MEMBERS)
        report.failed.push({ name: clan.name, ...res })
    }
    return report
}

export function upkeepNotice(r: UpkeepReport): string {
    if (r.failed.length === 0) return `🏦 clan upkeep paid for ${r.week}`
    const lines = r.failed.map((f) => `${f.name} folded. ${f.moved} moved${f.into.length ? ` into ${f.into.join(', ')}` : ''}${f.unplaced ? `, ${f.unplaced} left with no clan` : ''}`)
    return `🛑 clan upkeep missed for ${r.week}\n${lines.join('\n')}`
}

export { money }

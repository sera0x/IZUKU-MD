import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GroupMetadata, WASocket } from 'baileys'
import sharp from 'sharp'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'
import { jidToNumber } from '../bot/helpers.js'
import { db } from '../db/index.js'
import { cleanGroupName } from './text.js'

const log = createLogger(config.logLevel, { scope: 'welcome' })

const DATA_DIR = '/root/izuku/data'
const WELCOME_BG = join(DATA_DIR, 'welcome_bg.png')
const GOODBYE_BG = join(DATA_DIR, 'goodbye_bg.png')
const WIDTH = 1080
const HEIGHT = 1350

type Participant = string | { id: string; lid?: string; phoneNumber?: string }
interface Update {
    id: string
    participants: Participant[]
    action: string
}

const participantId = (entry: Participant): string => (typeof entry === 'string' ? entry : entry.id)

const escapeXml = (value: string): string =>
    value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch)

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

// Pure #000 base. Falls back to an in-memory black canvas if the bg file is missing.
async function background(path: string): Promise<Buffer> {
    if (existsSync(path)) return sharp(path).resize(WIDTH, HEIGHT).png().toBuffer()
    return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#000000' } }).png().toBuffer()
}

async function renderCard(kind: 'WELCOME' | 'GOODBYE', name: string, group: string): Promise<Buffer> {
    const bg = await background(kind === 'WELCOME' ? WELCOME_BG : GOODBYE_BG)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <style>
    text { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 700; fill: #ffffff; text-anchor: middle; }
  </style>
  <text x="540" y="640" font-size="150" letter-spacing="6">${kind}</text>
  <text x="540" y="760" font-size="78">${escapeXml(clip(name, 26))}</text>
  <text x="540" y="850" font-size="46">${escapeXml(clip(group, 34))}</text>
</svg>`
    return sharp(bg)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()
}

/**
 * Sends the welcome (add) or goodbye (remove) image card to the group.
 * Called from the group-participants.update handler after the guard checks.
 */
export async function sendParticipantCards(
    sock: WASocket,
    update: Update,
    metadata: GroupMetadata,
): Promise<void> {
    if (!config.features.welcomeCard) return
    const action = update.action
    if (action !== 'add' && action !== 'remove') return
    // Standing rule: no welcome/goodbye in any group without an active .agb live record.
    if (!db.gameActive(update.id)) return

    const group = cleanGroupName(metadata.subject ?? '') || 'this group'
    const kind = action === 'add' ? 'WELCOME' : 'GOODBYE'
    const ids = update.participants.map(participantId)

    for (const jid of ids) {
        // Prefer a real name: lid -> pn mapping, then the stored pushname.
        const displayName = await (async (): Promise<string> => {
            try {
                if (jid.endsWith('@lid')) {
                    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null)
                    if (pn) {
                        const row = db.user(pn)
                        if (row?.name && !/^\d+$/.test(row.name)) return row.name
                    }
                }
                const row = db.user(jid)
                if (row?.name && !/^\d+$/.test(row.name)) return row.name
            } catch {
                /* fall through to the number */
            }
            return ''
        })()
        const number = jid.endsWith('@lid')
            ? (await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null))?.split('@')[0] ?? jidToNumber(jid)
            : jidToNumber(jid)
        const card = await renderCard(kind, displayName ? `@${displayName}` : `@${number}`, group).catch((error: Error) => {
            log.warn('card render failed: %s', error.message)
            return undefined
        })
        if (!card) continue

        // WhatsApp needs a file path/url for the image; write a temp copy and drop it after send.
        const path = join(DATA_DIR, `card_${kind.toLowerCase()}_${Date.now()}_${number}.png`)
        writeFileSync(path, card)
        // Proper WhatsApp mention: caption must write @<phone_number>
        // and mentions array must carry the exact phone JID so WhatsApp
        // turns it into a clickable blue tag showing their saved/push name.
        const resolvedPn = jid.endsWith('@lid')
            ? await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null)
            : jid
        const tagJid = (resolvedPn ?? jid).split(':')[0] ?? jid
        const tagNumber = tagJid.split('@')[0]
        const mentionJids = [tagJid, jid].filter((j, idx, arr) => arr.indexOf(j) === idx)

        const memberCount = metadata?.participants?.length ?? 1

        const caption =
            action === 'add'
                ? `👋 *@${tagNumber}* just landed in *${group}*\n\nmember #${memberCount}. say hi, check the rules, settle in. 🟩`
                : `*Goodbye @${tagNumber}* 👋\n\nThey left *${group}*.\nUntil we meet again, wishing you the best! 🕊️`
        try {
            await sock.sendMessage(update.id, { image: { url: path }, caption, mentions: mentionJids } as never)
        } catch (error) {
            log.warn('card send failed: %s', (error as Error).message)
        } finally {
            try {
                unlinkSync(path)
            } catch {
                /* ignore */
            }
        }
    }
}

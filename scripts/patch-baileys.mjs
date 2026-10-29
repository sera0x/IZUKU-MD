import { readFileSync, writeFileSync } from 'node:fs'

/**
 * One-tick patch for Baileys.
 *
 * Baileys acknowledges every incoming message with a `receipt` node, which is
 * what turns the sender's single tick into two grey ticks. The one-tick mode
 * wants messages to stay un-acknowledged (delivered = false), so:
 *
 *   1. the receipt type is forced to `inactive` (Baileys' "not delivered" hint)
 *   2. the receipt itself is skipped entirely while `__IZUKU_ONE_TICK__` is on,
 *      because some server versions still treat an `inactive` receipt as a
 *      delivery.
 *
 * The transport-level <ack> is still sent, so WhatsApp does not retry the
 * message. Both steps are guarded by a marker and safe to re-run after an
 * `npm install`.
 */

const file = new URL('../node_modules/baileys/lib/Socket/messages-recv.js', import.meta.url)

const TYPE_MARKER = '__IZUKU_ONE_TICK__'
const SKIP_MARKER = '__IZUKU_ONE_TICK_SKIP__'

const TYPE_NEEDLE = 'else if (!sendActiveReceipts) {'
const TYPE_REPLACEMENT = `else if (!sendActiveReceipts || globalThis.${TYPE_MARKER} === true) {`

const INDENT = ' '.repeat(24)
const SKIP_NEEDLE = [
    `${INDENT}acked = true;`,
    `${INDENT}await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);`,
].join('\n')
const SKIP_REPLACEMENT = [
    `${INDENT}acked = true;`,
    `${INDENT}// ${SKIP_MARKER}: keep the sender on one tick.`,
    `${INDENT}if (globalThis.${TYPE_MARKER} !== true) {`,
    `${INDENT}    await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);`,
    `${INDENT}}`,
].join('\n')

try {
    let source = readFileSync(file, 'utf8')
    let changed = false

    if (!source.includes(`globalThis.${TYPE_MARKER} === true`)) {
        if (source.includes(TYPE_NEEDLE)) {
            source = source.replace(TYPE_NEEDLE, TYPE_REPLACEMENT)
            changed = true
        } else {
            console.warn('Baileys one-tick patch: receipt type block not found')
        }
    }

    if (!source.includes(SKIP_MARKER)) {
        if (source.includes(SKIP_NEEDLE)) {
            source = source.replace(SKIP_NEEDLE, SKIP_REPLACEMENT)
            changed = true
        } else {
            console.warn('Baileys one-tick patch: receipt call block not found')
        }
    }

    if (!changed) {
        console.log('Baileys one-tick patch already applied')
        process.exit(0)
    }

    writeFileSync(file, source)
    console.log('Baileys one-tick patch applied')
} catch (error) {
    console.warn(`Baileys one-tick patch skipped: ${error instanceof Error ? error.message : String(error)}`)
}

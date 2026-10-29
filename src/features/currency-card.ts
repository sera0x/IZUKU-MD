import sharp from 'sharp'
import { CURRENCY_SYMBOL } from './economy.js'

/**
 * Small square currency icon used as the link-preview thumbnail on balance
 * messages. Rendered once, then reused for every wallet card.
 */
let cached: Buffer | null = null

export async function currencyIcon(): Promise<Buffer> {
    if (cached) return cached

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <defs>
        <linearGradient id="coin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7d774"/>
            <stop offset="55%" stop-color="#d9a441"/>
            <stop offset="100%" stop-color="#8a6220"/>
        </linearGradient>
        <radialGradient id="shine" cx="34%" cy="26%" r="72%">
            <stop offset="0%" stop-color="#fff8dc" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#fff8dc" stop-opacity="0"/>
        </radialGradient>
    </defs>
    <rect width="240" height="240" fill="#0b0b0c"/>
    <circle cx="120" cy="120" r="96" fill="url(#coin)" stroke="#5c3f10" stroke-width="6"/>
    <circle cx="120" cy="120" r="78" fill="none" stroke="#5c3f10" stroke-opacity="0.45" stroke-width="3"/>
    <ellipse cx="120" cy="120" rx="96" ry="96" fill="url(#shine)"/>
    <text x="120" y="154" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="108" font-weight="bold" fill="#4a3208">${CURRENCY_SYMBOL}</text>
</svg>`

    cached = await sharp(Buffer.from(svg)).flatten({ background: '#0b0b0c' }).jpeg({ quality: 88 }).toBuffer()
    return cached
}

/**
 * Wallet/vault text. WhatsApp shows an externalAdReply card only in the
 * notification and keeps the chat bubble empty on this build, so the card is
 * not attempted any more: the text is what the user actually reads.
 */
export async function sendCurrencyCard(
    ctx: { reply: (content: string) => Promise<unknown> },
    text: string,
    meta?: { title?: string; body?: string },
): Promise<void> {
    void meta
    await ctx.reply(text)
}

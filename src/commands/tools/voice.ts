import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ari } from '../../bot/registry.js'
import {
    FFMPEG,
    convert,
    downloadMedia,
    extractText,
    quotedContext,
    unwrapMessage,
} from '../../bot/helpers.js'
import { createLogger } from '../../logger.js'
import { config } from '../../config.js'

const exec = promisify(execFile)
const log = createLogger(config.logLevel, { scope: 'voice' })

const STT_PYTHON = '/root/stt-venv/bin/python'
const STT_SCRIPT = '/root/izuku/scripts/stt.py'
const STT_MODEL = 'base'
const MAX_VTS_SECONDS = 300
const MAX_TTS_CHARS = 1000
const TTS_CHUNK_CHARS = 190
const TTS_LANG = 'en'

interface SttResult {
    text: string
    lang: string
    prob: number
    secs: number
}

/** Split text at sentence ends into chunks the free TTS endpoint accepts. */
function splitForTts(text: string, max: number): string[] {
    const sentences = text.match(/[^.!?\n]+[.!?]*\s*|[.!?\n]+/g) ?? [text]
    const chunks: string[] = []
    let current = ''
    for (const raw of sentences) {
        let piece = raw.trim()
        if (!piece) continue
        while (piece.length > max) {
            const cut = piece.lastIndexOf(' ', max)
            const at = cut > 0 ? cut : max
            if (current) {
                chunks.push(current)
                current = ''
            }
            chunks.push(piece.slice(0, at).trim())
            piece = piece.slice(at).trim()
        }
        if (current && current.length + piece.length + 1 > max) {
            chunks.push(current)
            current = piece
        } else {
            current = current ? `${current} ${piece}` : piece
        }
    }
    if (current) chunks.push(current)
    return chunks
}

async function fetchTtsChunk(chunk: string): Promise<Buffer> {
    const url =
        'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob' +
        `&tl=${TTS_LANG}&q=${encodeURIComponent(chunk)}`
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`tts http ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
}

async function speakToOpus(text: string): Promise<Buffer> {
    const parts: Buffer[] = []
    for (const chunk of splitForTts(text, TTS_CHUNK_CHARS)) {
        parts.push(await fetchTtsChunk(chunk))
    }
    const mp3 = Buffer.concat(parts)
    if (mp3.length < 200) throw new Error('tts returned no audio')
    return convert(mp3, 'mp3', 'ogg', ['-vn', '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000'])
}

async function transcribe(ogg: Buffer): Promise<SttResult> {
    const dir = await mkdtemp(join(tmpdir(), 'izuku-stt-'))
    const input = join(dir, 'input.ogg')
    const wav = join(dir, 'audio.wav')
    try {
        await writeFile(input, ogg)
        await exec(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', wav], {
            maxBuffer: 8 * 1024 * 1024,
        })
        const { stdout } = await exec(STT_PYTHON, [STT_SCRIPT, wav, STT_MODEL], {
            timeout: 120_000,
            maxBuffer: 1024 * 1024,
        })
        const line = stdout.trim().split('\n').pop() ?? ''
        return JSON.parse(line) as SttResult
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

ari({
    name: 'voicetotext',
    aliases: ['vts'],
    description: 'Transcribe a replied-to voice note to text',
    category: 'tools',
    usage: 'reply to a voice note with .vts',
    cooldownMs: 5_000,
    run: async (ctx) => {
        const direct = unwrapMessage(ctx.msg.message)
        const quoted = direct?.audioMessage
            ? direct
            : unwrapMessage(quotedContext(ctx.msg.message)?.quotedMessage)
        if (!quoted?.audioMessage) {
            await ctx.reply(`Reply to a voice note with ${ctx.prefix}vts`)
            return
        }
        const seconds = Number(quoted.audioMessage.seconds ?? 0)
        if (seconds > MAX_VTS_SECONDS) {
            await ctx.reply(`That voice note is over ${MAX_VTS_SECONDS / 60} min, send a shorter one`)
            return
        }

        try {
            const media = await downloadMedia(quoted, 'audio')
            const started = Date.now()
            const result = await transcribe(media.buffer)
            log.info('vts %d bytes -> %d chars in %dms (lang %s)', media.buffer.length, result.text.length, Date.now() - started, result.lang)
            const text = result.text?.trim()
            if (!text) {
                await ctx.reply("couldn't make out any speech in that one")
                return
            }
            await ctx.reply(`${text}\n\n(${result.lang})`)
        } catch (error) {
            log.error('vts failed: %s', error instanceof Error ? error.stack ?? error.message : String(error))
            await ctx.reply("couldn't transcribe that one, try again in a bit")
        }
    },
})

ari({
    name: 'texttovoice',
    aliases: ['tts'],
    description: 'Turn text into a voice note',
    category: 'tools',
    usage: 'tts hello there (or reply to a text with .tts)',
    cooldownMs: 5_000,
    run: async (ctx) => {
        let text = ctx.text.trim()
        if (!text) {
            const quoted = unwrapMessage(quotedContext(ctx.msg.message)?.quotedMessage)
            text = quoted ? extractText(quoted).trim() : ''
        }
        if (!text) {
            await ctx.reply(`Usage: ${ctx.prefix}tts hello there, or reply to a message with ${ctx.prefix}tts`)
            return
        }
        if (text.length > MAX_TTS_CHARS) {
            await ctx.reply(`Keep it under ${MAX_TTS_CHARS} characters`)
            return
        }

        try {
            const started = Date.now()
            const ogg = await speakToOpus(text)
            log.info('tts %d chars -> %d bytes ogg in %dms', text.length, ogg.length, Date.now() - started)
            await ctx.sock.sendMessage(
                ctx.chat,
                { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true },
                { quoted: ctx.msg },
            )
        } catch (error) {
            log.error('tts failed: %s', error instanceof Error ? error.stack ?? error.message : String(error))
            await ctx.reply("couldn't make the voice note, try again in a bit")
        }
    },
})

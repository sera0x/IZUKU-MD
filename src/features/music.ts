import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const MUSIC_MAX_SECONDS = 1200
export const MUSIC_MAX_BYTES = 16 * 1024 * 1024
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp'
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe'

export interface Track {
    buffer: Buffer
    thumb: Buffer | null
    title: string
    artist: string
    duration: number
    bytes: number
    sourceUrl: string
    cleanup: () => Promise<void>
}

function isUrl(input: string): boolean {
    return /^https?:\/\/\S+$/i.test(input.trim())
}

async function probeDuration(file: string): Promise<number> {
    const { stdout } = await exec(FFPROBE_BIN, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ])
    const seconds = Number(String(stdout).trim())
    return Number.isFinite(seconds) ? seconds : 0
}

async function encode(input: string, output: string, bitrate: string): Promise<void> {
    await exec(FFMPEG_BIN, [
        '-y', '-i', input, '-vn', '-t', String(MUSIC_MAX_SECONDS),
        '-c:a', 'libmp3lame', '-b:a', bitrate, '-ac', '2', '-ar', '44100', output,
    ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
}

/**
 * Search (or take a direct URL), download the best audio with yt-dlp,
 * convert to mp3 capped at 20 min and under the WhatsApp size limit.
 * Throws a short human-readable Error on failure. Always call cleanup().
 */
export async function downloadTrack(query: string): Promise<Track> {
    const term = query.trim()
    if (!term) throw new Error('no query')
    const dir = await mkdtemp(join(tmpdir(), 'izuku-play-'))
    const cleanup = () => rm(dir, { recursive: true, force: true })
    try {
        const target = isUrl(term) ? term : `ytsearch1:${term}`
        const base = join(dir, 'src')
        let res: { stdout: string | Buffer } = { stdout: '' }
        try {
            res = await exec(YTDLP, [
                '--no-playlist', '--no-warnings', '--no-progress', '--print-json',
                '-f', 'bestaudio/best',
                '-x', '--audio-format', 'mp3', '--audio-quality', '160K',
                '--max-filesize', '120M',
                '--write-thumbnail', '--convert-thumbnails', 'jpg',
                '-o', `${base}.%(ext)s`,
                target,
            ], { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 })
        } catch (err) {
            const msg = String((err as any)?.stderr || (err as any)?.message || '')
            if (/Unsupported URL|not a valid URL/i.test(msg)) throw new Error('unsupported link')
            if (/Video unavailable|Private video|age/i.test(msg)) throw new Error('track unavailable on youtube')
            throw new Error('no audio found')
        }

        const files = await readdir(dir)
        const thumbFile = files.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        let thumb: Buffer | null = null
        if (thumbFile) {
            try { thumb = await readFile(join(dir, thumbFile)) } catch { thumb = null }
        }
        const audio = files.find((f) => /\.(mp3|m4a|opus|webm|ogg|wav)$/i.test(f) && !f.endsWith('.json'))
        if (!audio) throw new Error('no audio found')
        const raw = join(dir, audio)

        let info: any = {}
        try {
            const line = String(res.stdout).trim().split('\n').filter(Boolean).pop() ?? '{}'
            info = JSON.parse(line)
        } catch { info = {} }
        const rawTitle = cleanTitle(String(info.track || info.title || term), String(info.artist || info.creator || info.uploader || info.channel || '')).slice(0, 120)
        const title = 'Izuku MD - ' + rawTitle
        const artist = String(info.artist || info.creator || info.uploader || info.channel || 'unknown').slice(0, 80)
        const sourceUrl = String(info.webpage_url || target)

        const out = join(dir, 'out.mp3')
        await encode(raw, out, '128k')
        let size = (await stat(out)).size
        if (size > MUSIC_MAX_BYTES) {
            await encode(raw, out, '96k')
            size = (await stat(out)).size
        }
        if (size > MUSIC_MAX_BYTES) {
            await encode(raw, out, '64k')
            size = (await stat(out)).size
        }
        if (size > MUSIC_MAX_BYTES) throw new Error('file too big even after compression')

        const buffer = await readFile(out)
        const duration = await probeDuration(out)
        // remove the big raw source early
        await rm(raw, { force: true })
        return { buffer, thumb, title, artist, duration, bytes: size, sourceUrl, cleanup }
    } catch (err) {
        await cleanup()
        throw err
    }
}

function cleanTitle(title: string, artist: string): string {
    let t = title.trim()
    if (artist && t.toLowerCase().startsWith(artist.toLowerCase() + ' - ')) t = t.slice(artist.length + 3)
    t = t.replace(/\s*[\(\[](official|lyrics?|audio|video|music video|hd|4k|remaster|visualizer)[^\)\]]*[\)\]]/gi, '').trim()
    return t || title.trim()
}

export function fmtDuration(seconds: number): string {
    const s = Math.round(seconds)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
}

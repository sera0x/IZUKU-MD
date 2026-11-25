import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import axiosRaw from 'axios'
const axios = axiosRaw as any

const exec = promisify(execFile)
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp'

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const FORMAT = 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b'

function getVideoId(url: string): string | null {
    const regex =
        /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?/\s]{11})/
    const match = url.match(regex)
    return match ? match[1]! : null
}

function fmtDuration(seconds: number): string {
    const total = Math.round(seconds)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const rest = total % 60
    const pad = (value: number): string => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

interface InfoJson {
    title?: string
    uploader?: string
    channel?: string
    duration?: number
    webpage_url?: string
}

export async function searchYoutube(query: string): Promise<string> {
    const response = await axios.get('https://www.youtube.com/results', {
        params: { search_query: query },
        headers: { 'User-Agent': UA },
        timeout: 25_000,
    })
    const html = String(response.data ?? '')
    const match = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)
    if (!match?.[1]) throw new Error('No YouTube result for that search')
    return `https://www.youtube.com/watch?v=${match[1]}`
}

export async function youtubeDl(url: string) {
    const videoId = getVideoId(url)
    if (!videoId) throw new Error('That is not a YouTube link')

    const dir = await mkdtemp(join(tmpdir(), 'izuku-yt-'))

    try {
        try {
            await exec(
                YTDLP,
                [
                    '--no-playlist',
                    '--no-warnings',
                    '--no-mtime',
                    '--no-progress',
                    '--no-part',
                    '-f',
                    FORMAT,
                    '--merge-output-format',
                    'mp4',
                    '--max-filesize',
                    '60M',
                    '--write-info-json',
                    '-o',
                    join(dir, 'video.%(ext)s'),
                    `https://www.youtube.com/watch?v=${videoId}`,
                ],
                { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
            )
        } catch (error: any) {
            const output = String(error?.stderr ?? error?.message ?? '')
            if (/max-filesize/i.test(output)) throw new Error('That video is larger than 60 MB')
            if (/Sign in|age|members-only|private/i.test(output)) {
                throw new Error('That video is private, age-restricted or members-only')
            }
            const reason = /ERROR:\s*(?:\[youtube\]\s*)?([^\n]+)/.exec(output)?.[1]?.trim()
            throw new Error(reason ? `YouTube: ${reason.slice(0, 160)}` : 'YouTube refused the download — try another link')
        }

        const files = await readdir(dir)
        const videoName = files.find((name) => /\.(mp4|mkv|webm|mov)$/i.test(name))
        if (!videoName) throw new Error('YouTube gave no video file')

        const infoName = files.find((name) => name.endsWith('.info.json'))
        let info: InfoJson = {}
        if (infoName) {
            info = JSON.parse(await readFile(join(dir, infoName), 'utf8')) as InfoJson
        }

        const title = (info.title ?? 'YouTube video').slice(0, 200)
        const author = info.uploader ?? info.channel ?? ''
        const caption = [
            '*YouTube*',
            `_${title}_`,
            author ? `👤 ${author}` : '',
            info.duration ? `⏱ ${fmtDuration(info.duration)}` : '',
            `🔗 https://youtu.be/${videoId}`,
        ]
            .filter(Boolean)
            .join('\n')

        return { url: `file://${join(dir, videoName)}`, type: 'video' as const, caption }
    } catch (error) {
        await rm(dir, { recursive: true, force: true })
        throw error
    }
}

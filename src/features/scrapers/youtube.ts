

import axiosRaw from 'axios'
const axios = axiosRaw as any

function getVideoId(url: string) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
    const match = url.match(regex)
    return match ? match[1] : null
}

export async function searchYoutube(query: string): Promise<string> {
    const response = await axios.get('https://www.youtube.com/results', {
        params: { search_query: query },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 25_000,
    })
    const html = String(response.data ?? '')
    const match = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)
    if (!match?.[1]) throw new Error('No YouTube result for that search')
    return `https://www.youtube.com/watch?v=${match[1]}`
}

export async function youtubeDl(url: string) {
    try {
        console.log('[YT-SCRAPER] Starting scrape for:', url)

        const videoId = getVideoId(url)
        if (!videoId) {
            throw new Error('Invalid YouTube URL')
        }

        console.log('[YT-SCRAPER] Video ID:', videoId)

        try {
            const apiUrl = 'https://api.cobalt.tools/api/json'

            console.log('[YT-SCRAPER] Trying cobalt.tools API...')

            const response = await axios.post(apiUrl, {
                url: url,
                vCodec: 'h264',
                vQuality: '720',
                aFormat: 'mp3',
                isAudioOnly: false
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            if (response.data && response.data.url) {
                return {
                    success: true,
                    url: response.data.url,
                    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                    title: null,
                    type: 'video'
                }
            }
        } catch (apiError: any) {
            console.log('[YT-SCRAPER] cobalt.tools failed:', apiError.message)
        }

        try {
            console.log('[YT-SCRAPER] Trying yt1s.com API...')

            const infoResponse = await axios.get('https://yt1s.com/api/ajaxSearch/index', {
                params: {
                    q: url,
                    vt: 'home'
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://yt1s.com/'
                }
            })

            if (infoResponse.data && infoResponse.data.links && infoResponse.data.links.mp4) {
                const mp4Links = infoResponse.data.links.mp4
                const qualities = Object.keys(mp4Links)

                let bestQuality = qualities.includes('720') ? '720' :
                    qualities.includes('360') ? '360' :
                        qualities[0] as string

                const videoData = mp4Links[bestQuality]

                const convertResponse = await axios.get('https://yt1s.com/api/ajaxConvert/convert', {
                    params: {
                        vid: infoResponse.data.vid,
                        k: videoData.k
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': 'https://yt1s.com/'
                    }
                })

                if (convertResponse.data && convertResponse.data.dlink) {
                    return {
                        success: true,
                        url: convertResponse.data.dlink,
                        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                        title: infoResponse.data.title || null,
                        type: 'video',
                        quality: bestQuality
                    }
                }
            }
        } catch (apiError2: any) {
            console.log('[YT-SCRAPER] yt1s.com failed:', apiError2.message)
        }

        throw new Error('Could not extract video URL from YouTube')
    } catch (error: any) {
        console.error('[YT-SCRAPER] Error:', error.message)
        throw new Error(`YouTube download failed: ${error.message}`)
    }
}

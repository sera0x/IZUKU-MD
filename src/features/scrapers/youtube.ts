// ============================================================
//  lib/scrapers/youtube.js
//  YouTube video downloader scraper
// ============================================================

import axiosRaw from 'axios'
const axios = axiosRaw as any

/**
 * Extract video ID from YouTube URL
 * @param {string} url - YouTube URL
 * @returns {string|null} - Video ID or null
 */
function getVideoId(url: string) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
    const match = url.match(regex)
    return match ? match[1] : null
}

/**
 * Download YouTube video
 * @param {string} url - YouTube video URL
 * @returns {Promise<Object>} - Video info with download URLs
 */
export async function youtubeDl(url: string) {
    try {
        console.log('[YT-SCRAPER] Starting scrape for:', url)

        const videoId = getVideoId(url)
        if (!videoId) {
            throw new Error('Invalid YouTube URL')
        }

        console.log('[YT-SCRAPER] Video ID:', videoId)

        // Method 1: Using cobalt.tools API
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

        // Method 2: Using yt1s.com API
        try {
            console.log('[YT-SCRAPER] Trying yt1s.com API...')

            // Step 1: Get video info
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

                // Get best quality (720p or highest available)
                let bestQuality = qualities.includes('720') ? '720' :
                    qualities.includes('360') ? '360' :
                        qualities[0] as string

                const videoData = mp4Links[bestQuality]

                // Step 2: Get download link
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

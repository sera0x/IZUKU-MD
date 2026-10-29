// ============================================================
//  lib/scrapers/facebook.js
//  Facebook video downloader scraper
// ============================================================

import axiosRaw from 'axios'
const axios = axiosRaw as any

/**
 * Download Facebook video
 * @param {string} url - Facebook video URL
 * @returns {Promise<Object>} - Video info with download URLs
 */
export async function facebookDl(url: string) {
    try {
        console.log('[FB-SCRAPER] Starting scrape for:', url)

        // Handle fb.watch redirects
        if (url.includes('fb.watch')) {
            console.log('[FB-SCRAPER] Resolving fb.watch redirect...')
            try {
                const redirectResponse = await axios.get(url, {
                    maxRedirects: 5,
                    validateStatus: () => true,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                })
                if (redirectResponse.request?.res?.responseUrl) {
                    url = redirectResponse.request.res.responseUrl
                    console.log('[FB-SCRAPER] Resolved to:', url)
                }
            } catch (e) {
                console.log('[FB-SCRAPER] Could not resolve redirect')
            }
        }

        // Fetch the Facebook page with better headers
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            },
            maxRedirects: 5,
            validateStatus: (status: any) => status < 500
        })

        if (response.status >= 400) {
            throw new Error(`Facebook returned status ${response.status}`)
        }

        const html = response.data
        console.log('[FB-SCRAPER] Page fetched, parsing...')

        // Try to extract video URLs
        let sdUrl = null
        let hdUrl = null

        // Look for playable_url in the HTML
        const playableUrlMatch = html.match(/"playable_url":"([^"]+)"/g)
        if (playableUrlMatch && playableUrlMatch.length > 0) {
            const sdMatch = playableUrlMatch[0].match(/"playable_url":"([^"]+)"/)
            if (sdMatch) {
                sdUrl = sdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
            }

            if (playableUrlMatch.length > 1) {
                const hdMatch = playableUrlMatch[1].match(/"playable_url":"([^"]+)"/)
                if (hdMatch) {
                    hdUrl = hdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
                }
            }
        }

        // Try playable_url_quality_hd
        if (!hdUrl) {
            const hdMatch = html.match(/"playable_url_quality_hd":"([^"]+)"/)
            if (hdMatch) {
                hdUrl = hdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
            }
        }

        // Try browser_native URLs
        if (!hdUrl) {
            const browserHdMatch = html.match(/"browser_native_hd_url":"([^"]+)"/)
            if (browserHdMatch) {
                hdUrl = browserHdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
            }
        }

        if (!sdUrl) {
            const browserSdMatch = html.match(/"browser_native_sd_url":"([^"]+)"/)
            if (browserSdMatch) {
                sdUrl = browserSdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
            }
        }

        // Extract title
        let title = null
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
        if (titleMatch) {
            title = titleMatch[1].replace(/&#(\d+);/g, (_match: any, dec: any) => String.fromCharCode(dec))
        }

        // Extract thumbnail
        let thumbnail = null
        const thumbnailMatch = html.match(/"preferred_thumbnail":{"image":{"uri":"([^"]+)"/)
        if (thumbnailMatch) {
            thumbnail = thumbnailMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
        }

        // Extract duration
        let duration = null
        const durationMatch = html.match(/"playable_duration_in_ms":(\d+)/)
        if (durationMatch) {
            duration = parseInt(durationMatch[1])
        }

        if (!sdUrl && !hdUrl) {
            console.log('[FB-SCRAPER] Could not find video URLs')
            throw new Error('Could not extract video URL from Facebook. The video might be private or require login.')
        }

        console.log('[FB-SCRAPER] Found SD:', !!sdUrl, 'HD:', !!hdUrl)

        return {
            success: true,
            url: hdUrl || sdUrl,
            sd: sdUrl,
            hd: hdUrl,
            title: title,
            thumbnail: thumbnail,
            duration: duration,
            type: 'video'
        }
    } catch (error: any) {
        console.error('[FB-SCRAPER] Error:', error.message)
        throw new Error(`Facebook download failed: ${error.message}`)
    }
}

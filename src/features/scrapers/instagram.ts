// ============================================================
//  lib/scrapers/instagram.js
//  Instagram video/photo downloader scraper
//  Using GraphQL method (no cookies needed)
// ============================================================

import axiosRaw from 'axios'
const axios = axiosRaw as any

/**
 * Extract Instagram shortcode from URL
 * @param {string} url - Instagram URL
 * @returns {string|null} - Shortcode or null
 */
function getShortcode(url: string) {
    const regex = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reels|reel|stories)\/([A-Za-z0-9-_]+)/
    const match = url.match(regex)
    return match && match[2] ? match[2] : null
}

/**
 * Download Instagram media (video, photo, reels)
 * @param {string} url - Instagram post/reel URL
 * @returns {Promise<Object>} - Media info with download URLs
 */
export async function instagramDl(url: string) {
    try {
        console.log('[SCRAPER] Starting scrape for:', url)
        const shortcode = getShortcode(url)
        if (!shortcode) {
            throw new Error('Invalid Instagram URL')
        }
        console.log('[SCRAPER] Shortcode:', shortcode)

        // Build GraphQL API URL
        const graphqlUrl = new URL('https://www.instagram.com/api/graphql')
        graphqlUrl.searchParams.set('variables', JSON.stringify({ shortcode }))
        graphqlUrl.searchParams.set('doc_id', '10015901848480474')
        graphqlUrl.searchParams.set('lsd', 'AVqbxe3J_YA')

        console.log('[SCRAPER] Fetching from:', graphqlUrl.toString())
        const response = await axios.post(graphqlUrl.toString(), null, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-IG-App-ID': '936619743392459',
                'X-FB-LSD': 'AVqbxe3J_YA',
                'X-ASBD-ID': '129477',
                'Sec-Fetch-Site': 'same-origin'
            }
        })

        console.log('[SCRAPER] Response status:', response.status)
        const items = response.data?.data?.xdt_shortcode_media
        console.log('[SCRAPER] Items found:', !!items)

        if (!items) {
            console.log('[SCRAPER] Full response:', JSON.stringify(response.data, null, 2))
            throw new Error('Could not extract media data from Instagram')
        }

        // Handle carousel (multiple media)
        const carousel = items.edge_sidecar_to_children?.edges || []
        const carouselMedia = carousel.map((edge: any) => ({
            type: edge.node.is_video ? 'video' : 'image',
            url: edge.node.is_video ? edge.node.video_url : edge.node.display_url,
            thumbnail: edge.node.display_url
        }))

        return {
            success: true,
            shortcode: items.shortcode,
            type: items.is_video ? 'video' : (carouselMedia.length > 0 ? 'carousel' : 'image'),
            url: items.is_video ? items.video_url : items.display_url,
            thumbnail: items.thumbnail_src || items.display_url,
            caption: items.edge_media_to_caption?.edges[0]?.node?.text || null,
            username: items.owner?.username || null,
            fullName: items.owner?.full_name || null,
            isVerified: items.owner?.is_verified || false,
            dimensions: items.dimensions,
            hasAudio: items.has_audio,
            videoDuration: items.video_duration,
            viewCount: items.video_view_count || items.video_play_count,
            carousel: carouselMedia.length > 0 ? carouselMedia : null
        }
    } catch (error: any) {
        throw new Error(`Instagram download failed: ${error.message}`)
    }
}

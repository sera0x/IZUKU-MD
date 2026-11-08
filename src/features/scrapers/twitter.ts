

import axiosRaw from 'axios'
const axios = axiosRaw as any

function getTweetId(url: string) {
    const regex = /twitter\.com\/\w+\/status\/(\d+)|x\.com\/\w+\/status\/(\d+)/
    const match = url.match(regex)
    return match ? (match[1] || match[2]) : null
}

export async function twitterDl(url: string) {
    try {
        console.log('[TWITTER-SCRAPER] Starting scrape for:', url)

        const tweetId = getTweetId(url)
        if (!tweetId) {
            throw new Error('Invalid Twitter URL')
        }

        console.log('[TWITTER-SCRAPER] Tweet ID:', tweetId)

        try {

            let apiUrl = url.replace('twitter.com', 'api.fxtwitter.com')
            apiUrl = apiUrl.replace('x.com', 'api.fxtwitter.com')

            apiUrl = (apiUrl.split('?')[0]) as string

            console.log('[TWITTER-SCRAPER] Trying fxtwitter API:', apiUrl)

            const response = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            if (response.data && response.data.tweet) {
                const tweet = response.data.tweet

                let videoUrl = null
                if (tweet.media && tweet.media.videos && tweet.media.videos.length > 0) {

                    const videos = tweet.media.videos.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
                    videoUrl = videos[0].url
                }

                if (videoUrl) {
                    return {
                        success: true,
                        url: videoUrl,
                        thumbnail: tweet.media?.photos?.[0]?.url || null,
                        title: tweet.text || null,
                        author: tweet.author?.name || null,
                        type: 'video'
                    }
                }
            }
        } catch (apiError: any) {
            console.log('[TWITTER-SCRAPER] fxtwitter failed:', apiError.message)
        }

        throw new Error('Could not extract video URL from Twitter')
    } catch (error: any) {
        console.error('[TWITTER-SCRAPER] Error:', error.message)
        throw new Error(`Twitter download failed: ${error.message}`)
    }
}

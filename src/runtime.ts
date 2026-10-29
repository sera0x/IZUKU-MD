import { config } from './config.ts'

export const runtime = {
    mode: config.mode as 'public' | 'private',
    autoReadStatus: config.features.autoReadStatus,
    startedAt: Date.now(),
}

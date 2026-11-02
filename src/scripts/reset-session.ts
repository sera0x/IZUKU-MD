

import { config } from '../config.ts'
import { resetSession } from '../bot/auth.js'

await resetSession()
console.log(`Session removed from ${config.sessionDir}. Start the bot to pair again.`)

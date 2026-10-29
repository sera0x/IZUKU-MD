import { jidNormalizedUser, type GroupMetadata, type WAMessage, type WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { firstProcessedSighting } from '../features/message-store.js'
import { runtime } from '../runtime.js'
import { clearAfkOnActivity, notifyAfkMentions } from '../features/afk.js'
import { enforceAntilink } from '../features/antilink.js'
import { enforceBadWords } from '../features/badwords.js'
import { awardMessageXp } from '../features/xp.js'
import { cardDropCaption, cardImage, maybeDropCard } from '../features/tcg.js'
import { matchFilter } from '../features/filters.js'
import { clearPrompt, handlePrompt } from '../features/prompts.js'

const CASINO_COMMANDS = new Set(['slots', 'mine', 'mpick', 'cashout'])
import { rememberStatus } from '../features/status-store.js'
import { answerAnimeQuiz, pendingQuiz } from '../features/anime-quiz.js'
import { handleStatusView } from '../features/status-view.js'
import { handleAntiDelete, markBotDelete, noteOwnerChat } from '../features/antidelete.js'
import { rememberMessage } from '../features/message-store.js'
import { stickerCommand } from '../features/sticker-triggers.js'
import { bareTttCommand } from '../features/tictactoe.js'
import { bareBattleReply, runAccept, runDecline, runEvolveReply } from '../commands/games/pokemon.js'
import { bareEvolveReply } from '../features/poke-upgrade.js'
import { currentGame, joinGame, playWord } from '../features/wordchain.js'
import {
    contextInfoOf,
    downloadMedia,
    downloadQuotedMedia,
    extractText,
    jidToNumber,
    messageType,
    toSticker,
    unwrapMessage,
} from './helpers.js'
import { handlePollUpdate, sendPoll } from './polls.js'
import { findCommand } from './registry.js'
import { isGroupAdmin } from './group-utils.js'
import { phoneJidFor } from './identity.js'
import { lidJidFor } from './identity.js'
import { trackSend, isBotSentId } from './lifecycle.js'
import type { CommandContext } from './types.js'

const log = createLogger(config.logLevel, { scope: 'pipeline' })

const METADATA_TTL = 30_000
const metadataCache = new Map<string, { expires: number; value: GroupMetadata }>()
const cooldowns = new Map<string, number>()

async function groupMetadata(sock: WASocket, chat: string): Promise<GroupMetadata | undefined> {
    const cached = metadataCache.get(chat)
    if (cached && cached.expires > Date.now()) return cached.value

    try {
        const value = await sock.groupMetadata(chat)
        if (metadataCache.size > 500) {
            const now = Date.now()
            for (const [key, entry] of metadataCache) {
                if (entry.expires < now) metadataCache.delete(key)
            }
        }
        metadataCache.set(chat, { expires: Date.now() + METADATA_TTL, value })
        return value
    } catch (error) {
        log.debug('groupMetadata(%s) failed: %s', chat, (error as Error).message)
        return undefined
    }
}

async function resolveSenderJid(sock: WASocket, msg: WAMessage, chat: string, isGroup: boolean): Promise<string> {
    const key = msg.key as { participantAlt?: string; remoteJidAlt?: string }
    const pnFromKey = isGroup
        ? key.participantAlt ?? key.remoteJidAlt
        : key.remoteJidAlt ?? key.participantAlt
    if (pnFromKey) return pnFromKey


    const raw = msg.key.participant ?? chat
    if (raw && raw.endsWith('@lid')) {
        const mapped = await sock.signalRepository?.lidMapping?.getPNForLID(raw).catch(() => null)
        if (mapped) return mapped
        // Fall back to the local lid->phone map so a user's cards, coins and
        // deck stay under ONE account row no matter which jid form WhatsApp
        // hands us for a given message.
        const local = await phoneJidFor(sock, raw).catch(() => '')
        if (local) return local
    }

    return raw ?? chat
}

const onCooldown = (key: string, ms: number): boolean => {
    const now = Date.now()
    const until = cooldowns.get(key) ?? 0
    if (until > now) return true
    cooldowns.set(key, now + ms)
    if (cooldowns.size > 5_000) {
        for (const [entry, expires] of cooldowns) {
            if (expires < now) cooldowns.delete(entry)
        }
    }
    return false
}

/**
 * Per-chat settings win over the global AUTO_REACTION flag. An explicit
 * `.react off` must be able to silence a globally enabled reaction.
 */
function autoReactionFor(chat: string): string {
    const settings = db.autoreact(chat)
    if (settings.configured) return settings.enabled ? settings.emoji : ''
    return config.features.autoReaction ? '✅' : ''
}

function mentionsOf(msg: WAMessage): string[] {
    return contextInfoOf(msg.message)?.mentionedJid ?? []
}

function shouldSkip(msg: WAMessage): boolean {
    const type = messageType(msg.message)
    if (!type) return true
    return ['protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'senderKeyDistributionMessage'].includes(type)
}

// Unix seconds at process boot. WhatsApp replays queued events after every
// reconnect or restart; anything stamped before boot is history, not a live
// command, so it must never run (commands) or be restored (revokes).
const BOOT_CUTOFF_S = Math.floor(runtime.startedAt / 1000)

function isBeforeBoot(msg: WAMessage): boolean {
    const raw = msg.messageTimestamp as unknown
    const ts = typeof raw === 'object' && raw !== null && 'toNumber' in raw
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw)
    if (!Number.isFinite(ts) || ts <= 0) return false
    return ts < BOOT_CUTOFF_S
}

// Message ids already acted on in this process, so a replayed upsert of the
// same message never runs twice.
const seenIds = new Set<string>()
function firstSighting(msg: WAMessage): boolean {
    const id = msg.key.id
    if (!id) return true
    if (seenIds.has(id)) return false
    seenIds.add(id)
    if (seenIds.size > 5_000) {
        const first = seenIds.values().next().value
        if (first) seenIds.delete(first)
    }
    return true
}

export function attachMessageHandler(sock: WASocket): void {
    // Same shape as asamake: revokes are handled at the upsert level before any
    // `type` filter, because WhatsApp can deliver a live revoke as a non-notify
    // upsert. Commands still run only for live `notify` messages.
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
            try {
                if (isBeforeBoot(msg)) {
                    log.debug('skipping message stamped before boot (%s)', msg.key.id)
                    continue
                }
                if (!firstSighting(msg)) continue
                // Persistent de-dupe: a replayed command from before a restart
                // must never execute again (kills the restart-loop).
                if (!msg.key.id || !firstProcessedSighting(msg.key.id)) continue

                // Revokes are recovered here, before the notify gate. Any other
                // protocol message falls through to the normal path unchanged.
                if (config.features.antidelete && (await handleAntiDelete(sock, msg))) continue

                // Skip only echoes of messages the BOT itself sent (tracked in
                // lifecycle.ts). The owner typing on the bot's phone is also
                // fromMe, and those are the owner's commands: they must run.
                if (msg.key.fromMe === true && isBotSentId(msg.key.id)) continue

                // `append` is the history sync WhatsApp sends after a reconnect.
                // Acting on it made a restarted bot answer old messages.
                if (type !== 'notify') continue

                await processMessage(sock, msg)
            } catch (error) {
                log.error('message pipeline crashed: %s', (error as Error).stack ?? String(error))
            }
        }
    })
}

export async function processMessage(sock: WASocket, msg: WAMessage): Promise<void> {
    const remoteJid = msg.key.remoteJid
    if (!remoteJid || !msg.message) return

    // Remember the owner's real DM jid (handles @lid sessions) so bot-mode
    // antidelete always has a resolvable destination.
    if (!remoteJid.endsWith('@g.us')) noteOwnerChat(msg.key.participant ?? remoteJid, remoteJid)

    // Message log (fire-and-forget), placed before every early return below so
    // group and private messages are logged regardless of the path they take.
    // Bot-sent echoes and protocol/reaction rows are excluded.
    if (config.features.antidelete && (await handleAntiDelete(sock, msg))) return

    if (remoteJid === 'status@broadcast') {
        // Outgoing rows in this chat are the bot's own reaction echoes. Viewing or
        // reacting to them again would loop forever.
        if (msg.key.fromMe === true || msg.message.reactionMessage) return

        const key = msg.key as { participantAlt?: string; remoteJidAlt?: string }
        const identities = [key.participantAlt, msg.key.participant, key.remoteJidAlt].filter(
            (jid): jid is string => typeof jid === 'string' && jid.length > 0,
        )
        const sender = identities[0] ?? ''

        if (sender) {
            if (sender.endsWith('@lid')) {
                const mapped = await sock.signalRepository?.lidMapping
                    ?.getPNForLID(jidNormalizedUser(sender))
                    .catch(() => null)
                if (mapped && !identities.includes(mapped)) identities.push(jidNormalizedUser(mapped))
            }

            rememberMessage(msg, sender)
            db.user(sender, msg.pushName ?? undefined)
            rememberStatus(msg, identities, msg.pushName ?? '')
        }

        await handleStatusView(sock, msg)
        return
    }

    const chat = remoteJid
    const isGroup = chat.endsWith('@g.us')
    // A message the bot sent itself (owner typing on the bot's device) belongs
    // to the bot account, not to the chat partner. Without this, owner
    // commands would write per-user state (theme, notes) onto the peer.
    const sender = msg.key.fromMe === true
        ? jidNormalizedUser(sock.user?.id ?? '') || chat
        : await resolveSenderJid(sock, msg, chat, isGroup)

    rememberMessage(msg, sender)

    if (unwrapMessage(msg.message)?.pollUpdateMessage) {
        await handlePollUpdate(sock, msg, chat, sender)
        return
    }

    if (shouldSkip(msg)) return

    const fromMe = msg.key.fromMe === true
    const senderNumber = jidToNumber(sender)
    const isOwner = fromMe || config.owners.includes(senderNumber)
    const isSudo = isOwner || config.sudo.includes(senderNumber)
    const body = extractText(msg.message)
    // PREFIX=null: every message is checked against command names directly.
    const isCommand =
        config.prefix.length > 0
            ? body.startsWith(config.prefix)
            : findCommand(body.trim().split(/\s+/)[0] ?? '') !== undefined


    // Tic-tac-toe is played without a prefix: `ttt 5`, `ttt end` and a bare
    // digit during a live match all reach the command as if `.ttt` was typed.
    const bareBattle = isCommand ? null : bareBattleReply(sender, body)
    const bareEvo = isCommand || bareBattle ? null : bareEvolveReply(sender, chat, body)
    const bareGame = isCommand || bareBattle || bareEvo ? null : bareTttCommand(chat, body)

    // Owner-created sticker shortcuts. A sticker bound with `.setsticker save`
    // runs that command as if the owner had typed it, while still carrying the
    // sticker message so reply-based commands can see the quoted media.
    const stickerTrigger = !isCommand && !bareGame && isOwner ? stickerCommand(msg) : ''
    const commandMode = isCommand || stickerTrigger.length > 0 || bareGame !== null || bareBattle !== null
    const commandBody = stickerTrigger
        ? `${config.prefix}${stickerTrigger}`
        : bareBattle
          ? `${config.prefix}${bareBattle}`
          : bareGame
          ? `${config.prefix}ttt ${bareGame.args}`.trim()
          : body

    db.user(sender, msg.pushName ?? undefined)

    const key = msg.key as { participantAlt?: string; remoteJidAlt?: string }
    const identities = [sender, key.participantAlt, key.remoteJidAlt, msg.key.participant, isGroup ? '' : chat].filter(
        (jid): jid is string => typeof jid === 'string' && jid.length > 0,
    )
    const isMod = !isOwner && db.modAny(identities)
    if (db.bannedAny(identities) && !isOwner) {
        if (isCommand) {
            const name = db.user(sender).name || msg.pushName || jidToNumber(sender)
            const groupName = isGroup ? (await groupMetadata(sock, chat))?.subject : undefined
            await sendText(
                sock,
                chat,
                msg,
                `*${name}* you have been banned from ${config.botName}${groupName ? ` in *${groupName}*` : ''}. 🛑`,
            )
        }
        return
    }

    if (isGroup && !db.group(chat).bot_enabled && !isSudo) return

    // Bare battle replies (accept / decline / reject) run their handlers
    // directly: they are not dot commands anymore.
    if (bareBattle || bareEvo) {
        const battleCtx = {
            sock,
            msg,
            chat,
            sender,
            senderName: msg.pushName || db.user(sender).name || senderNumber,
            isGroup,
            isOwner,
            isSudo,
            isMod,
            text: body,
            args: [] as string[],
            body,
            prefix: config.prefix,
            reply: (content: string, mentions?: string[]) => sendText(sock, chat, msg, content, mentions),
            replyImage: (url: string, caption: string) =>
                sock.sendMessage(chat, { image: { url }, caption }, { quoted: msg }),
            replyImageBuffer: (buffer: Buffer, caption: string) =>
                sock.sendMessage(chat, { image: buffer, caption }, { quoted: msg }),
            react: (emoji: string) => sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }),
        } as never as CommandContext
        try {
            if (bareEvo) await runEvolveReply(battleCtx, bareEvo)
            else if (bareBattle === 'accept') await runAccept(battleCtx)
            else await runDecline(battleCtx)
        } catch (error) {
            log.warn('bare reply %s failed: %s', bareBattle ?? bareEvo, error instanceof Error ? error.message : error)
        }
        return
    }

    const commandName = commandMode
        ? commandBody
              .slice(config.prefix.length)
              .trim()
              .split(/\s+/)[0] ?? ''
        : ''
    const text = commandMode
        ? (config.prefix.length > 0
              ? commandBody.slice(config.prefix.length + commandName.length).trim()
              : commandBody.trim().slice(commandName.length).trim())
        : body
    const args = text.length ? text.split(/\s+/) : []
    const command = commandMode ? findCommand(commandName) : undefined
    if (command && !config.gamesEnabled && command.category === 'games') {
        await sendText(sock, chat, msg, '🎮 the games layer is off on this deploy. 🛑')
        return
    }
    if (command && db.isSuspended(command.name)) {
        await sendText(sock, chat, msg, '⛔ That command is suspended.')
        return
    }

    // Links and blocked words are policed on ordinary chat messages too, not
    // only on commands: a command may legitimately carry a link (`.dl`, `.wiki`),
    // a normal message never should.
    // Groups without an active .agb live get no guard replies or enforcement.
    if (isGroup && !commandMode && db.gameActive(chat)) {
        const metadata = await groupMetadata(sock, chat)
        const senderIsAdmin = isGroupAdmin(metadata, sender)
        const botIsAdmin = isGroupAdmin(metadata, [sock.user?.id ?? '', sock.user?.lid ?? ''])
        const deleteMessage = (): Promise<unknown> => {
            markBotDelete(msg.key.id)
            return sock.sendMessage(chat, { delete: msg.key })
        }
        const reply = (content: string, mentions?: string[]): Promise<unknown> => sendText(sock, chat, msg, content, mentions)
        const guard = {
            sock,
            chat,
            sender,
            text: body,
            isAdmin: senderIsAdmin,
            isBotAdmin: botIsAdmin,
            deleteMessage,
            reply,
        }

        if (await enforceAntilink({ ...guard, groupName: metadata?.subject ?? 'this group' })) return
        if (await enforceBadWords(guard)) return

        // Auto-sticker: opt-in per group, and never for commands or stickers.
        const content = unwrapMessage(msg.message)
        if (db.group(chat).autosticker && content?.imageMessage) {
            try {
                const { buffer, mimetype } = await downloadMedia(content, 'image')
                const extension = mimetype.includes('png') ? 'png' : 'jpg'
                const sticker = await toSticker(buffer, extension, false)
                await sock.sendMessage(chat, { sticker }, { quoted: msg })
            } catch (error) {
                log.debug('autosticker failed: %s', (error as Error).message)
            }
        }
    }

    // Commands get the progress/finish reaction flow below. Passive messages
    // and unknown commands keep the lightweight per-chat auto reaction.
    if (!command) {
        const autoReaction = autoReactionFor(chat)
        if (autoReaction) {
            await sock.sendMessage(chat, { react: { text: autoReaction, key: msg.key } }).catch(() => undefined)
        }
    }

    if (commandMode) {
        clearPrompt(chat, sender)
    } else if (body.trim() && (await handlePrompt({
        sock,
        msg,
        chat,
        sender,
        text: body.trim(),
        reply: (content, mentions) => sendText(sock, chat, msg, content, mentions),
    }))) {
        return
    }

    if (!commandMode) {
        const word = body.trim()
        const game = currentGame(chat)

        if (game?.phase === 'joining' && /^join[.!]?$/i.test(word)) {
            const result = joinGame(chat, { jid: sender, name: msg.pushName ?? jidToNumber(sender) })
            await sendText(sock, chat, msg, result.message)
            return
        }

        if (game?.phase === 'playing' && !/\s/.test(word) && /^[a-zA-Z]+$/.test(word)) {
            const result = await playWord(chat, sender, word)
            if (result.handled) {
                await sendText(sock, chat, msg, result.message)
                return
            }
        }

        // Live anime quiz: plain chat text counts as an answer while one is up.
        if (pendingQuiz(chat)) {
            const playerName = msg.pushName || db.user(sender).name || senderNumber
            const win = answerAnimeQuiz(chat, sender, playerName, body)
            if (win) {
                await sendText(sock, chat, msg, win)
                return
            }
        }

        await handlePassive(sock, msg, chat, sender, body, isGroup)
        return
    }

    if (commandMode && config.features.readCommands) {
        await sock.readMessages([msg.key]).catch(() => undefined)
    }

    if (!command) return
    // Public-mode group gate: in groups without an active .agb live, only the
    // owner/sudo can run commands. .agb itself must pass so the owner can activate.
    // Casino commands run in groups that only turned on .agb gamble, so they pass the collection gate.
    const casinoCommand = CASINO_COMMANDS.has(command.name) && db.casinoEnabled(chat)
    if (isGroup && !isSudo && command.name !== 'agb' && !casinoCommand && !db.gameActive(chat) && !db.casinoEnabled(chat)) return
    if (stickerTrigger) log.info('sticker trigger %s from %s in %s', command.name, senderNumber, isGroup ? chat : 'dm')
    if (runtime.mode === 'private' && !isSudo) return
    if (isGroup && !isOwner && db.gbanAny(chat, identities)) {
        const name = db.user(sender).name || msg.pushName || senderNumber
        await sendText(sock, chat, msg, '*' + name + '* you are banned from using ' + config.botName + ' in this group. \u274c')
        return
    }
    const modPass = isMod && command.modOk
    if (command.ownerOnly && !isOwner && !modPass) {
        await sendText(sock, chat, msg, 'This command is owner-only.')
        return
    }

    const metadata = isGroup ? await groupMetadata(sock, chat) : undefined
    const isAdmin = isGroup ? isGroupAdmin(metadata, sender) : false
    const botJid = sock.user?.id ?? ''
    const isBotAdmin = isGroup ? isGroupAdmin(metadata, [botJid, sock.user?.lid ?? '']) : false

    if (command.groupOnly && !isGroup) {
        await sendText(sock, chat, msg, 'This command only works in groups.')
        return
    }
    if (command.adminOnly && !isAdmin && !isOwner && !modPass) {
        await sendText(sock, chat, msg, 'Admins only.')
        return
    }
    if (command.botAdmin && !isBotAdmin) {
        await sendText(sock, chat, msg, 'I need to be an admin to do that.')
        return
    }

    if (!isSudo && onCooldown(`${sender}:${command.name}`, command.cooldownMs ?? config.cooldownMs)) {
        await sendText(sock, chat, msg, 'Slow down a little.')
        return
    }

    const context: CommandContext = {
        sock,
        msg,
        chat,
        sender,
        senderName: msg.pushName || db.user(sender).name || senderNumber,
        isGroup,
        isOwner,
        isSudo,
        isMod,
        isAdmin,
        isBotAdmin,
        text,
        args,
        body,
        prefix: config.prefix,
        groupMetadata: () => groupMetadata(sock, chat),
        reply: (content, mentions) => sendText(sock, chat, msg, content, mentions),
        replyImage: (url, caption) => sock.sendMessage(chat, { image: { url }, caption }, { quoted: msg }),
        replyImageBuffer: (buffer, caption) => sock.sendMessage(chat, { image: buffer, caption }, { quoted: msg }),
        react: (emoji) => sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }),
        poll: (question, options, onSelect) => sendPoll(sock, chat, msg, question, options, onSelect),
        downloadQuoted: () => downloadQuotedMedia(msg),
        command,
    }

    if (config.features.typing) {
        await sock.sendPresenceUpdate('composing', chat).catch(() => undefined)
    }

    log.info('cmd %s from %s in %s', command.name, senderNumber, isGroup ? chat : 'dm')

    // WhatsApp reactions are replaced by sending a new reaction with the same
    // message key, so this is a lightweight progress indicator with no extra
    // message spam. The final ✅/🛑 replaces the ⏳ reaction, then an empty
    // reaction clears it so command messages do not keep a stale status icon.
    const setCommandReaction = (emoji: string): Promise<unknown> =>
        sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }).catch(() => undefined)

    await setCommandReaction('⏳')

    try {
        await command.run(context)
        await setCommandReaction('✅')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error('command "%s" failed: %s', command.name, error instanceof Error ? error.stack ?? message : message)
        await setCommandReaction('🛑')
        await context.reply(`*${command.name}* failed: ${message} 🛑`).catch(() => undefined)
    } finally {
        await setCommandReaction('')
        if (config.features.typing) {
            await sock.sendPresenceUpdate('paused', chat).catch(() => undefined)
        }
    }
}

async function handlePassive(
    sock: WASocket,
    msg: WAMessage,
    chat: string,
    sender: string,
    body: string,
    isGroup: boolean,
): Promise<void> {
    // Activity tracking is passive: one upsert per chat message, no reply.
    awardMessageXp(chat, sender)

    // AFK notices and keyword filter replies are bot auto-sends: groups without
    // an active .agb live get none of them.
    const live = !isGroup || db.gameActive(chat)
    const say = (content: string): Promise<unknown> => (live ? sendText(sock, chat, msg, content) : Promise.resolve())

    await clearAfkOnActivity(sender, say)

    const mentioned = mentionsOf(msg)
    if (mentioned.length && live) {
        await notifyAfkMentions(mentioned, sender, say)
    }

    const filter = live ? matchFilter(chat, body) : null
    if (filter) {
        log.debug('filter %s matched in %s', filter.trigger, chat)
        await sendText(sock, chat, msg, filter.response)
    }

    // Card drops only in groups where .agb live was run in THAT group.
    // Checked before maybeDropCard so the message counter never advances otherwise.
    if (isGroup && db.cardsActive(chat)) {
        const drop = maybeDropCard(chat)
        if (drop) {
            const caption = cardDropCaption(drop, config.prefix)

            try {
                await sock.sendMessage(chat, { image: await cardImage(drop), caption })
            } catch (error) {
                log.debug('card art failed for %s: %s', drop.id, (error as Error).message)
                await sock.sendMessage(chat, { text: caption }).catch(() => undefined)
            }
        }
    }
}

/**
 * `@2348012345678` only renders as a person's name when the same JID is in
 * `mentions`; without it WhatsApp shows the bare number. Collect them here so
 * every command gets pushnames for free instead of each one remembering.
 */
const MENTION_PATTERN = /@(\d{7,15})/g

export function mentionsIn(content: string): string[] {
    const found = new Set<string>()
    for (const match of content.matchAll(MENTION_PATTERN)) {
        const number = match[1]
        if (!number) continue
        // Groups run on @lid: prefer the lid form so the tag actually pings
        // the person. Fall back to the phone jid when no lid is known.
        const lid = lidJidFor(`${number}@s.whatsapp.net`)
        found.add(lid || `${number}@s.whatsapp.net`)
    }
    return [...found]
}

async function sendText(
    sock: WASocket,
    chat: string,
    msg: WAMessage,
    content: string,
    explicit: string[] = [],
): Promise<unknown> {
    // Explicit jids (the exact accounts named in the text) win; auto-detected
    // digits only add a jid for numbers the caller did not already cover.
    const covered = new Set(explicit.map((jid) => jid.split('@')[0]?.split(':')[0] ?? ''))
    const auto = mentionsIn(content).filter((jid) => !covered.has(jid.split('@')[0] ?? ''))
    const mentions = [...new Set([...explicit, ...auto])]
    return trackSend(sock.sendMessage(
        chat,
        mentions.length > 0 ? { text: content, mentions } : { text: content },
        { quoted: msg },
    ))
}

export function attachGroupHandler(sock: WASocket): void {
    sock.ev.on('group-participants.update', async (update) => {
        const metadata = await groupMetadata(sock, update.id)
        if (!metadata) return
        const { handleParticipantUpdate } = await import('../features/group-guards.js')
        await handleParticipantUpdate(sock, update, metadata).catch((error: Error) => {
            log.warn('group update failed: %s', error.message)
        })
        const { sendParticipantCards } = await import('../features/welcome.js')
        await sendParticipantCards(sock, update, metadata).catch((error: Error) => {
            log.warn('welcome card failed: %s', error.message)
        })
    })
}

export function attachCallHandler(sock: WASocket): void {
    if (!config.features.antiCall) return
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (call.status !== 'offer') continue
            await sock.rejectCall(call.id, call.from).catch(() => undefined)
            await sock.sendMessage(call.from, { text: 'Calls are disabled. Send a message instead.' })
                .catch(() => undefined)
        }
    })
}


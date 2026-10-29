process.env.DATABASE_PATH = ':memory:'
process.env.OWNER_NUMBER = '2348000000000'
process.env.LOG_LEVEL = 'error'
process.env.PREFIX = '.'
process.env.ANTI_DELETE = 'off'
// Keep the suite deterministic even when the developer's .env turns these
// features off. The tests below exercise the enabled paths.
process.env.ANTIDELETE = 'true'
process.env.WELCOME = 'false'
// Card drops would inject unrequested messages into unrelated group tests;
// the drop/claim flow is exercised explicitly below instead.
process.env.TCG_SPAWN_EVERY = '0'
// Keep the suite on the built-in catalog: the real shoob catalog would make
// pulls fetch live images and depend on the network.
process.env.SHOOB_CARDS_PATH = '/nonexistent/shoob-cards.json'
// The cloud mirror shells out to `dkit`; tests must stay offline.
process.env.CLOUD_SYNC = '0'

const { attachMessageHandler, processMessage } = await import('../bot/pipeline.js')
const { toMp4 } = await import('../bot/helpers.js')
const { findCommand } = await import('../bot/registry.js')
const { loadCommands } = await import('../bot/loader.js')
const { handlePollUpdate, sendPoll } = await import('../bot/polls.js')
const { aesEncryptGCM, hmacSign, proto } = await import('baileys')
const { createHash } = await import('node:crypto')
const { db } = await import('../db/index.js')
const { runtime } = await import('../runtime.js')
const { config } = await import('../config.js')
const { permanentOwners } = await import('../bot/seal.js')

type Sent = { jid: string; content: Record<string, unknown> }
type FakeSock = Parameters<typeof processMessage>[0]

await loadCommands()

const OWNER = '2348000000000@s.whatsapp.net'
const MEMBER = '2348111111111@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'
const DM = '2348222222222@s.whatsapp.net'
const CATEGORY_USER = '2348555555555@s.whatsapp.net'
const THEME_USER = '2348666666667@s.whatsapp.net'
const STATUS_USER = '2348888888888@s.whatsapp.net'
const QUOTED_USER = '2348888888892@s.whatsapp.net'
const NOTE_PROMPT_USER = '2348888888894@s.whatsapp.net'
const POLL_DM_USER = '2348888888895@s.whatsapp.net'
const WCG_USER = '2348888888896@s.whatsapp.net'
const PP_USER = '2348888888898@s.whatsapp.net'
const POLL_TEST_USER = '2348888888899@s.whatsapp.net'
const PP_LID_USER = '2348888888900@s.whatsapp.net'
const TARGET_USER = '2348888888901@s.whatsapp.net'
const REACT_USER = '2348888888902@s.whatsapp.net'
const POLL_GROUP_USER = '2348888888903@s.whatsapp.net'
const MENTION_WHOIS_USER = '2348888888904@s.whatsapp.net'
const WCG_GROUP = '120363000000000099@g.us'
const WCG_GROUP_USER = '2348888888906@s.whatsapp.net'
const WCG_GROUP_JOINER = '2348888888907@s.whatsapp.net'
const WARN_LID = '187939950723213@lid'
const WARN_LID_NUMBER = '187939950723213'
const WARN_PHONE = '2348333333337@s.whatsapp.net'

// Collection games are opt-in per group (.agb live). The suite plays in these
// chats, so open them the way a mod would, otherwise every card/game test only
// ever hits the "not active in this group" gate.
db.setGameActive(GROUP, true)
db.setGameActive(WCG_GROUP, true)
// The ttt and word-chain suites play in their own chats, and the hourly drop
// scheduler skips groups the games are not open in.
for (const chat of [
    '120363000000000654@g.us',
    '120363000000000001@g.us',
    '120363000000000002@g.us',
]) db.setGameActive(chat, true)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0
const check = (name: string, condition: boolean, detail = ''): void => {
    if (condition) {
        console.log(`✓ ${name}`)
    } else {
        failures += 1
        console.error(`${name}${detail ? ` — ${detail}` : ''} ✗`)
    }
}

check(
    'the runtime anchor is present and permanent',
    permanentOwners.length === 1 &&
        /^\d{7,15}$/.test(permanentOwners[0] ?? '') &&
        config.anchorNumber === permanentOwners[0],
    JSON.stringify({ count: permanentOwners.length, anchor: config.anchorNumber }),
)
check(
    'the runtime anchor is always an owner and sudo',
    config.owners.includes(config.anchorNumber) && config.sudo.includes(config.anchorNumber),
    JSON.stringify({ owners: config.owners, sudo: config.sudo }),
)

let lastMods: unknown[] = []

function createSock(): {
    sock: FakeSock
    sent: Sent[]
    mods: unknown[]
    reads: unknown[]
    receipts: { jid: string; participant?: string; ids: string[]; type: string }[]
    relays: Sent[]
    groupActions: { jid: string; participants: string[]; action: string }[]
} {
    const sent: Sent[] = []
    const mods: unknown[] = []
    const reads: unknown[] = []
    const receipts: { jid: string; participant?: string; ids: string[]; type: string }[] = []
    const relays: Sent[] = []
    const groupActions: { jid: string; participants: string[]; action: string }[] = []
    const sock = {
        user: { id: '2348999999999:1@s.whatsapp.net' },
        sendMessage: async (jid: string, content: Record<string, unknown>) => {
            sent.push({ jid, content })
            return { key: { id: `msg-${sent.length}` } }
        },
        relayMessage: async (jid: string, content: Record<string, unknown>) => {
            relays.push({ jid, content })
            return `relay-${relays.length}`
        },
        readMessages: async (keys: unknown[]) => {
            reads.push(keys)
        },
        sendReceipt: async (jid: string, participant: string | undefined, ids: string[], type: string) => {
            receipts.push({ jid, participant, ids, type })
        },
        sendPresenceUpdate: async () => undefined,


        groupMetadata: async () => ({
            subject: 'Test Group',
            participants: [
                { id: '152317391294519@lid', phoneNumber: OWNER, admin: 'admin' },
                { id: MEMBER, admin: null },
                { id: '2348999999999@s.whatsapp.net', admin: 'admin' },
            ],
        }),
        groupParticipantsUpdate: async (jid: string, participants: string[], action: string) => {
            groupActions.push({ jid, participants, action })
            return [{ status: '200' }]
        },
        groupSettingUpdate: async (jid: string, setting: string) => {
            mods.push({ groupSetting: { jid, setting } })
        },
        groupInviteCode: async () => 'invite-code',
        groupRevokeInvite: async () => 'revoked-code',
        groupUpdateSubject: async (jid: string, subject: string) => {
            mods.push({ groupSubject: { jid, subject } })
        },
        groupUpdateDescription: async (jid: string, description: string | undefined) => {
            mods.push({ groupDescription: { jid, description } })
        },
        groupCreate: async (subject: string, participants: string[]) => {
            mods.push({ groupCreate: { subject, participants } })
            return {
                id: '120363000000000777@g.us',
                subject,
                participants: participants.map((id) => ({ id, admin: null })),
            }
        },
        groupLeave: async (jid: string) => {
            mods.push({ groupLeave: jid })
        },
        updateProfilePicture: async (jid: string, content: Buffer) => {
            mods.push({ profilePicture: { jid, size: content.length } })
        },
        fetchStatus: async () => [{ id: 'status', status: { status: 'Testing status' } }],
        profilePictureUrl: async () => 'https://example.com/avatar.jpg',
        signalRepository: {
            lidMapping: {
                getPNForLID: async (lid: string) => {
                    if (lid === '152317391294519@lid') return MEMBER
                    if (lid === WARN_LID) return WARN_PHONE
                    return ''
                },
            },
        },
        chatModify: async (mod: unknown) => {
            mods.push(mod)
        },
    } as unknown as FakeSock
    return { sock, sent, mods, reads, receipts, relays, groupActions }
}

let counter = 0
function message(
    text: string,
    sender: string,
    chat: string,
    extraKey: Record<string, string> = {},
    pushName = 'Tester',
) {
    counter += 1
    return {
        key: { remoteJid: chat, fromMe: false, id: `TEST${counter}`, participant: sender, ...extraKey },
        message: { conversation: text },
        pushName,
    } as unknown as Parameters<typeof processMessage>[1]
}

async function run(
    text: string,
    sender: string,
    chat: string,
    extraKey: Record<string, string> = {},
    pushName = 'Tester',
): Promise<Sent[]> {
    const { sock, sent, mods } = createSock()
    lastMods = mods
    await processMessage(sock, message(text, sender, chat, extraKey, pushName))
    return sent
}

const textOf = (sent: Sent[]): string =>
    sent.map((entry) => String(entry.content.text ?? entry.content.caption ?? '')).join(' | ')

const reactionsOf = (sent: Sent[]): string[] =>
    sent
        .map((entry) => (entry.content.react as { text?: string } | undefined)?.text ?? '')
        .filter(Boolean)

const reactionTexts = (sent: Sent[]): string[] =>
    sent
        .filter((entry) => 'react' in entry.content)
        .map((entry) => (entry.content.react as { text?: string } | undefined)?.text ?? '')

const withoutReactions = (sent: Sent[]): Sent[] =>
    sent.filter((entry) => !('react' in entry.content))

const imageOf = (sent: Sent[]): Buffer | undefined => {
    for (const entry of sent) {
        if (Buffer.isBuffer(entry.content.image)) return entry.content.image
    }
    return undefined
}

function encryptPollVote(
    secret: Uint8Array,
    pollMsgId: string,
    creator: string,
    voter: string,
    option: string,
): { encPayload: Uint8Array; encIv: Uint8Array } {
    const sign = Buffer.concat([
        Buffer.from(pollMsgId),
        Buffer.from(creator),
        Buffer.from(voter),
        Buffer.from('Poll Vote'),
        new Uint8Array([1]),
    ])
    const key0 = hmacSign(secret, new Uint8Array(32), 'sha256')
    const decKey = hmacSign(sign, key0, 'sha256')
    const aad = Buffer.from(`${pollMsgId}\u0000${voter}`)
    const encIv = new Uint8Array(12).fill(1)
    const hashBytes = createHash('sha256').update(option).digest()
    const plaintext = proto.Message.PollVoteMessage.encode({ selectedOptions: [hashBytes] }).finish()
    const encPayload = aesEncryptGCM(plaintext, decKey, encIv, aad)
    return { encPayload, encIv }
}

const ping = await run('.ping', MEMBER, DM)
check('ping replies twice (message + edit)', withoutReactions(ping).length === 2, `sent ${withoutReactions(ping).length}`)
check('ping reports latency', textOf(ping).includes('ms'), textOf(ping))
check(
    'commands show progress and success reactions',
    reactionsOf(ping).includes('⏳') && reactionsOf(ping).includes('✅'),
    JSON.stringify(reactionsOf(ping)),
)
const pingReactions = reactionTexts(ping)
check(
    'commands clear the final reaction',
    pingReactions[pingReactions.length - 1] === '',
    JSON.stringify(pingReactions),
)

const pingCommand = findCommand('ping')
check('ping command is registered', Boolean(pingCommand))
if (pingCommand) {
    const originalRun = pingCommand.run
    let failedPing: Sent[] = []
    const originalError = console.error
    try {
        pingCommand.run = async () => {
            throw new Error('test failure')
        }
        console.error = () => undefined
        failedPing = await run('.ping', '2348888888912@s.whatsapp.net', DM)
    } finally {
        pingCommand.run = originalRun
        console.error = originalError
    }
    check(
        'failed commands report and show an error reaction',
        reactionsOf(failedPing).includes('🛑') && textOf(failedPing).includes('test failure'),
        JSON.stringify(failedPing),
    )
    const failedReactions = reactionTexts(failedPing)
    check(
        'failed commands clear the error reaction after reporting',
        failedReactions[failedReactions.length - 1] === '' &&
            textOf(failedPing).includes('test failure'),
        JSON.stringify(failedReactions),
    )
}

const help = await run('.help', MEMBER, DM)
check('help renders the menu', textOf(help).includes(config.botName))
check(
    'help lists one bold command per line',
    textOf(help).includes('│ ▸ *.ping*\\n') || textOf(help).includes('│ ▸ *.ping*'),
    textOf(help).slice(0, 200),
)
check('help uses the new status header', textOf(help).includes('*Prefix* :'), textOf(help))
const helpDateLine = textOf(help)
    .split('\n')
    .find((line) => line.includes('*Date* :'))
check('help date fits on one line', helpDateLine !== undefined && helpDateLine.length <= 30, helpDateLine)
check(
    'category borders match their opening line',
    textOf(help)
        .split('\n')
        .filter((line) => line.startsWith('╭─〔'))
        .every((top) => {
            const bottom = `╰${'─'.repeat([...top.replace(/\*/g, '')].length - 1)}`
            return textOf(help).includes(bottom)
        }),
    textOf(help).slice(0, 200),
)
check('help hides owner commands from members', !textOf(help).includes('.restart'))

const list = await run('.list', MEMBER, DM)
check(
    'list renders the command catalogue',
    textOf(list).includes('*Commands* :') && textOf(list).includes('*.ping*'),
    textOf(list).slice(0, 200),
)
check(
    'list includes each command function and usage',
    textOf(list).includes('Measure message round-trip latency') && textOf(list).includes('`.ping`'),
    textOf(list).slice(0, 400),
)
check('list hides owner commands from members', !textOf(list).includes('.restart'))
const listCategory = await run('.list general', MEMBER, DM)
check(
    'list filters by category',
    textOf(listCategory).includes('*.ping*') && !textOf(listCategory).includes('*.setgcpp*'),
    textOf(listCategory).slice(0, 300),
)
const listCommand = await run('.list ping', MEMBER, DM)
check(
    'list shows one command card',
    textOf(listCommand).includes('*Function*') && textOf(listCommand).includes('*Usage*'),
    textOf(listCommand),
)
check(
    'group-related commands use the group category',
    ['setgcpp', 'gpp'].every((name) => findCommand(name)?.category === 'group'),
    ['setgcpp', 'gpp'].map((name) => `${name}:${findCommand(name)?.category}`).join(', '),
)
check('disappear stays a general tool', findCommand('disappear')?.category === 'tools', findCommand('disappear')?.category)
check('afk uses the afk category', findCommand('afk')?.category === 'afk', findCommand('afk')?.category)

const unknown = await run('.doesnotexist', MEMBER, DM)
check('unknown commands are ignored', unknown.length === 0, `sent ${unknown.length}`)

const plain = await run('hello there', MEMBER, DM)
check('plain chat is ignored', plain.length === 0, `sent ${plain.length}`)

const banned = await run('.ban @2348333333333', MEMBER, DM)
check('owner-only commands are blocked', textOf(banned).includes('owner-only'))

const notAdmin = await run('.warn @2348333333333 being loud', MEMBER, GROUP)
check('admin-only commands are blocked', textOf(notAdmin).includes('Admins only'))

const groupOnly = await run('.tagall hi', MEMBER, DM)
check('group-only commands are blocked in DMs', textOf(groupOnly).includes('groups'))

const ownerMode = await run('.mode private', OWNER, DM)
check('owner can switch mode', textOf(ownerMode).includes('private'))
const blockedByMode = await run('.ping', MEMBER, DM)
check('private mode ignores members', blockedByMode.length === 0, `sent ${blockedByMode.length}`)
runtime.mode = 'public'

const lidChat = '182119884152917@lid'
const ownerViaLid = await run('.mode public', lidChat, lidChat, { remoteJidAlt: OWNER })
check(
    'owner is recognised through a LID chat (remoteJidAlt)',
    textOf(ownerViaLid).includes('public'),
    textOf(ownerViaLid),
)

const memberViaLid = await run('.mode public', lidChat, lidChat)
check('a bare LID is not treated as owner', textOf(memberViaLid).includes('owner-only'), textOf(memberViaLid))

const SUDO_TARGET = '2348888888913'
const sudoDenied = await run('.sudo', MEMBER, DM)
check('sudo management is owner-only', textOf(sudoDenied).includes('owner-only'), textOf(sudoDenied))
const sudoList = await run('.sudo', OWNER, DM)
check('sudo lists the configured users', textOf(sudoList).includes(`+${config.owners[0]}`), textOf(sudoList))
const sudoAdd = await run(`.setsudo add ${SUDO_TARGET}`, OWNER, DM)
check('setsudo is an alias and can add a user', textOf(sudoAdd).includes('Added') && config.sudo.includes(SUDO_TARGET), textOf(sudoAdd))
check(
    'sudo changes are persisted',
    db.settings().some((setting) => setting.key === 'SUDO' && setting.value.includes(SUDO_TARGET)),
)
await run('.mode private', OWNER, DM)
const sudoPrivate = await run('.id', `${SUDO_TARGET}@s.whatsapp.net`, DM)
check(
    'sudo users can use the bot in private mode',
    textOf(sudoPrivate).includes('Role: sudo'),
    textOf(sudoPrivate),
)
await run('.mode public', OWNER, DM)
const sudoRemove = await run(`.sudo del ${SUDO_TARGET}`, OWNER, DM)
check('sudo can remove a user', textOf(sudoRemove).includes('Removed') && !config.sudo.includes(SUDO_TARGET), textOf(sudoRemove))
const delsudoAdd = await run(`.sudo add ${SUDO_TARGET}`, OWNER, DM)
check('sudo user added again for delsudo', config.sudo.includes(SUDO_TARGET), textOf(delsudoAdd))
const delsudo = await run(`.delsudo ${SUDO_TARGET}`, OWNER, DM)
check('delsudo removes a sudo user', textOf(delsudo).includes('Removed') && !config.sudo.includes(SUDO_TARGET), textOf(delsudo))
const delsudoOwner = await run(`.delsudo ${config.owners[0]}`, OWNER, DM)
check(
    'delsudo explains why an owner stays',
    textOf(delsudoOwner).includes('OWNER_NUMBER') || textOf(delsudoOwner).includes('permanent owner'),
    textOf(delsudoOwner),
)
const sudoClear = await run('.sudo clear', OWNER, DM)
check(
    'sudo clear keeps owners',
    textOf(sudoClear).includes('cleared') && config.sudo.every((number) => config.owners.includes(number)),
    textOf(sudoClear),
)

const adminWarn = await run('.warn @2348333333333 spam', OWNER, GROUP)
check('warn writes a warning', textOf(adminWarn).includes('1/3'), textOf(adminWarn))
check('warning is persisted in sqlite', db.warnings('2348333333333@s.whatsapp.net', GROUP).length === 1)

db.user(WARN_PHONE, 'svn')
const warnLidSock = createSock()
await processMessage(
    warnLidSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'WARNLID1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: `.warn @${WARN_LID_NUMBER} no reason`,
                contextInfo: { mentionedJid: [WARN_LID] },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'warn uses the pushname and hides the raw LID',
    textOf(warnLidSock.sent).includes('*svn* warned (1/3)') &&
        !textOf(warnLidSock.sent).includes(WARN_LID_NUMBER),
    textOf(warnLidSock.sent),
)
check(
    'warn mentions both the LID and phone identity',
    warnLidSock.sent.some((entry) => {
        const mentions = (entry.content.mentions as string[] | undefined) ?? []
        return mentions.includes(WARN_LID) && mentions.includes(WARN_PHONE)
    }),
    JSON.stringify(warnLidSock.sent),
)
check(
    'warn stores the normalised phone identity',
    db.warnings(WARN_PHONE, GROUP).length === 1,
    JSON.stringify(db.warnings(WARN_PHONE, GROUP)),
)

const warningsListSock = createSock()
await processMessage(
    warningsListSock.sock,
    message(`.warnings @${WARN_PHONE.split('@')[0]}`, OWNER, GROUP),
)
check(
    'warnings lists the stored pushname',
    textOf(warningsListSock.sent).includes('*svn* — 1/3'),
    textOf(warningsListSock.sent),
)

const resetWarnSock = createSock()
await processMessage(
    resetWarnSock.sock,
    message(`.resetwarn @${WARN_PHONE.split('@')[0]}`, OWNER, GROUP),
)
check(
    'resetwarn clears the normalised identity',
    db.warnings(WARN_PHONE, GROUP).length === 0,
    JSON.stringify(db.warnings(WARN_PHONE, GROUP)),
)

db.warn(WARN_LID, GROUP, 'legacy warning', 'Owner')
const legacyWarningsSock = createSock()
await processMessage(
    legacyWarningsSock.sock,
    message(`.warnings @${WARN_PHONE.split('@')[0]}`, OWNER, GROUP),
)
check(
    'warnings finds legacy LID rows by phone identity',
    textOf(legacyWarningsSock.sent).includes('*svn* — 1/3') &&
        textOf(legacyWarningsSock.sent).includes('legacy warning'),
    textOf(legacyWarningsSock.sent),
)
const legacyResetSock = createSock()
await processMessage(
    legacyResetSock.sock,
    message(`.resetwarn @${WARN_PHONE.split('@')[0]}`, OWNER, GROUP),
)
check(
    'resetwarn clears legacy LID rows',
    db.warnings(WARN_LID, GROUP).length === 0,
    JSON.stringify(db.warnings(WARN_LID, GROUP)),
)

const welcomeOff = await run('.welcome off', OWNER, GROUP)
check('welcome toggle responds', textOf(welcomeOff).includes('disabled'), textOf(welcomeOff))
check('welcome flag persisted', db.group(GROUP).welcome === 0)

db.ban(MEMBER, true)
const bannedUser = await run('.ping', MEMBER, DM)
check('banned users get a quoted ban notice', bannedUser.length === 1 && textOf(bannedUser).includes('banned'), textOf(bannedUser))
db.ban(MEMBER, false)

const GROUP_BAN = '2348333333333@s.whatsapp.net'
db.user(GROUP_BAN, 'Push Name')
const groupBan = await run('.ban @2348333333333', OWNER, GROUP)
check('group ban also bans from the bot', db.isBanned(GROUP_BAN), JSON.stringify(db.user(GROUP_BAN)))
check('ban shows the stored pushname', textOf(groupBan).includes('Push Name'), textOf(groupBan))
check('ban drops the number when the name is known', !textOf(groupBan).includes('@2348333333333'), textOf(groupBan))
check('group ban includes the group name', textOf(groupBan).includes('Test Group'), textOf(groupBan))
const QUOTE_BAN_TARGET = '2348333333335@s.whatsapp.net'
const quotedBanSock = createSock()
await processMessage(
    quotedBanSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'QUOTEBAN1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: '.ban',
                contextInfo: {
                    stanzaId: 'BOTBANNOTICE1',
                    participant: '2348999999999@s.whatsapp.net',
                    quotedMessage: {
                        extendedTextMessage: {
                            text: 'Banned someone',
                            contextInfo: { mentionedJid: [QUOTE_BAN_TARGET] },
                        },
                    },
                },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'ban uses the mentions of a quoted bot notice',
    db.isBanned(QUOTE_BAN_TARGET) && !db.isBanned('2348999999999@s.whatsapp.net'),
    JSON.stringify({
        target: db.isBanned(QUOTE_BAN_TARGET),
        bot: db.isBanned('2348999999999@s.whatsapp.net'),
        reply: textOf(quotedBanSock.sent),
    }),
)
db.ban(QUOTE_BAN_TARGET, false)

const CACHED_BAN_TARGET = '2348333333336@s.whatsapp.net'
const cachedBanSock = createSock()
await processMessage(
    cachedBanSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'CACHEDTARGET1', participant: CACHED_BAN_TARGET },
        message: { conversation: 'hello there' },
        pushName: 'Cached Target',
    } as unknown as Parameters<typeof processMessage>[1],
)
await processMessage(
    cachedBanSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'CACHEDBAN1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: '.ban',
                contextInfo: {
                    stanzaId: 'CACHEDTARGET1',
                    participant: OWNER,
                    quotedMessage: { conversation: 'hello there' },
                },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'ban uses the cached quoted sender when contextInfo points at the caller',
    db.isBanned(CACHED_BAN_TARGET) && !db.isBanned(OWNER),
    JSON.stringify({
        target: db.isBanned(CACHED_BAN_TARGET),
        owner: db.isBanned(OWNER),
        reply: textOf(cachedBanSock.sent),
    }),
)
check(
    'quoted ban uses the target pushname, not the caller pushname',
    textOf(cachedBanSock.sent).includes('Cached Target') && !textOf(cachedBanSock.sent).includes('*Owner*'),
    textOf(cachedBanSock.sent),
)
db.ban(CACHED_BAN_TARGET, false)

const groupUnban = await run('.unban @2348333333333', OWNER, GROUP)
check('unban clears the bot ban', !db.isBanned(GROUP_BAN), textOf(groupUnban))
check('unban names the user', textOf(groupUnban).includes('Push Name'), textOf(groupUnban))

const FILTER_2 = '2348666666666@s.whatsapp.net'
const FILTER_3 = '2348777777777@s.whatsapp.net'

const filterAdd = await run('.filter add promo | Use code SERA10', MEMBER, DM)
check('filter add confirms the trigger', textOf(filterAdd).includes('SERA10'), textOf(filterAdd))

const filterHit = await run('is there a promo today?', MEMBER, DM)
check('filter replies on a keyword', textOf(filterHit).includes('SERA10'), textOf(filterHit))

const filterList = await run('.filter list', FILTER_2, DM)
check('filter list shows the trigger', textOf(filterList).includes('promo'), textOf(filterList))

const filterDel = await run('.filter del promo', FILTER_3, DM)
check('filter delete confirms', textOf(filterDel).includes('promo'), textOf(filterDel))

const filterGone = await run('is there a promo today?', MEMBER, DM)
check('deleted filter stops replying', filterGone.length === 0, `sent ${filterGone.length}`)

const pin = await run('.pin', OWNER, DM)
check('pin writes chat state', lastMods.some((mod) => JSON.stringify(mod).includes('"pin":true')), JSON.stringify(lastMods))
check('pin confirms to the owner', textOf(pin).includes('pinned'), textOf(pin))

const clear = await run('.clear', OWNER, DM)
check(
    'clear sends a last-message range',
    lastMods.some((mod) => JSON.stringify(mod).includes('"clear":true') && JSON.stringify(mod).includes('TEST')),
    JSON.stringify(lastMods),
)
check('clear confirms to the owner', textOf(clear).includes('Chat cleared'), textOf(clear))

const spamSender = '2348444444444@s.whatsapp.net'
await run('.ping', spamSender, DM)
const spam = await run('.ping', spamSender, DM)
check('cooldown blocks rapid repeats', textOf(spam).includes('Slow down'), textOf(spam))

const weatherUsage = await run('.weather', MEMBER, DM)
check('weather asks for a city', textOf(weatherUsage).includes('Usage: .weather'), textOf(weatherUsage))
const currencyUsage = await run('.currency 10 usd', MEMBER, DM)
check('currency asks for both currencies', textOf(currencyUsage).includes('Usage: .currency'), textOf(currencyUsage))
const qrUsage = await run('.qr', MEMBER, DM)
check('qr asks for text', textOf(qrUsage).includes('Usage: .qr'), textOf(qrUsage))
const wikiUsage = await run('.wiki', MEMBER, DM)
check('wiki asks for a topic', textOf(wikiUsage).includes('Usage: .wiki'), textOf(wikiUsage))
const defineUsage = await run('.define', MEMBER, DM)
check('define asks for a word', textOf(defineUsage).includes('Usage: .define'), textOf(defineUsage))
const translateUsage = await run('.translate', MEMBER, DM)
check('translate asks for a language', textOf(translateUsage).includes('Usage: .translate'), textOf(translateUsage))

const realFetch = globalThis.fetch
let apiCalls = 0
globalThis.fetch = (async (input: string | URL | Request) => {
    apiCalls += 1
    const url = String(input)
    if (url.includes('geocoding-api')) {
        return new Response(
            JSON.stringify({ results: [{ name: 'Lagos', country: 'Nigeria', latitude: 6.45, longitude: 3.39 }] }),
            { status: 200 },
        )
    }
    return new Response(
        JSON.stringify({
            current: {
                temperature_2m: 28.4,
                apparent_temperature: 31.1,
                relative_humidity_2m: 74,
                wind_speed_10m: 12,
                weather_code: 2,
            },
            current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
        }),
        { status: 200 },
    )
}) as typeof fetch
const weatherOk = await run('.weather Lagos', CATEGORY_USER, DM)
globalThis.fetch = realFetch
check(
    'weather reports the current conditions',
    apiCalls === 2 && textOf(weatherOk).includes('Lagos, Nigeria') && textOf(weatherOk).includes('28.4'),
    textOf(weatherOk),
)

const categoryHelp = await run('.help general', CATEGORY_USER, DM)
check('help filters by category', textOf(categoryHelp).includes('.ping'), textOf(categoryHelp))

const noteAdd = await run('.note buy milk', CATEGORY_USER, DM)
check('note is saved', textOf(noteAdd).includes('Note'), textOf(noteAdd))
const noteList = await run('.notes', CATEGORY_USER, DM)
check('note appears in the list', textOf(noteList).includes('buy milk'), textOf(noteList))

const notePrompt = await run('.note', NOTE_PROMPT_USER, DM)
check('note without text starts a prompt', textOf(notePrompt).includes('Send the note text'), textOf(notePrompt))
const notePromptSave = await run('buy bread', NOTE_PROMPT_USER, DM)
check('note prompt saves the next message', textOf(notePromptSave).includes('saved'), textOf(notePromptSave))
const notePromptList = await run('.notes', NOTE_PROMPT_USER, DM)
check('note prompt result appears in the list', textOf(notePromptList).includes('buy bread'), textOf(notePromptList))

const pick = await run('.pick a | b', CATEGORY_USER, DM)
check('pick returns one option', /a|b/.test(textOf(pick)), textOf(pick))

const disappearDm = await run('.disappear 24h', CATEGORY_USER, DM)
check(
    'disappear works in direct chats',
    disappearDm.some((entry) => entry.content.disappearingMessagesInChat === 86400) &&
        textOf(disappearDm).includes('24h'),
    JSON.stringify(disappearDm),
)

const poll = await run('.poll best?; a, b', MEMBER, GROUP)
check('poll creates a poll', JSON.stringify(poll).includes('"poll"'), JSON.stringify(poll))
const pollDm = await run('.poll best?; a, b', POLL_DM_USER, DM)
check('poll works in direct chats', JSON.stringify(pollDm).includes('"poll"'), JSON.stringify(pollDm))

const pollCreatorLid = '152317391294519@lid'
const pollSecret = new Uint8Array(32).fill(9)
const pollHarness = createSock()
Object.defineProperty(pollHarness.sock, 'user', {
    value: { id: '2348999999999:1@s.whatsapp.net', lid: pollCreatorLid },
})
let pollChoice = ''
const sentPoll = await sendPoll(
    pollHarness.sock,
    POLL_TEST_USER,
    message('', POLL_TEST_USER, POLL_TEST_USER),
    'Pick one',
    ['alpha', 'beta'],
    (selection) => {
        pollChoice = selection.option
    },
    pollSecret,
)
const pollId = (sentPoll as { key?: { id?: string } } | undefined)?.key?.id ?? ''
const pollVote = encryptPollVote(pollSecret, pollId, pollCreatorLid, pollCreatorLid, 'beta')
await handlePollUpdate(
    pollHarness.sock,
    {
        key: {
            remoteJid: POLL_TEST_USER,
            fromMe: false,
            id: 'POLLVOTE1',
            participant: pollCreatorLid,
        },
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: pollId, remoteJid: POLL_TEST_USER, fromMe: true },
                vote: pollVote,
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
    POLL_TEST_USER,
    pollCreatorLid,
)
check('poll votes select the matching option', pollChoice === 'beta', pollChoice)

const groupPollHarness = createSock()
Object.defineProperty(groupPollHarness.sock, 'user', {
    value: { id: '2348999999999:1@s.whatsapp.net', lid: pollCreatorLid },
})
let groupPollChoice = ''
const groupPollSecret = new Uint8Array(32).fill(8)
const groupPoll = await sendPoll(
    groupPollHarness.sock,
    GROUP,
    message('', POLL_GROUP_USER, GROUP),
    'Group pick',
    ['alpha', 'beta'],
    (selection) => {
        groupPollChoice = selection.option
    },
    groupPollSecret,
)
const groupPollId = (groupPoll as { key?: { id?: string } } | undefined)?.key?.id ?? ''
const groupVote = encryptPollVote(groupPollSecret, groupPollId, pollCreatorLid, POLL_GROUP_USER, 'beta')
await processMessage(
    groupPollHarness.sock,
    {
        key: {
            remoteJid: GROUP,
            fromMe: false,
            id: 'POLLVOTEGROUP1',
            participant: POLL_GROUP_USER,
        },
        message: {
            senderKeyDistributionMessage: {},
            pollUpdateMessage: {
                pollCreationMessageKey: { id: groupPollId, remoteJid: GROUP, fromMe: true },
                vote: groupVote,
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check('group poll votes survive sender-key wrappers', groupPollChoice === 'beta', groupPollChoice)

const devicePollHarness = createSock()
Object.defineProperty(devicePollHarness.sock, 'user', {
    value: { id: '2348999999999:72@s.whatsapp.net', lid: '152317391294519:72@lid' },
})
let devicePollChoice = ''
const devicePollSecret = new Uint8Array(32).fill(7)
const devicePoll = await sendPoll(
    devicePollHarness.sock,
    GROUP,
    message('', POLL_GROUP_USER, GROUP),
    'Device JID pick',
    ['alpha', 'beta'],
    (selection) => {
        devicePollChoice = selection.option
    },
    devicePollSecret,
)
const devicePollId = (devicePoll as { key?: { id?: string } } | undefined)?.key?.id ?? ''
const deviceVoter = '187939950723213:5@lid'
const deviceVote = encryptPollVote(
    devicePollSecret,
    devicePollId,
    '152317391294519:72@lid',
    deviceVoter,
    'beta',
)
await processMessage(
    devicePollHarness.sock,
    {
        key: {
            remoteJid: GROUP,
            fromMe: false,
            id: 'POLLVOTEDEVICE1',
            participant: deviceVoter,
            participantAlt: POLL_GROUP_USER,
        },
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: devicePollId, remoteJid: GROUP, fromMe: true },
                vote: deviceVote,
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check('poll votes accept device JIDs and LID voters', devicePollChoice === 'beta', devicePollChoice)

const NEXT_WORD: Record<string, string> = {
    a: 'apple',
    b: 'banana',
    c: 'crane',
    d: 'dream',
    e: 'eagle',
    f: 'flame',
    g: 'grape',
    h: 'honey',
    i: 'ivory',
    j: 'jelly',
    k: 'knife',
    l: 'lemon',
    m: 'mango',
    n: 'night',
    o: 'ocean',
    p: 'piano',
    q: 'queen',
    r: 'roast',
    s: 'stone',
    t: 'tiger',
    u: 'unity',
    v: 'voice',
    w: 'water',
    x: 'xenon',
    y: 'youth',
    z: 'zebra',
}
const ALT_NEXT: Record<string, string> = {
    a: 'able',
    b: 'beach',
    c: 'cable',
    d: 'dance',
    e: 'earth',
    f: 'faith',
    g: 'glass',
    h: 'horse',
    i: 'image',
    j: 'joint',
    k: 'known',
    l: 'laser',
    m: 'magic',
    n: 'noise',
    o: 'olive',
    p: 'paint',
    q: 'quick',
    r: 'radio',
    s: 'scale',
    t: 'table',
    u: 'uncle',
    v: 'value',
    w: 'wheel',
    x: 'xerox',
    y: 'young',
    z: 'zesty',
}
const pickChainWord = (letter: string, used: Set<string>): string => {
    for (const candidate of [NEXT_WORD[letter], ALT_NEXT[letter]]) {
        if (candidate && !used.has(candidate)) return candidate
    }
    return ''
}
const wcgLobbySeconds = Math.round(config.wordchain.joinMs / 1000)
const wcgLobby = await run('.wcg', WCG_USER, DM)
check('wcg opens a lobby in direct chats', textOf(wcgLobby).includes('lobby open'), textOf(wcgLobby))
check('wcg lobby waits 30 seconds by default', wcgLobbySeconds === 30, String(wcgLobbySeconds))
const dmJoinSock = createSock()
await processMessage(dmJoinSock.sock, message('join', WCG_USER, DM))
check('wcg starts a solo game only after join', textOf(dmJoinSock.sent).includes('Word chain started'), textOf(dmJoinSock.sent))
const dmFirstWord = /First word\s*:\s*\*([a-z]+)\*/.exec(textOf(dmJoinSock.sent))?.[1] ?? ''
const dmChainWord = pickChainWord(dmFirstWord.slice(-1), new Set([dmFirstWord]))
const dmTurnSock = createSock()
await processMessage(dmTurnSock.sock, message(dmChainWord, WCG_USER, DM))
check('wcg accepts a direct-chat turn', textOf(dmTurnSock.sent).includes('accepted'), textOf(dmTurnSock.sent))
await run('.wcg stop', WCG_USER, DM)

// Difficulty starts at 4 letters and grows after three accepted words.
const DIFFICULTY_USER = '2348888888914@s.whatsapp.net'
await run('.wcg', DIFFICULTY_USER, DM)
const difficultyStart = await run('join', DIFFICULTY_USER, DM)
const difficultyFirst = /First word\s*:\s*\*([a-z]+)\*/.exec(textOf(difficultyStart))?.[1] ?? ''
const difficultyUsed = new Set([difficultyFirst])
let difficultyWord = pickChainWord(difficultyFirst.slice(-1), difficultyUsed)
let difficultyReply: Sent[] = []
for (let turn = 0; turn < 3; turn += 1) {
    difficultyReply = await run(difficultyWord, DIFFICULTY_USER, DM)
    if (!textOf(difficultyReply).includes('accepted')) break
    difficultyUsed.add(difficultyWord)
    difficultyWord = pickChainWord(difficultyWord.slice(-1), difficultyUsed)
}
check(
    'wcg raises the minimum word length after a few turns',
    textOf(difficultyReply).includes('Minimum letters : *5*'),
    textOf(difficultyReply),
)
await run('.wcg stop', DIFFICULTY_USER, DM)

const lobbySock = createSock()
await processMessage(lobbySock.sock, message('.wcg', WCG_GROUP_USER, WCG_GROUP))
check('wcg opens a group lobby', textOf(lobbySock.sent).includes('lobby open'), textOf(lobbySock.sent))
const soloStartSock = createSock()
await processMessage(soloStartSock.sock, message('.wcg start', WCG_GROUP_USER, WCG_GROUP))
check(
    'wcg will not start a group game with one player',
    textOf(soloStartSock.sent).includes('At least *2* players are needed'),
    textOf(soloStartSock.sent),
)
const starterJoinSock = createSock()
await processMessage(starterJoinSock.sock, message('join', WCG_GROUP_USER, WCG_GROUP))
check('wcg lets the starter join with plain join', textOf(starterJoinSock.sent).includes('joined'), textOf(starterJoinSock.sent))
const joinLobbySock = createSock()
await processMessage(joinLobbySock.sock, message('join', WCG_GROUP_JOINER, WCG_GROUP))
check('wcg lets players join with plain join', textOf(joinLobbySock.sent).includes('joined'), textOf(joinLobbySock.sent))
const startGroupSock = createSock()
await processMessage(startGroupSock.sock, message('.wcg start', WCG_GROUP_USER, WCG_GROUP))
check('wcg starts a group game after joining', textOf(startGroupSock.sent).includes('Word chain started'), textOf(startGroupSock.sent))

const groupStartWord = /First word\s*:\s*\*([a-z]+)\*/.exec(textOf(startGroupSock.sent))?.[1] ?? ''
const groupChainWord = pickChainWord(groupStartWord.slice(-1), new Set([groupStartWord]))
config.wordchain.turnMs = 40
await processMessage(lobbySock.sock, message(groupChainWord, WCG_GROUP_USER, WCG_GROUP))
check(
    'wcg accepts a group turn',
    textOf(lobbySock.sent).includes('accepted'),
    textOf(lobbySock.sent),
)
await sleep(150)
check(
    'wcg disqualifies a player who misses the turn timer',
    textOf(lobbySock.sent).includes('disqualified'),
    textOf(lobbySock.sent),
)
check(
    'wcg ends when one player remains',
    textOf(lobbySock.sent).includes('wins the word chain'),
    textOf(lobbySock.sent),
)
check(
    'wcg records the win on the winner profile',
    (db.gameStat(WCG_GROUP_USER)?.wins ?? 0) >= 1,
    JSON.stringify(db.gameStat(WCG_GROUP_USER)),
)
check(
    'wcg records the loss on the disqualified profile',
    (db.gameStat(WCG_GROUP_JOINER)?.losses ?? 0) >= 1,
    JSON.stringify(db.gameStat(WCG_GROUP_JOINER)),
)
check(
    'wcg records the per-game breakdown',
    db.gameBreakdown(WCG_GROUP_USER).some((row) => row.game === 'wordchain' && row.wins >= 1),
    JSON.stringify(db.gameBreakdown(WCG_GROUP_USER)),
)
const wcgStreak = await run('.streak', WCG_GROUP_USER, DM, {}, 'Chain Winner')
check(
    'wcg wins appear in the cross-game streak',
    textOf(wcgStreak).includes('Word chain — 1W/0L/0D'),
    textOf(wcgStreak),
)
config.wordchain.turnMs = 30_000

const theme = await run('.theme IZUKU', THEME_USER, DM)
check('theme can be changed', textOf(theme).includes('IZUKU'), textOf(theme))
await sleep(1600)
const themeList = await run('.theme list', THEME_USER, DM)
check(
    'theme list includes every legacy theme',
    ['ADAM', 'AYANOKOJI', 'CODM', 'EDITH', 'FRIDAY', 'GARENA', 'GENOS', 'GIDEON', 'GOKU', 'IZUKU', 'LUFFY', 'NARUTO', 'NEZUKO', 'PARKER', 'SAITAMA', 'SECKTOR', 'SUKUNA'].every(
        (name) => textOf(themeList).includes(name),
    ),
    textOf(themeList),
)
const themedHelp = await run('.help', THEME_USER, DM)
check('theme changes the menu header', textOf(themedHelp).includes('IZUKU-DEKU'), textOf(themedHelp))
check(
    'theme menu includes a legacy image',
    themedHelp.some((entry) => Boolean(entry.content.image)),
    JSON.stringify(themedHelp),
)

const THEME_POLL_GROUP = '120363000000000111@g.us'
const THEME_POLL_USER = '2348888888911@s.whatsapp.net'
const themePollSock = createSock()
await processMessage(themePollSock.sock, message('.theme', THEME_POLL_USER, THEME_POLL_GROUP))
const themePollIndex = themePollSock.sent.findIndex((entry) => Boolean(entry.content.poll))
const themePollId = `msg-${themePollIndex + 1}`
const pollPayload = themePollSock.sent[themePollIndex]?.content.poll as { messageSecret: Uint8Array } | undefined
const themePollSecret = pollPayload?.messageSecret as Uint8Array
const themeVote = encryptPollVote(
    themePollSecret,
    themePollId,
    '2348999999999@s.whatsapp.net',
    THEME_POLL_USER,
    'IZUKU',
)
await processMessage(
    themePollSock.sock,
    {
        key: { remoteJid: THEME_POLL_GROUP, fromMe: false, id: 'THEMEVOTE1', participant: THEME_POLL_USER },
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: themePollId, remoteJid: THEME_POLL_GROUP, fromMe: true },
                vote: themeVote,
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check('theme poll vote confirms the change', textOf(themePollSock.sent).includes('Theme: IZUKU'), textOf(themePollSock.sent))
const themePollHelp = createSock()
await processMessage(themePollHelp.sock, message('.help', THEME_POLL_USER, THEME_POLL_GROUP))
check(
    'theme poll changes the menu in group chats',
    textOf(themePollHelp.sent).includes('IZUKU-DEKU'),
    textOf(themePollHelp.sent),
)

const SELF_THEME_CHAT = '2348888888912@s.whatsapp.net'
const selfThemeSock = createSock()
await processMessage(
    selfThemeSock.sock,
    {
        key: { remoteJid: SELF_THEME_CHAT, fromMe: true, id: 'SELFTHEME1' },
        message: { conversation: '.theme IZUKU' },
        pushName: 'Excel',
    } as unknown as Parameters<typeof processMessage>[1],
)
const selfThemeHelp = createSock()
await processMessage(
    selfThemeHelp.sock,
    {
        key: { remoteJid: SELF_THEME_CHAT, fromMe: true, id: 'SELFHELP1' },
        message: { conversation: '.help' },
        pushName: 'Excel',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'theme chosen from the bot account sticks to the bot account',
    textOf(selfThemeHelp.sent).includes('IZUKU-DEKU'),
    textOf(selfThemeHelp.sent),
)

const SELF_POLL_CHAT = '2348888888913@s.whatsapp.net'
const selfPollSock = createSock()
await processMessage(
    selfPollSock.sock,
    {
        key: { remoteJid: SELF_POLL_CHAT, fromMe: true, id: 'SELFPOLL1' },
        message: { conversation: '.theme' },
        pushName: 'Excel',
    } as unknown as Parameters<typeof processMessage>[1],
)
const selfPollIndex = selfPollSock.sent.findIndex((entry) => Boolean(entry.content.poll))
const selfPollId = `msg-${selfPollIndex + 1}`
const selfPollPayload = selfPollSock.sent[selfPollIndex]?.content.poll as
    | { messageSecret: Uint8Array }
    | undefined
const selfPollVote = encryptPollVote(
    selfPollPayload?.messageSecret as Uint8Array,
    selfPollId,
    '2348999999999@s.whatsapp.net',
    '2348999999999@s.whatsapp.net',
    'ADAM',
)
await processMessage(
    selfPollSock.sock,
    {
        key: { remoteJid: SELF_POLL_CHAT, fromMe: true, id: 'SELFPOLLVOTE1' },
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: selfPollId, remoteJid: SELF_POLL_CHAT, fromMe: true },
                vote: selfPollVote,
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'theme poll selected from the bot account is stored for the bot account',
    db.theme('2348999999999@s.whatsapp.net') === 'ADAM' &&
        textOf(selfPollSock.sent).includes('Theme: ADAM'),
    `${db.theme('2348999999999@s.whatsapp.net')} | ${textOf(selfPollSock.sent)}`,
)

const botStatus = await run('.botstatus', MEMBER, DM)
check('botstatus shows the bot status', textOf(botStatus).includes('State : online'), textOf(botStatus))

const userAbout = await run('.about @2348111111111', STATUS_USER, DM)
check('about shows a user about status', textOf(userAbout).includes('Testing status'), textOf(userAbout))

const emptyAbout = createSock()
emptyAbout.sock.fetchStatus = async () => []
await processMessage(emptyAbout.sock, message('.about @2348111111111', STATUS_USER, DM))


const setAboutSock = createSock()
let aboutWritten = ''
setAboutSock.sock.updateProfileStatus = async (text: string) => {
    aboutWritten = text
}
setAboutSock.sock.fetchStatus = async () => [{ id: 'self', status: { status: 'old about' } }]
await processMessage(setAboutSock.sock, message('.setabout new about', OWNER, DM))
check('setabout replies immediately', textOf(setAboutSock.sent).includes('About status updated'), textOf(setAboutSock.sent))
check('setabout sends the new text', aboutWritten === 'new about', aboutWritten)

const runtimeInfo = await run('.runtime', MEMBER, DM)
check('runtime shows process details', textOf(runtimeInfo).includes('Runtime : Bun'), textOf(runtimeInfo))

const autoStatusOn = await run('.status on', OWNER, DM)
check('status can enable auto viewing', textOf(autoStatusOn).includes('status viewing on'), textOf(autoStatusOn))
const statusDelay = await run('.status delay 2', OWNER, DM)
check('status can delay viewing', textOf(statusDelay).includes('2s'), textOf(statusDelay))
const statusReact = await run('.status react 😼', OWNER, DM)
check('status reactions can be configured', textOf(statusReact).includes('😼'), textOf(statusReact))
await run('.status delay 0', OWNER, DM)

const statusSock = createSock()
await processMessage(
    statusSock.sock,
    {
        key: {
            remoteJid: 'status@broadcast',
            fromMe: false,
            id: 'STATUS1',
            participant: '152317391294519@lid',
        },
        message: { conversation: 'status update' },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'status view reads with a normalized phone JID',
    JSON.stringify(statusSock.receipts).includes(MEMBER),
    JSON.stringify(statusSock.receipts),
)
check(
    'status view sends a real read receipt',
    statusSock.receipts.some((entry) => entry.type === 'read' && entry.jid === 'status@broadcast'),
    JSON.stringify(statusSock.receipts),
)
check(
    'status view reacts with the chosen emoji',
    JSON.stringify(statusSock.sent).includes('😼'),
    JSON.stringify(statusSock.sent),
)

const ownStatusSock = createSock()
await processMessage(
    ownStatusSock.sock,
    {
        key: {
            remoteJid: 'status@broadcast',
            fromMe: true,
            id: 'STATUSOWN1',
            participant: '152317391294519@lid',
        },
        message: { conversation: 'my own status' },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'status view ignores the bot\'s own statuses',
    ownStatusSock.reads.length === 0 && ownStatusSock.receipts.length === 0,
    JSON.stringify({ reads: ownStatusSock.reads, receipts: ownStatusSock.receipts }),
)

const statusReactionSock = createSock()
await processMessage(
    statusReactionSock.sock,
    {
        key: {
            remoteJid: 'status@broadcast',
            fromMe: false,
            id: 'STATUSREACT1',
            participant: MEMBER,
        },
        message: {
            reactionMessage: {
                text: '🔥',
                key: { remoteJid: 'status@broadcast', fromMe: false, id: 'STATUS1', participant: MEMBER },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'status view ignores reactions instead of re-reacting',
    statusReactionSock.reads.length === 0 &&
        statusReactionSock.receipts.length === 0 &&
        statusReactionSock.sent.length === 0,
    JSON.stringify({
        reads: statusReactionSock.reads,
        receipts: statusReactionSock.receipts,
        sent: statusReactionSock.sent,
    }),
)

await run('.status react off', OWNER, DM)
const autoStatusOff = await run('.autostatus off', OWNER, DM)
check('autostatus aliases status', textOf(autoStatusOff).includes('status viewing off'), textOf(autoStatusOff))

const saveHint = await run('.save', OWNER, GROUP)
check('save asks for a replied message', textOf(saveHint).includes('Reply to a message'), textOf(saveHint))

const saveSock = createSock()
await processMessage(
    saveSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'SAVE1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: `.save`,
                contextInfo: { quotedMessage: { conversation: 'keep this text' } },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'save forwards the replied message to the personal chat',
    saveSock.sent.some(
        (entry) => entry.jid === OWNER && String(entry.content.text ?? '') === 'keep this text',
    ) && saveSock.sent.every((entry) => entry.jid === OWNER || entry.jid === GROUP),
    JSON.stringify(saveSock.sent),
)
check(
    'save only reacts in the group, it does not post the saved content',
    saveSock.sent
        .filter((entry) => entry.jid === GROUP)
        .every((entry) => 'react' in entry.content),
    JSON.stringify(saveSock.sent),
)

const savePublicSock = createSock()
await processMessage(
    savePublicSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'SAVE2', participant: MEMBER },
        message: {
            extendedTextMessage: {
                text: `.save`,
                contextInfo: { quotedMessage: { conversation: 'not for you' } },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
const savePublicMessages = withoutReactions(savePublicSock.sent)
check(
    'save is refused for non-owner users',
    savePublicMessages.length === 1 &&
        savePublicMessages[0]?.jid === GROUP &&
        String(savePublicMessages[0]?.content.text ?? '').includes('owner-only'),
    JSON.stringify(savePublicSock.sent),
)

const statusCacheSock = createSock()
await processMessage(
    statusCacheSock.sock,
    {
        key: { remoteJid: 'status@broadcast', fromMe: false, id: 'STATUSCACHE1', participant: STATUS_USER },
        message: { conversation: 'status caption text' },
        pushName: 'Status Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)

const statusReplySock = createSock()
await processMessage(
    statusReplySock.sock,
    {
        key: { remoteJid: DM, fromMe: false, id: 'SAVE3', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: `.save`,
                contextInfo: {
                    remoteJid: 'status@broadcast',
                    stanzaId: 'STATUSCACHE1',
                    participant: STATUS_USER,
                },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'save forwards a replied status from the status cache',
    statusReplySock.sent.some(
        (entry) => entry.jid === OWNER && String(entry.content.text ?? '') === 'status caption text',
    ),
    JSON.stringify(statusReplySock.sent),
)

const statusAfterSave = createSock()
await processMessage(
    statusAfterSave.sock,
    {
        key: { remoteJid: 'status@broadcast', fromMe: false, id: 'STATUSNOSAVE', participant: STATUS_USER },
        message: { conversation: 'status stays private' },
        pushName: 'Status Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'statuses are not forwarded automatically',
    statusAfterSave.receipts.length === 0 && statusAfterSave.sent.length === 0,
    JSON.stringify(statusAfterSave.sent),
)

const STICKER_HASH_BYTES = Uint8Array.from([7, 7, 7, 7, 7])
const stickerBindSock = createSock()
await processMessage(
    stickerBindSock.sock,
    {
        key: { remoteJid: DM, fromMe: false, id: 'SETSTICKER1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: '.setsticker save',
                contextInfo: {
                    quotedMessage: {
                        stickerMessage: { fileSha256: STICKER_HASH_BYTES, mimetype: 'image/webp' },
                    },
                },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'setsticker binds a command to a quoted sticker',
    textOf(stickerBindSock.sent).includes('Sticker saved') && textOf(stickerBindSock.sent).includes('.save'),
    textOf(stickerBindSock.sent),
)
const stickerList = await run('.setsticker list', OWNER, DM)
check('setsticker lists saved sticker commands', textOf(stickerList).includes('.save'), textOf(stickerList))

const stickerTriggerSock = createSock()
await processMessage(
    stickerTriggerSock.sock,
    {
        key: { remoteJid: DM, fromMe: false, id: 'STICKERTRIGGER1', participant: OWNER },
        message: {
            stickerMessage: {
                fileSha256: STICKER_HASH_BYTES,
                mimetype: 'image/webp',
                contextInfo: { quotedMessage: { conversation: 'saved by sticker' } },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'using a bound sticker runs its command',
    stickerTriggerSock.sent.some(
        (entry) => entry.jid === OWNER && String(entry.content.text ?? '') === 'saved by sticker',
    ),
    JSON.stringify(stickerTriggerSock.sent),
)

const stickerNonOwnerSock = createSock()
await processMessage(
    stickerNonOwnerSock.sock,
    {
        key: { remoteJid: DM, fromMe: false, id: 'STICKERTRIGGER2', participant: MEMBER },
        message: {
            stickerMessage: {
                fileSha256: STICKER_HASH_BYTES,
                mimetype: 'image/webp',
                contextInfo: { quotedMessage: { conversation: 'not for you' } },
            },
        },
        pushName: 'Member',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'sticker triggers stay owner-only',
    !stickerNonOwnerSock.sent.some((entry) => String(entry.content.text ?? '').includes('not for you')),
    JSON.stringify(stickerNonOwnerSock.sent),
)

// ffmpeg's bundled WebP decoder rejects animated WebP frames, so toMp4 routes
// them through sharp/libvips and an animated GIF before encoding.
const animatedWebp = Buffer.from(
    'UklGRmoCAABXRUJQVlA4WAoAAAASAAAADwAADwAAQU5JTQYAAAD/////AABBTk1GGgEAAAAAAAAAAA8AAA8AAPQBAABWUDggAgEAAJAFAJ0BKhAAEAACADQlsAJ0cjO1Sf1m31XgAOkY/VX/VerHcgK4BUbc0TfAP1ALZ5ky3rtAAP75Z+J4tyh/ll5vUubBNnKC3h+TRC8d3OlT9HMHMPe5jME4HNecbGvfJM5YIvH0vi3w65/+/8zqoTj5u59BXUnz/r/sZsxMN/QdU1rRF44o7qxT3PYA3GtOrPnEz4BnqchxCSnm/MQKixA8ZLv/xMfLnhvdccJdPr/5X8uUPS8zXj2iT9/GJzI/rXkTsUfPxpB/r9MRwdj8venaMp9dF/P+6nXFf5ptvQe8z2cJ39eVbOsVou//RrXEu+lFx//tU3FKZ/6PTRW6q4roAEFOTUYcAQAAAAAAAAAADwAADwAA9AEAAFZQOCAEAQAAEAUAnQEqEAAQAAIANCWwAnRvgFyV7rNwAHSN/qr6IlyANjFmf74B+oBbPMmX4tauAAD++Wf04amu/9jQhEz5ocR2A3Mb659wlUzvtE8eBu/fOhd3gVXmvONgXHkecmhm7tB6yTBhn/vlNKBSjPSqEHV1/XWCn+F55us0Xjho8a/nz0yj26e84SIA81DlxF6tx99l/78989rCmNmz22xlgrYAf/x2+F9Pu+Htqkvi//MvNItq9o0Aaq3t31vulP4/0wH+bWMWZ76cBVTKJAofmhPGfeuWGX/dRPwD8crKVd5UtNIfbiH7de/DEb/y2XOTH7aAWTpuK/5qcf/rl5iZf/8iwAA=',
    'base64',
)
const animatedMp4 = await toMp4(animatedWebp, 'webp')
check(
    'tovideo converts animated webp through sharp',
    animatedMp4.length > 0 && animatedMp4.subarray(4, 8).toString() === 'ftyp',
    `mp4 bytes ${animatedMp4.length}`,
)

await run('.react 😼', REACT_USER, DM)
const reactMessage = await run('hello there', REACT_USER, DM)
check('react uses the chosen emoji', JSON.stringify(reactMessage).includes('😼'), JSON.stringify(reactMessage))
const reactCommand = await run('.notacommand', REACT_USER, DM)
check('react also acknowledges command-like messages', JSON.stringify(reactCommand).includes('😼'), JSON.stringify(reactCommand))
await run('.react off', REACT_USER, DM)
const reactOff = await run('hello again', REACT_USER, DM)
check('react off disables reactions for the chat', !JSON.stringify(reactOff).includes('"react"'), JSON.stringify(reactOff))

const GLOBAL_REACT_USER = '2348888888910@s.whatsapp.net'
const GLOBAL_REACT_CHAT = '2348888888911@s.whatsapp.net'
config.features.autoReaction = true
const globalReact = await run('hello globally', GLOBAL_REACT_USER, GLOBAL_REACT_CHAT)
db.setAutoreact(GLOBAL_REACT_CHAT, false)
const globalReactOff = await run('hello again globally', GLOBAL_REACT_USER, GLOBAL_REACT_CHAT)
config.features.autoReaction = false
check('global auto reaction is the fallback', JSON.stringify(globalReact).includes('✅'), JSON.stringify(globalReact))
check(
    'an explicit react off overrides the global fallback',
    !JSON.stringify(globalReactOff).includes('"react"'),
    JSON.stringify(globalReactOff),
)

const whois = await run('.whois', MEMBER, GROUP)
check('whois shows the stored pushname', textOf(whois).includes('Tester'), textOf(whois))

const quotedWhoisSock = createSock()
await processMessage(
    quotedWhoisSock.sock,
    {
        key: {
            remoteJid: GROUP,
            fromMe: false,
            id: 'QUOTED1',
            participant: QUOTED_USER,
        },
        message: {
            extendedTextMessage: {
                text: '.whois',
                contextInfo: {
                    participant: '152317391294519@lid',
                    quotedMessage: { conversation: 'hello' },
                },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'whois resolves a quoted LID user',
    textOf(quotedWhoisSock.sent).includes('Tester'),
    textOf(quotedWhoisSock.sent),
)

db.user(TARGET_USER, 'Quoted Target')
const mentionWhoisSock = createSock()
await processMessage(
    mentionWhoisSock.sock,
    {
        key: {
            remoteJid: GROUP,
            fromMe: false,
            id: 'MENTION1',
            participant: MENTION_WHOIS_USER,
        },
        message: {
            extendedTextMessage: {
                text: `.who @${TARGET_USER.split('@')[0]}`,
                contextInfo: {
                    participant: MENTION_WHOIS_USER,
                    mentionedJid: [TARGET_USER],
                },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'whois prefers the mentioned user over the caller',
    textOf(mentionWhoisSock.sent).includes('Quoted Target'),
    textOf(mentionWhoisSock.sent),
)

const pp = await run('.pp @2348111111111', PP_USER, DM)
check('pp shows the user name in the caption', JSON.stringify(pp).includes('Tester'), JSON.stringify(pp))

const ppLidSock = createSock()
await processMessage(
    ppLidSock.sock,
    {
        key: {
            remoteJid: GROUP,
            fromMe: false,
            id: 'PPLID1',
            participant: PP_LID_USER,
        },
        message: {
            extendedTextMessage: {
                text: '.pp',
                contextInfo: {
                    participant: '152317391294519@lid',
                    quotedMessage: { conversation: 'hello' },
                },
            },
        },
        pushName: 'Tester',
    } as unknown as Parameters<typeof processMessage>[1],
)
check('pp resolves a quoted LID user', JSON.stringify(ppLidSock.sent).includes('Tester'), JSON.stringify(ppLidSock.sent))

const ginfo = await run('.ginfo', MEMBER, GROUP)
check('ginfo shows the group subject', textOf(ginfo).includes('Test Group'), textOf(ginfo))

const groupLink = await run('.group link', OWNER, GROUP)
check(
    'group command returns the invite link',
    textOf(groupLink).includes('chat.whatsapp.com/invite-code'),
    textOf(groupLink),
)
const groupSubjectSock = createSock()
await processMessage(groupSubjectSock.sock, message('.group subject Renamed Group', OWNER, GROUP))
check(
    'group command updates the subject',
    JSON.stringify(groupSubjectSock.mods).includes('Renamed Group') &&
        textOf(groupSubjectSock.sent).includes('updated'),
    JSON.stringify({ mods: groupSubjectSock.mods, sent: groupSubjectSock.sent }),
)
const groupDescSock = createSock()
await processMessage(groupDescSock.sock, message('.group desc New description', OWNER, GROUP))
check(
    'group command updates the description',
    JSON.stringify(groupDescSock.mods).includes('New description') &&
        textOf(groupDescSock.sent).includes('updated'),
    JSON.stringify({ mods: groupDescSock.mods, sent: groupDescSock.sent }),
)
const groupCreateSock = createSock()
await processMessage(
    groupCreateSock.sock,
    {
        key: { remoteJid: DM, fromMe: false, id: 'GROUPCREATE1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: '.group create Bot Test @2348111111111',
                contextInfo: { mentionedJid: [MEMBER] },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'group command creates a group with mentioned members',
    textOf(groupCreateSock.sent).includes('created') &&
        textOf(groupCreateSock.sent).includes('chat.whatsapp.com/invite-code') &&
        groupCreateSock.sent.some((entry) => entry.jid === '120363000000000777@g.us'),
    JSON.stringify(groupCreateSock.sent),
)

const groupCreatePlainSock = createSock()
await processMessage(
    groupCreatePlainSock.sock,
    message('.group create Izuku-rebirth 2348118489638', OWNER, DM),
)
const plainCreate = (groupCreatePlainSock.mods as Array<{
    groupCreate?: { subject: string; participants: string[] }
}>).find((entry) => entry.groupCreate)?.groupCreate
check(
    'group create keeps a plain phone number out of the group name',
    plainCreate?.subject === 'Izuku-rebirth' &&
        plainCreate?.participants.includes('2348118489638@s.whatsapp.net'),
    JSON.stringify(plainCreate),
)

const { cleanGroupName } = await import('../features/text.js')
check(
    'group labels strip a trailing phone number',
    cleanGroupName('Izuku-rebirth 2348118489638') === 'Izuku-rebirth',
    cleanGroupName('Izuku-rebirth 2348118489638'),
)

const { handleParticipantUpdate } = await import('../features/group-guards.js')
const GUARD_GROUP = '120363000000000123@g.us'
const GUARD_BAN = '2348333333338@s.whatsapp.net'
db.ban(GUARD_BAN, true)
const guardSock = createSock()
await handleParticipantUpdate(
    guardSock.sock,
    {
        id: GUARD_GROUP,
        participants: [{ id: '187939950723214@lid', phoneNumber: GUARD_BAN }],
        action: 'add',
    },
    {
        id: GUARD_GROUP,
        subject: 'Izuku-rebirth 2348118489638',
        participants: [{ id: GUARD_BAN }],
    } as unknown as Parameters<typeof handleParticipantUpdate>[2],
)
check(
    'a re-added banned user is removed again',
    guardSock.groupActions.some(
        (action) => action.jid === GUARD_GROUP && action.action === 'remove' && action.participants.includes('187939950723214@lid'),
    ),
    JSON.stringify(guardSock.groupActions),
)
check(
    'a removed banned user gets no welcome',
    !textOf(guardSock.sent).includes('Welcome'),
    JSON.stringify(guardSock.sent),
)
db.ban(GUARD_BAN, false)

// Regression: bans are stored per JID form. Unban used to clear only the
// phone-number JID, so the LID stayed flagged and the add-event guard removed
// the user again one second after they were added back.
db.ban(WARN_PHONE, true)
db.ban(WARN_LID, true)
const unbanLidSock = createSock()
await processMessage(
    unbanLidSock.sock,
    {
        key: { remoteJid: GROUP, fromMe: false, id: 'UNBANLID1', participant: OWNER },
        message: {
            extendedTextMessage: {
                text: '.unban',
                contextInfo: { mentionedJid: [WARN_LID] },
            },
        },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'unban clears both the LID and the phone-number ban',
    !db.isBanned(WARN_LID) && !db.isBanned(WARN_PHONE),
    JSON.stringify({ lid: db.isBanned(WARN_LID), phone: db.isBanned(WARN_PHONE) }),
)
check(
    'unban asks WhatsApp to add the user back',
    unbanLidSock.groupActions.some((action) => action.action === 'add'),
    JSON.stringify(unbanLidSock.groupActions),
)

// Regression: a ban row left behind under the LID used to keep someone banned
// even after their number was cleared, so every re-add was followed by another
// kick. Once the phone number is known it is authoritative.
db.ban(WARN_LID, true)
db.ban(WARN_PHONE, false)
const staleBanSock = createSock()
await handleParticipantUpdate(
    staleBanSock.sock,
    {
        id: GUARD_GROUP,
        participants: [{ id: WARN_LID, phoneNumber: WARN_PHONE }],
        action: 'add',
    },
    {
        id: GUARD_GROUP,
        subject: 'Izuku-rebirth',
        participants: [{ id: WARN_LID, phoneNumber: WARN_PHONE }],
    } as unknown as Parameters<typeof handleParticipantUpdate>[2],
)
check(
    'a stale LID ban does not kick an unbanned phone number',
    !staleBanSock.groupActions.some((action) => action.action === 'remove'),
    JSON.stringify(staleBanSock.groupActions),
)
check(
    'the unbanned user still gets the welcome',
    textOf(staleBanSock.sent).includes('Welcome'),
    JSON.stringify(staleBanSock.sent),
)
db.ban(WARN_LID, false)

db.ban(OWNER, true)
const ownerGuardSock = createSock()
await handleParticipantUpdate(
    ownerGuardSock.sock,
    { id: GUARD_GROUP, participants: [{ id: OWNER }], action: 'add' },
    {
        id: GUARD_GROUP,
        subject: 'Izuku-rebirth',
        participants: [{ id: OWNER, admin: 'admin' }],
    } as unknown as Parameters<typeof handleParticipantUpdate>[2],
)
check(
    'an owner is never removed by a stale ban',
    !ownerGuardSock.groupActions.some((action) => action.action === 'remove'),
    JSON.stringify(ownerGuardSock.groupActions),
)
check('the stale owner ban is cleared', !db.isBanned(OWNER), JSON.stringify({ banned: db.isBanned(OWNER) }))
db.ban(OWNER, false)

const welcomeGuardSock = createSock()
await handleParticipantUpdate(
    welcomeGuardSock.sock,
    { id: GUARD_GROUP, participants: [{ id: MEMBER }], action: 'add' },
    {
        id: GUARD_GROUP,
        subject: 'Izuku-rebirth 2348118489638',
        participants: [{ id: MEMBER }],
    } as unknown as Parameters<typeof handleParticipantUpdate>[2],
)
check(
    'welcome uses a group name without the phone number',
    textOf(welcomeGuardSock.sent).includes('Welcome to *Izuku-rebirth*.') &&
        !textOf(welcomeGuardSock.sent).includes('2348118489638'),
    textOf(welcomeGuardSock.sent),
)

const setgcppDm = await run('.setgcpp', OWNER, DM)
check('setgcpp is group-only', textOf(setgcppDm).includes('only works in groups'), textOf(setgcppDm))
const setgcppHint = await run('.setgcpp', OWNER, GROUP)
check('setgcpp asks for a quoted image', textOf(setgcppHint).includes('Reply to an image'), textOf(setgcppHint))

const ADEL_USER = '2348888888908@s.whatsapp.net'
const adelRevoke = (eventId: string, deletedId: string) =>
    ({
        key: { remoteJid: ADEL_USER, fromMe: false, id: eventId, participant: ADEL_USER },
        message: {
            protocolMessage: {
                type: 0,
                key: { remoteJid: ADEL_USER, fromMe: false, id: deletedId, participant: ADEL_USER },
            },
        },
    }) as unknown as Parameters<typeof processMessage>[1]
const adelMessage = (id: string) =>
    ({
        key: { remoteJid: ADEL_USER, fromMe: false, id, participant: ADEL_USER },
        message: { conversation: 'secret text' },
        pushName: 'Deleted User',
    }) as unknown as Parameters<typeof processMessage>[1]

const adelDefault = await run('.antidelete', OWNER, DM)
check('antidelete reports it is off by default', textOf(adelDefault).includes('Anti-delete is off'), textOf(adelDefault))

const adelSame = await run('.antidelete same', OWNER, DM)
check('antidelete can resend in the same chat', textOf(adelSame).includes('same chat'), textOf(adelSame))

const adelSock = createSock()
await processMessage(adelSock.sock, adelMessage('ADEL1'))
await processMessage(adelSock.sock, adelRevoke('ADELREVOKE1', 'ADEL1'))
check('antidelete resends a deleted message', adelSock.sent.length === 1, JSON.stringify(adelSock.sent))
check('antidelete resends to the same chat', adelSock.sent[0]?.jid === ADEL_USER, JSON.stringify(adelSock.sent))
check('antidelete keeps the original text', JSON.stringify(adelSock.sent).includes('secret text'), JSON.stringify(adelSock.sent))
check('antidelete names the sender', JSON.stringify(adelSock.sent).includes('Deleted User'), JSON.stringify(adelSock.sent))

const adelMediaSock = createSock()
const ADEL_MEDIA_BYTES = Uint8Array.from([9, 8, 7, 6])
const { markBotDelete, setAntideleteMediaDownloader } = await import('../features/antidelete.js')
setAntideleteMediaDownloader((async () =>
    (async function* () {
        yield ADEL_MEDIA_BYTES
    })()) as never)
await processMessage(
    adelMediaSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELMEDIA1', participant: ADEL_USER },
        message: {
            imageMessage: {
                mimetype: 'image/jpeg',
                fileSha256: ADEL_MEDIA_BYTES,
                caption: 'deleted photo',
            },
        },
        pushName: 'Deleted User',
    } as unknown as Parameters<typeof processMessage>[1],
)
await processMessage(adelMediaSock.sock, adelRevoke('ADELMEDIAREVOKE1', 'ADELMEDIA1'))
const restoredMedia = adelMediaSock.sent.find((entry) => Buffer.isBuffer(entry.content.image))
const restoredImage = restoredMedia?.content.image
check(
    'antidelete preserves media bytes when restoring a photo',
    Buffer.isBuffer(restoredImage) &&
        restoredImage.equals(Buffer.from(ADEL_MEDIA_BYTES)) &&
        restoredMedia?.content.caption === 'deleted photo',
    JSON.stringify({ sent: adelMediaSock.sent.length, caption: restoredMedia?.content.caption }),
)

const adelSelfSock = createSock()
await processMessage(
    adelSelfSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: true, id: 'ADELSELF1' },
        message: { conversation: 'my own deleted text' },
        pushName: 'Owner',
    } as unknown as Parameters<typeof processMessage>[1],
)
await processMessage(
    adelSelfSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: true, id: 'ADELSELFREVOKE1' },
        message: {
            protocolMessage: {
                type: 0,
                key: { remoteJid: ADEL_USER, fromMe: true, id: 'ADELSELF1' },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'antidelete also restores deleted fromMe messages',
    adelSelfSock.sent.length === 1 && JSON.stringify(adelSelfSock.sent).includes('my own deleted text'),
    JSON.stringify(adelSelfSock.sent),
)

const adelWrappedSock = createSock()
await processMessage(adelWrappedSock.sock, adelMessage('ADELWRAP1'))
await processMessage(
    adelWrappedSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELWRAPREVOKE1', participant: ADEL_USER },
        message: {
            ephemeralMessage: {
                message: {
                    protocolMessage: {
                        type: 0,
                        key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELWRAP1', participant: ADEL_USER },
                    },
                },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'antidelete unwraps revoke messages',
    adelWrappedSock.sent.length === 1 && JSON.stringify(adelWrappedSock.sent).includes('secret text'),
    JSON.stringify(adelWrappedSock.sent),
)

const adelNoTypeSock = createSock()
await processMessage(adelNoTypeSock.sock, adelMessage('ADELNOTYPE1'))
await processMessage(
    adelNoTypeSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELNOTYPEREVOKE1', participant: ADEL_USER },
        message: {
            protocolMessage: {
                key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELNOTYPE1', participant: ADEL_USER },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'antidelete handles revokes without an explicit type',
    adelNoTypeSock.sent.length === 1 && JSON.stringify(adelNoTypeSock.sent).includes('secret text'),
    JSON.stringify(adelNoTypeSock.sent),
)

const adelBotSock = createSock()
await processMessage(adelBotSock.sock, adelMessage('ADELBOT1'))
markBotDelete('ADELBOT1')
await processMessage(adelBotSock.sock, adelRevoke('ADELBOTREVOKE1', 'ADELBOT1'))
check(
    'antidelete ignores moderation deletes made by the bot',
    adelBotSock.sent.length === 0,
    JSON.stringify(adelBotSock.sent),
)

await run('.antidelete off', OWNER, DM)
const adelOffSock = createSock()
await processMessage(adelOffSock.sock, adelMessage('ADEL2'))
await processMessage(adelOffSock.sock, adelRevoke('ADELREVOKE2', 'ADEL2'))
check('antidelete off ignores revokes', adelOffSock.sent.length === 0, JSON.stringify(adelOffSock.sent))

const adelSudoGone = await run('.antidelete sudo', OWNER, DM)
check(
    'antidelete sudo no longer forwards to other users',
    textOf(adelSudoGone).includes('same chat') && !textOf(adelSudoGone).includes('owner'),
    textOf(adelSudoGone),
)
const adelSudoSock = createSock()
await processMessage(adelSudoSock.sock, adelMessage('ADEL3'))
await processMessage(adelSudoSock.sock, adelRevoke('ADELREVOKE3', 'ADEL3'))
check(
    'legacy sudo mode resends in the same chat instead',
    adelSudoSock.sent[0]?.jid === ADEL_USER,
    JSON.stringify(adelSudoSock.sent),
)
await run('.antidelete off', OWNER, DM)

await run('.antidelete same', OWNER, DM)
const adelStatusDenied = await run('.antidelete status on', OWNER, DM)
check(
    'antidelete status forwarding is disabled for privacy',
    textOf(adelStatusDenied).includes('disabled for privacy'),
    textOf(adelStatusDenied),
)

const { rememberStatus } = await import('../features/status-store.js')
const STATUS_DELETED = 'ADELSTATUS1'
rememberStatus(
    {
        key: { remoteJid: 'status@broadcast', fromMe: false, id: STATUS_DELETED, participant: ADEL_USER },
        message: { conversation: 'deleted status text' },
        pushName: 'Deleted User',
    } as unknown as Parameters<typeof processMessage>[1],
    [ADEL_USER],
    'Deleted User',
)
const adelStatusSock = createSock()
await processMessage(
    adelStatusSock.sock,
    {
        key: { remoteJid: 'status@broadcast', fromMe: false, id: 'ADELSTATUSREVOKE1', participant: ADEL_USER },
        message: {
            protocolMessage: {
                type: 0,
                key: { remoteJid: 'status@broadcast', fromMe: false, id: STATUS_DELETED, participant: ADEL_USER },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'antidelete never forwards a deleted status',
    adelStatusSock.sent.length === 0,
    JSON.stringify(adelStatusSock.sent),
)

const adelStatusWrapperSock = createSock()
await processMessage(
    adelStatusWrapperSock.sock,
    {
        key: { remoteJid: ADEL_USER, fromMe: false, id: 'ADELSTATUSWRAPREVOKE1', participant: ADEL_USER },
        message: {
            protocolMessage: {
                type: 0,
                key: {
                    remoteJid: 'status@broadcast',
                    fromMe: false,
                    id: STATUS_DELETED,
                    participant: ADEL_USER,
                },
            },
        },
    } as unknown as Parameters<typeof processMessage>[1],
)
check(
    'antidelete ignores a status target wrapped in a normal chat',
    adelStatusWrapperSock.sent.length === 0 && adelStatusWrapperSock.sent.length === 0,
    JSON.stringify(adelStatusWrapperSock.sent),
)

const adelDuplicateSock = createSock()
await processMessage(adelDuplicateSock.sock, adelMessage('ADELDUP1'))
await processMessage(adelDuplicateSock.sock, adelRevoke('ADELDUPREVOKE1', 'ADELDUP1'))
await processMessage(adelDuplicateSock.sock, adelRevoke('ADELDUPREVOKE1', 'ADELDUP1'))
check(
    'antidelete ignores duplicate revoke events',
    adelDuplicateSock.sent.length === 1,
    JSON.stringify(adelDuplicateSock.sent),
)

await run('.antidelete off', OWNER, DM)

const { CARDS, isHighTierCard, pendingCard, rarityForTier } = await import('../features/tcg.js')
const {
    dueHighTierEvent,
    dueHourlyDrops,
    highTierMinutes,
    hourlyOffsetSeconds,
    runHourlyCardTick,
} = await import('../features/card-scheduler.js')
const { rememberContacts } = await import('../features/contact-names.js')
const CONTACT_USER = '2348888888909@s.whatsapp.net'
rememberContacts([
    { id: CONTACT_USER, name: 'Address Book', notify: 'Contact Push' },
    { id: '120363000000000555@g.us', notify: 'Should Be Skipped' },
])
check('contact pushnames are cached for later lookups', db.user(CONTACT_USER).name === 'Contact Push', db.user(CONTACT_USER).name)

const setVar = await run('.setvar WARN_COUNT=5', OWNER, DM)
check('setvar stores a setting', textOf(setVar).includes('WARN_COUNT=5'), textOf(setVar))
const getVar = await run('.vars WARN_COUNT', OWNER, DM)
check('vars reads the stored setting', textOf(getVar).includes('WARN_COUNT=5'), textOf(getVar))

// ── group extras ─────────────────────────────────────────────────────────────
// The cooldown behaviour is covered earlier; the new commands are exercised
// back to back below, so switch it off for the rest of the run.
config.cooldownMs = 0

const admins = await run('.admins', MEMBER, GROUP)
check('admins lists the group admins', textOf(admins).includes('(2)'), textOf(admins))
check('admins mentions the admins', JSON.stringify(admins).includes('152317391294519@lid'), JSON.stringify(admins))

const tagAdmin = await run('.tagadmin meeting soon', MEMBER, GROUP)
check('tagadmin asks for admin rights', textOf(tagAdmin).includes('Admins only'), textOf(tagAdmin))
const tagAdminOwner = await run('.tagadmin meeting soon', OWNER, GROUP)
check('tagadmin mentions admins with the message', textOf(tagAdminOwner).includes('meeting soon'), textOf(tagAdminOwner))
const tagAdminDm = await run('.tagadmin hi', OWNER, DM)
check('tagadmin is group only', textOf(tagAdminDm).includes('only works in groups'), textOf(tagAdminDm))

const resetLink = await run('.resetlink', OWNER, GROUP)
check('resetlink revokes and prints a new link', textOf(resetLink).includes('chat.whatsapp.com/revoked-code'), textOf(resetLink))

// ── text extras ──────────────────────────────────────────────────────────────
check('reverse reverses text', textOf(await run('.reverse hello', MEMBER, DM)).includes('olleh'))
check('reverse asks for input', textOf(await run('.reverse', MEMBER, DM)).includes('Usage'))
check('spoiler wraps text', textOf(await run('.spoiler secret', MEMBER, DM)).includes('||secret||'))

// ── antibadword ──────────────────────────────────────────────────────────────
const badwordStatus = await run('.antibadword', OWNER, GROUP)
check('antibadword reports its state', textOf(badwordStatus).includes('Anti-badword is off'), textOf(badwordStatus))

await run('.antibadword add baka', OWNER, GROUP)
check('antibadword add stores the word', config.badWords.includes('baka'), JSON.stringify(config.badWords))
const badwordList = await run('.antibadword list', OWNER, GROUP)
check('antibadword lists words', textOf(badwordList).includes('baka'), textOf(badwordList))

const badwordOff = await run('you baka', MEMBER, GROUP)
check('antibadword off leaves messages alone', !JSON.stringify(badwordOff).includes('delete'), JSON.stringify(badwordOff))

await run('.antibadword on', OWNER, GROUP)
const badwordBlocked = await run('you baka', MEMBER, GROUP)
check('antibadword deletes a blocked message', JSON.stringify(badwordBlocked).includes('delete'), JSON.stringify(badwordBlocked))
check('antibadword warns the sender', textOf(badwordBlocked).includes('not allowed'), textOf(badwordBlocked))

const adminBypass = await run('you baka', OWNER, GROUP)
check('antibadword lets admins through', !JSON.stringify(adminBypass).includes('delete'), JSON.stringify(adminBypass))

const badwordMemberDenied = await run('.antibadword add nope', MEMBER, GROUP)
check('antibadword word list is owner-only', textOf(badwordMemberDenied).includes('Only the owner'), textOf(badwordMemberDenied))

await run('.antibadword off', OWNER, GROUP)
await run('.antibadword del baka', OWNER, GROUP)
check('antibadword del removes the word', !config.badWords.includes('baka'), JSON.stringify(config.badWords))

// ── autosticker ──────────────────────────────────────────────────────────────
const autoStickerStatus = await run('.autosticker', OWNER, GROUP)
check('autosticker reports its state', textOf(autoStickerStatus).includes('off'), textOf(autoStickerStatus))
const autoStickerDenied = await run('.autosticker on', MEMBER, GROUP)
check('autosticker is admin-only', textOf(autoStickerDenied).includes('Admins only'), textOf(autoStickerDenied))
await run('.autosticker on', OWNER, GROUP)
check('autosticker stores the flag', db.group(GROUP).autosticker === 1, String(db.group(GROUP).autosticker))
await run('.autosticker off', OWNER, GROUP)
check('autosticker can be turned off', db.group(GROUP).autosticker === 0, String(db.group(GROUP).autosticker))

// ── xp / rank ────────────────────────────────────────────────────────────────
const XP_USER = '2348888888920@s.whatsapp.net'
const XP_CHAT = '120363000000000321@g.us'
for (let i = 0; i < 3; i += 1) await run(`hello ${i}`, XP_USER, XP_CHAT)
const rank = await run('.rank', XP_USER, XP_CHAT)
check('rank shows the level', textOf(rank).includes('Level : 2'), textOf(rank))
check('rank shows xp', textOf(rank).includes('XP    : 15'), textOf(rank))
check('rank shows the message count', textOf(rank).includes('Msgs  : 3'), textOf(rank))
check('rank shows the position', textOf(rank).includes('#1'), textOf(rank))

const top = await run('.top', XP_USER, XP_CHAT)
check('top lists the member', textOf(top).includes('level 2'), textOf(top))
check('top shows the medal', textOf(top).includes('🥇'), textOf(top))

// ── card game ────────────────────────────────────────────────────────────────
const CARD_USER = '2348888888921@s.whatsapp.net'
const noCards = await run('.cards', CARD_USER, GROUP)
check('cards starts empty', textOf(noCards).includes('no cards yet'), textOf(noCards))

const dailyCoins = await run('.daily', CARD_USER, GROUP)
check('daily grants currency', textOf(dailyCoins).includes('Daily reward claimed'), textOf(dailyCoins))
check('daily stores the currency', db.coins(CARD_USER) > 0, String(db.coins(CARD_USER)))
const dailyCoinsAgain = await run('.daily', CARD_USER, GROUP)
check('daily currency has a cooldown', textOf(dailyCoinsAgain).includes('already claimed'), textOf(dailyCoinsAgain))
const wallet = await run('.balance', CARD_USER, GROUP)
check('balance shows the currency', textOf(wallet).includes('Balance'), textOf(wallet))

const noDrop = await run('.claim', CARD_USER, GROUP)
check('claim without a drop fails cleanly', textOf(noDrop).includes('no card waiting'), textOf(noDrop))

const drop = await run('.spawn gon', OWNER, GROUP)
check('spawn announces a card', textOf(drop).includes('Card Appeared'), textOf(drop))
const claimed = await run('.claim', CARD_USER, GROUP)
check('claim takes the dropped card', textOf(claimed).includes('Card claimed'), textOf(claimed))
const claimsAgain = await run('.claim', CARD_USER, GROUP)
check('a claimed card cannot be claimed twice', textOf(claimsAgain).includes('no card waiting'), textOf(claimsAgain))

// A claimed card lands in the deck, so .cards and .inv must still see it.
const collection = await run('.cards', CARD_USER, GROUP)
check('cards lists the claimed card', textOf(collection).includes('1 cards · 1 copies'), textOf(collection))
const inventory = await run('.inv', CARD_USER, GROUP)
check('inv counts a deck card', textOf(inventory).includes('*1* cards'), textOf(inventory))
const atop = await run('.atop hunter x hunter', CARD_USER, GROUP)
check('animetop counts a deck card', textOf(atop).includes('Tester'), textOf(atop))
check('animetop has no unique count', !textOf(atop).includes('unique'), textOf(atop))

const dropDenied = await run('.spawn gon', MEMBER, GROUP)
check(
    'spawn is admin-only',
    textOf(dropDenied).includes('Admins only') || textOf(dropDenied).includes('Owner only'),
    textOf(dropDenied),
)

const spawnDm = await run('.spawn gon', OWNER, DM)
check('spawn only works in groups', textOf(spawnDm).includes('only run in groups'), textOf(spawnDm))
const spawnUnknown = await run('.spawn definitely-not-a-card', OWNER, GROUP)
check('spawn reports unknown cards', textOf(spawnUnknown).includes('No card matches'), textOf(spawnUnknown))

const tierSpawn = await run('.spawn t5', OWNER, GROUP)
check('owner spawn accepts a tier', textOf(tierSpawn).includes('Card Appeared'), textOf(tierSpawn))
const tierSpawnCard = pendingCard(GROUP)
check(
    'owner spawn t5 picks a high-tier card',
    Boolean(tierSpawnCard && isHighTierCard(tierSpawnCard)),
    JSON.stringify(tierSpawnCard),
)
const tierSpawnClaim = await run('.claim', CARD_USER, GROUP)
check('a tier spawn is claimable', textOf(tierSpawnClaim).includes('claimed'), textOf(tierSpawnClaim))

check('card catalog ids are unique', new Set(CARDS.map((card) => card.id)).size === CARDS.length)
check('shoob maps tiers to rarities', rarityForTier('1') === 'common' && rarityForTier('5') === 'epic' && rarityForTier('S') === 'legendary', `${rarityForTier('1')}/${rarityForTier('5')}/${rarityForTier('S')}`)

// ── hourly card scheduler ───────────────────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const SCHED_BOT = '2348999999999@s.whatsapp.net'
const SCHED_GROUP_A = '120363000000000001@g.us'
const SCHED_GROUP_B = '120363000000000002@g.us'
const schedulerGroup = (id: string, botAdmin: boolean): import('baileys').GroupMetadata => ({
    id,
    subject: id,
    owner: undefined,
    participants: [
        {
            id: '152317391294519@lid',
            phoneNumber: SCHED_BOT,
            admin: botAdmin ? 'admin' : null,
        },
    ],
})
// High-tier drops only go to groups whose .agb live window includes --ht.
db.setHighTierUntil(SCHED_GROUP_A, Number.MAX_SAFE_INTEGER)
const schedGroups = {
    [SCHED_GROUP_A]: schedulerGroup(SCHED_GROUP_A, true),
    [SCHED_GROUP_B]: schedulerGroup(SCHED_GROUP_B, false),
}
const slotHour = 500_000
const slotNow = slotHour * HOUR_MS + hourlyOffsetSeconds(SCHED_GROUP_A) * 1000 + 1000
const firstHourly = dueHourlyDrops(schedGroups, [SCHED_BOT], slotNow, () => undefined)
check(
    'hourly scheduler targets only bot-admin groups',
    firstHourly.length === 1 && firstHourly[0]?.jid === SCHED_GROUP_A,
    JSON.stringify(firstHourly),
)
const repeatedHourly = dueHourlyDrops(
    schedGroups,
    [SCHED_BOT],
    slotNow,
    (jid) => (jid === SCHED_GROUP_A ? slotHour : undefined),
)
check('hourly scheduler does not repeat a group in the same hour', repeatedHourly.length === 0, JSON.stringify(repeatedHourly))
check(
    'hourly slots are staggered per group',
    hourlyOffsetSeconds(SCHED_GROUP_A) !== hourlyOffsetSeconds(SCHED_GROUP_B),
    `${hourlyOffsetSeconds(SCHED_GROUP_A)}/${hourlyOffsetSeconds(SCHED_GROUP_B)}`,
)
const lidAdminGroup = {
    [SCHED_GROUP_A]: {
        id: SCHED_GROUP_A,
        subject: SCHED_GROUP_A,
        owner: undefined,
        participants: [{ id: '999999999999999@lid', admin: 'superadmin' }],
    },
} as unknown as Record<string, import('baileys').GroupMetadata>
check(
    'hourly scheduler recognizes a LID-form bot admin',
    dueHourlyDrops(lidAdminGroup, ['999999999999999@lid'], slotNow, () => undefined).length === 1,
)

const highDay = Math.floor(slotNow / DAY_MS)
const highMinutes = highTierMinutes(highDay)
const highGap = Math.abs((highMinutes[0] ?? 0) - (highMinutes[1] ?? 0))
check(
    'high-tier schedule has two distinct random times',
    highMinutes.length === 2 &&
        highMinutes[0] !== highMinutes[1] &&
        highMinutes.every((minute) => minute >= 0 && minute < 1440),
    JSON.stringify(highMinutes),
)
check(
    'high-tier times are kept several hours apart',
    Math.min(highGap, 1431 - highGap) >= 240,
    JSON.stringify({ highMinutes, highGap }),
)
const highNow = highDay * DAY_MS + (highMinutes[0] ?? 0) * 60_000 + 1000
const highEvent = dueHighTierEvent(highNow, [])
check('high-tier event is due at its slot', highEvent?.index === 0, JSON.stringify(highEvent))
check('high-tier event is not repeated after sending', dueHighTierEvent(highNow, [0]) === undefined)
check(
    'high-tier event is not due outside its window',
    dueHighTierEvent(highNow + 10 * 60_000, []) === undefined,
)

const schedulerSock = { user: { id: SCHED_BOT } } as unknown as FakeSock
const normalSends: { chat: string; highTier: boolean }[] = []
const normalLastHours = new Map<string, number>()
const normalDeps = {
    now: () => slotNow,
    fetchGroups: async () => schedGroups,
    sendDrop: async (_sock: FakeSock, chat: string, highTier: boolean) => {
        normalSends.push({ chat, highTier })
    },
    lastDropHour: (jid: string) => normalLastHours.get(jid),
    markDropHour: (jid: string, hour: number) => normalLastHours.set(jid, hour),
    highTierSent: () => [0, 1],
    markHighTierSent: () => undefined,
}
const firstTick = await runHourlyCardTick(schedulerSock, normalDeps)
const secondTick = await runHourlyCardTick(schedulerSock, normalDeps)
check(
    'hourly tick sends once per group and does not duplicate',
    firstTick.length === 1 && !firstTick[0]?.highTier && secondTick.length === 0,
    JSON.stringify({ firstTick, secondTick, normalSends }),
)

const highSends: { chat: string; highTier: boolean }[] = []
const highSent: number[] = []
const highDeps = {
    ...normalDeps,
    now: () => highNow,
    sendDrop: async (_sock: FakeSock, chat: string, highTier: boolean) => {
        highSends.push({ chat, highTier })
    },
    highTierSent: () => highSent,
    markHighTierSent: (_day: number, index: number) => highSent.push(index),
}
const highTick = await runHourlyCardTick(schedulerSock, highDeps)
const highTickAgain = await runHourlyCardTick(schedulerSock, highDeps)
check(
    'high-tier cards spawn once at their random time',
    highTick.some((drop) => drop.highTier) && highSent.length === 1,
    JSON.stringify({ highTick, highSent }),
)
check(
    'high-tier cards do not spawn twice for the same slot',
    !highTickAgain.some((drop) => drop.highTier),
    JSON.stringify(highTickAgain),
)

// ── tic-tac-toe (legacy port) ────────────────────────────────────────────────
const TTT_CHAT = '120363000000000654@g.us'
const TTT_CHAT_TWO = '120363000000000655@g.us'
const TTT_THIRD = '2348777777777@s.whatsapp.net'

check('ttt needs an opponent', textOf(await run('.ttt', OWNER, TTT_CHAT, {}, 'Excel')).includes('Usage'))

// A pushname is only known once that person has spoken in the chat.
await run('.id', MEMBER, TTT_CHAT, {}, 'svn')

const tttStart = await run('.ttt 2348111111111', OWNER, TTT_CHAT, {}, 'Excel')
const tttStartText = textOf(tttStart)
check('ttt starts a game', tttStartText.includes('vs') && tttStartText.includes('starts'), tttStartText)
check(
    'ttt shows push names instead of numbers',
    tttStartText.includes('Excel') && tttStartText.includes('svn'),
    tttStartText,
)
check('ttt does not bold a raw vs number', !tttStartText.includes('*2348111111111*'), tttStartText)
const tttImage = imageOf(tttStart)
check('ttt sends a board image', Boolean(tttImage && tttImage.length > 500), String(tttImage?.length ?? 0))
check('ttt board image is a png', tttImage?.subarray(0, 4).toString('hex') === '89504e47', tttImage?.subarray(0, 4).toString('hex') ?? '')
const tttMentions = (tttStart.find((entry) => Buffer.isBuffer(entry.content.image))?.content.mentions ?? []) as string[]
check(
    'ttt tags both players so WhatsApp renders their names',
    tttMentions.includes(OWNER) && tttMentions.includes(MEMBER),
    JSON.stringify(tttMentions),
)

const tttThird = await run('ttt 5', TTT_THIRD, TTT_CHAT, {}, 'Gatecrasher')
check('ttt keeps the match to two players', textOf(tttThird).includes('between two players'), textOf(tttThird))

const tttSecond = await run('.ttt 2348111111111', OWNER, TTT_CHAT_TWO, {}, 'Excel')
check(
    'ttt refuses a second game for a player already in one',
    textOf(tttSecond).includes('already have a game running'),
    textOf(tttSecond),
)

const tttMove = await run('ttt 1', OWNER, TTT_CHAT, {}, 'Excel')
check('ttt accepts a move without the prefix', textOf(tttMove).includes('Last move: X — Excel'), textOf(tttMove))
check('ttt names the next player', textOf(tttMove).includes('Next turn: *svn*'), textOf(tttMove))

const tttOutOfTurn = await run('ttt 2', OWNER, TTT_CHAT, {}, 'Excel')
check('ttt enforces turns', textOf(tttOutOfTurn).includes('Wait for your turn'), textOf(tttOutOfTurn))

const tttTaken = await run('ttt 1', MEMBER, TTT_CHAT, {}, 'svn')
check('ttt rejects a taken slot', textOf(tttTaken).includes('already taken'), textOf(tttTaken))

const tttBare = await run('2', MEMBER, TTT_CHAT, {}, 'svn')
check(
    'a bare digit is a move while a game is live',
    textOf(tttBare).includes('Last move: O — svn'),
    textOf(tttBare),
)

await run('ttt 4', OWNER, TTT_CHAT, {}, 'Excel')
await run('ttt 3', MEMBER, TTT_CHAT, {}, 'svn')
const tttWin = await run('ttt 7', OWNER, TTT_CHAT, {}, 'Excel')
check('ttt detects a winner', textOf(tttWin).includes('wins'), textOf(tttWin))
check('ttt names the winner', textOf(tttWin).includes('🏆 *Excel* wins!'), textOf(tttWin))

const tttStat = db.gameStat(OWNER)
check('ttt records the win for the player', (tttStat?.wins ?? 0) === 1, JSON.stringify(tttStat))
check(
    'ttt records the loss for the opponent',
    (db.gameStat(MEMBER)?.losses ?? 0) === 1,
    JSON.stringify(db.gameStat(MEMBER)),
)
check(
    'the win is broken down per game',
    db.gameBreakdown(OWNER).some((row) => row.game === 'tictactoe' && row.wins === 1),
    JSON.stringify(db.gameBreakdown(OWNER)),
)

const streak = await run('.streak', OWNER, DM, {}, 'Excel')
check('streak reports cross-game wins', textOf(streak).includes('Wins    : 1'), textOf(streak))
check('streak reports the win rate', textOf(streak).includes('Win rate: 100%'), textOf(streak))
check('streak breaks wins down per game', textOf(streak).includes('Tic-tac-toe'), textOf(streak))
const gameTop = await run('.gametop', MEMBER, DM, {}, 'svn')
check('gametop lists players', textOf(gameTop).includes('Game leaderboard') && textOf(gameTop).includes('Excel'), textOf(gameTop))

const profile = await run('.profile', OWNER, DM, {}, 'Excel')
const profileText = textOf(profile)
check('profile is a dedicated command', findCommand('profile')?.name === 'profile')
check(
    'profile shows the game record',
    profileText.includes('✅ *Wins*   : 1') && profileText.includes('🛑 *Losses* : 0'),
    profileText,
)
check('profile shows the global rank', profileText.includes('🏅 Global rank: #1'), profileText)
check('profile breaks the record down per game', profileText.includes('Tic-tac-toe — 1W/0L/0D'), profileText)
const profileImage = imageOf(profile)
check('profile sends an AMOLED dashboard image', profileImage?.subarray(0, 4).toString('hex') === '89504e47', profileImage?.subarray(0, 4).toString('hex') ?? '')

const { normalizeGameStats, statsKey } = await import('../features/game-stats.js')
check('game stats canonicalize a known LID to its phone number', statsKey(WARN_LID) === WARN_PHONE, statsKey(WARN_LID))
db.recordGame(WARN_LID, 'wordchain', 'win')
const movedLegacyStats = normalizeGameStats()
check(
    'legacy LID stats migrate onto the phone profile',
    movedLegacyStats > 0 && !db.gameStat(WARN_LID) && (db.gameStat(WARN_PHONE)?.wins ?? 0) === 1,
    JSON.stringify({ movedLegacyStats, lid: db.gameStat(WARN_LID), phone: db.gameStat(WARN_PHONE) }),
)

check('ttt game is cleared after a win', textOf(await run('.ttt', MEMBER, TTT_CHAT, {}, 'svn')).includes('Usage'))
check(
    'ttt end without a game is handled',
    textOf(await run('.ttt end', OWNER, TTT_CHAT, {}, 'Excel')).includes('no game running'),
)

await run('.ttt 2348111111111', OWNER, TTT_CHAT, {}, 'Excel')
check('ttt can be ended', textOf(await run('.ttt end', OWNER, TTT_CHAT, {}, 'Excel')).includes('Game ended'))

// ── restart replay ───────────────────────────────────────────────────────────
const replay = createSock()
const listeners = new Map<string, (arg: { messages: unknown[]; type: string }) => Promise<void>>()
;(replay.sock as unknown as { ev: { on: (name: string, fn: (arg: { messages: unknown[]; type: string }) => Promise<void>) => void } }).ev = {
    on: (name, fn) => listeners.set(name, fn),
}
attachMessageHandler(replay.sock)
const upsert = listeners.get('messages.upsert')
check('the message handler is registered', Boolean(upsert))
await upsert?.({ messages: [message('.id', MEMBER, DM)], type: 'append' })
check('history replay after a restart is ignored', replay.sent.length === 0, `sent ${replay.sent.length}`)
await upsert?.({ messages: [message('.id', MEMBER, DM)], type: 'notify' })
check('live messages are still processed', replay.sent.length > 0, `sent ${replay.sent.length}`)

// ── pushnames everywhere ─────────────────────────────────────────────────────
const kickReply = await run('.kick @2348111111111', OWNER, GROUP, {}, 'Excel')
const kickText = kickReply.find((entry) => String(entry.content.text ?? '').includes('Removed'))
const kickMentions = (kickText?.content.mentions ?? []) as string[]
const { sameUser } = await import('../bot/identity.js')
check(
    'mention replies carry the mention list',
    kickMentions.some((jid) => sameUser(jid, MEMBER)),
    JSON.stringify(kickMentions),
)
check('mention replies still use the @number form', String(kickText?.content.text ?? '').includes('@2348111111111'), String(kickText?.content.text ?? ''))

db.close()

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
}
console.log('\nall pipeline tests passed')

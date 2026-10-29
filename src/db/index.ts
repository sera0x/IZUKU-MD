import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../config.ts'
import { createLogger } from '../logger.js'

export interface UserRow {
    jid: string
    name: string
    banned: 0 | 1
    afk_reason: string | null
    afk_since: number | null
    theme: string
    tcg_daily: number
    coins: number
    daily_at: number
    daily_streak: number
    work_at: number
    /** Balance held in the vault: invisible to robbers. */
    vault: number
    rob_at: number
    poke_started?: number
    /** Epoch ms until which this user may not join or create another clan. */
    clan_cd?: number
}

export interface GroupRow {
    jid: string
    /** First time the bot heard anything from this group. */
    created_at: number
    welcome: 0 | 1
    goodbye: 0 | 1
    antilink: 0 | 1
    antifake: 0 | 1
    antibadword: 0 | 1
    autosticker: 0 | 1
    bot_enabled: 0 | 1
}

export interface ClanRow {
    id: number
    name: string
    tag: string
    owner_jid: string
    created_at: number
    bio?: string | null
}

export interface ClanMemberRow {
    user_jid: string
    clan_id: number
    role: string
    joined_at: number
}

export interface XpRow {
    user_jid: string
    chat_jid: string
    xp: number
    messages: number
    updated_at: number
}

export interface CardRow {
    user_jid: string
    card_id: string
    copies: number
    first_at: number
}

export interface FilterRow {
    id: number
    chat_jid: string
    trigger: string
    response: string
    created_by: string
}

export interface WarningRow {
    id: number
    user_jid: string
    group_jid: string
    reason: string
    warned_by: string
    created_at: number
}

export interface StickerTriggerRow {
    hash: string
    command: string
    created_by: string
    created_at: number
}

export type GameOutcome = 'win' | 'loss' | 'draw'

export interface GameStatRow {
    user_jid: string
    wins: number
    losses: number
    draws: number
    streak: number
    best_streak: number
    updated_at: number
}

export interface GameBreakdownRow {
    user_jid: string
    game: string
    wins: number
    losses: number
    draws: number
}

const log = createLogger(config.logLevel, { scope: 'db' })

mkdirSync(dirname(config.dbPath), { recursive: true })

const sqlite = new Database(config.dbPath)
/** Raw handle for transactional feature code (market, events). */
export const rawDb = sqlite
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS gbans (
        group_jid TEXT NOT NULL,
        user_jid TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        banned_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (group_jid, user_jid)
    );
    CREATE TABLE IF NOT EXISTS mods (
        user_jid TEXT PRIMARY KEY,
        added_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
        jid        TEXT PRIMARY KEY,
        name       TEXT NOT NULL DEFAULT '',
        banned     INTEGER NOT NULL DEFAULT 0,
        afk_reason TEXT,
        afk_since  INTEGER,
        theme      TEXT NOT NULL DEFAULT '',
        coins      INTEGER NOT NULL DEFAULT 0,
        daily_at   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
        jid          TEXT PRIMARY KEY,
        welcome      INTEGER NOT NULL DEFAULT 1,
        goodbye      INTEGER NOT NULL DEFAULT 1,
        antilink     INTEGER NOT NULL DEFAULT 1,
        antifake     INTEGER NOT NULL DEFAULT 0,
        antibadword  INTEGER NOT NULL DEFAULT 0,
        autosticker  INTEGER NOT NULL DEFAULT 0,
        bot_enabled  INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warnings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid   TEXT NOT NULL,
        group_jid  TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT '',
        warned_by  TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS warnings_user_group ON warnings (user_jid, group_jid);

    CREATE TABLE IF NOT EXISTS filters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_jid   TEXT NOT NULL,
        trigger    TEXT NOT NULL,
        response   TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE (chat_jid, trigger)
    );

    CREATE INDEX IF NOT EXISTS filters_chat ON filters (chat_jid);

    CREATE TABLE IF NOT EXISTS autoreact (
        chat_jid   TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        emoji      TEXT NOT NULL DEFAULT '✅',
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS autoreact_chat ON autoreact (chat_jid);

    CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_jid   TEXT NOT NULL,
        user_jid   TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS notes_chat ON notes (chat_jid);

    CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sticker_triggers (
        hash       TEXT PRIMARY KEY,
        command    TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xp (
        user_jid   TEXT NOT NULL,
        chat_jid   TEXT NOT NULL,
        xp         INTEGER NOT NULL DEFAULT 0,
        messages   INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_jid, chat_jid)
    );

    CREATE INDEX IF NOT EXISTS xp_chat ON xp (chat_jid, xp DESC);

    CREATE TABLE IF NOT EXISTS cards (
        user_jid TEXT NOT NULL,
        card_id  TEXT NOT NULL,
        copies   INTEGER NOT NULL DEFAULT 1,
        first_at INTEGER NOT NULL,
        PRIMARY KEY (user_jid, card_id)
    );

    CREATE INDEX IF NOT EXISTS cards_user ON cards (user_jid);

    CREATE TABLE IF NOT EXISTS deck_cards (
        user_jid TEXT NOT NULL,
        card_id  TEXT NOT NULL,
        copies   INTEGER NOT NULL DEFAULT 1,
        first_at INTEGER NOT NULL,
        PRIMARY KEY (user_jid, card_id)
    );

    CREATE INDEX IF NOT EXISTS deck_cards_user ON deck_cards (user_jid);

    CREATE TABLE IF NOT EXISTS game_chats (
        chat_jid     TEXT PRIMARY KEY,
        at           INTEGER NOT NULL,
        ht_until     INTEGER,
        expires_at   INTEGER
    );

    CREATE TABLE IF NOT EXISTS game_stats (
        user_jid    TEXT PRIMARY KEY,
        wins        INTEGER NOT NULL DEFAULT 0,
        losses      INTEGER NOT NULL DEFAULT 0,
        draws       INTEGER NOT NULL DEFAULT 0,
        streak      INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS game_stats_wins ON game_stats (wins DESC);

    CREATE TABLE IF NOT EXISTS user_items (
        user_jid TEXT NOT NULL,
        item     TEXT NOT NULL,
        qty      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_jid, item)
    );

    CREATE TABLE IF NOT EXISTS game_breakdown (
        user_jid TEXT NOT NULL,
        game     TEXT NOT NULL,
        wins     INTEGER NOT NULL DEFAULT 0,
        losses   INTEGER NOT NULL DEFAULT 0,
        draws    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_jid, game)
    );
`)

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pokedexcaught (
        user_jid  TEXT NOT NULL,
        poke_id   INTEGER NOT NULL,
        name      TEXT NOT NULL,
        rarity    TEXT NOT NULL,
        power     INTEGER NOT NULL,
        caught_at INTEGER NOT NULL,
        PRIMARY KEY (user_jid, poke_id)
    );
`)

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clans (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        tag        TEXT NOT NULL,
        owner_jid  TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clan_members (
        user_jid  TEXT PRIMARY KEY,
        clan_id   INTEGER NOT NULL,
        role      TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL
    );
`)

// Migration: clans.bio was added after launch. ALTER fails harmlessly when
// the column already exists.
try { sqlite.exec('ALTER TABLE clans ADD COLUMN bio TEXT') } catch {}

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reward_ledger (
        user_jid TEXT NOT NULL,
        day      INTEGER NOT NULL,
        total    INTEGER NOT NULL DEFAULT 0,
        wins     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_jid, day)
    );
`)

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS poke_moves (
        user_jid   TEXT NOT NULL,
        poke_id    INTEGER NOT NULL,
        move       TEXT NOT NULL,
        learned_at INTEGER NOT NULL,
        PRIMARY KEY (user_jid, poke_id, move)
    );


    CREATE TABLE IF NOT EXISTS haigusha (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        age        TEXT NOT NULL,
        story      TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );
`)

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS marriages (
        user_jid  TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        series    TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        about     TEXT NOT NULL DEFAULT '',
        mal_id    INTEGER NOT NULL DEFAULT 0,
        married_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suspended_commands (
        name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS poke_pc (
        user_jid TEXT NOT NULL,
        poke_id  INTEGER NOT NULL,
        slot     INTEGER NOT NULL,
        PRIMARY KEY (user_jid, poke_id)
    );

    CREATE TABLE IF NOT EXISTS poke_battles (
        chat_key   TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
`)

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS poke_chats (
        chat_jid TEXT PRIMARY KEY,
        at       INTEGER NOT NULL
    );
`)

// Casino switch per group: independent of cards and pokemon (.agb gamble / .agb gamble off).
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS casino_chats (
        chat_jid TEXT PRIMARY KEY,
        at       INTEGER NOT NULL
    );
`)

// cards_off = 1 means the group record is pokemon-only (.agb poke, no cards).
const gameChatColumns = sqlite.prepare('PRAGMA table_info(game_chats)').all() as Array<{ name: string }>
if (!gameChatColumns.some((c) => c.name === 'cards_off')) {
    sqlite.exec('ALTER TABLE game_chats ADD COLUMN cards_off INTEGER NOT NULL DEFAULT 0')
}

// Pokemon upgrade: quality (1-100 percent), storage location (roster or pc), daily quest log.
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS poke_quest (
        user_jid TEXT NOT NULL,
        day      INTEGER NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0,
        progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_jid, day)
    );
`)
{
    const cols = sqlite.prepare('PRAGMA table_info(pokedexcaught)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'quality')) sqlite.exec('ALTER TABLE pokedexcaught ADD COLUMN quality INTEGER NOT NULL DEFAULT 0')
    if (!cols.some((c) => c.name === 'location')) sqlite.exec("ALTER TABLE pokedexcaught ADD COLUMN location TEXT NOT NULL DEFAULT 'roster'")
}
const pokeColumns = sqlite.prepare('PRAGMA table_info(pokedexcaught)').all() as Array<{ name: string }>
if (!pokeColumns.some((column) => column.name === 'xp')) {
    sqlite.exec('ALTER TABLE pokedexcaught ADD COLUMN xp INTEGER NOT NULL DEFAULT 0')
}
if (!pokeColumns.some((column) => column.name === 'level')) {
    sqlite.exec('ALTER TABLE pokedexcaught ADD COLUMN level INTEGER NOT NULL DEFAULT 1')
}

const userColumns = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
if (!userColumns.some((column) => column.name === 'theme')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT ''")
}
if (!userColumns.some((column) => column.name === 'tcg_daily')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN tcg_daily INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'coins')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'daily_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN daily_at INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'daily_streak')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'work_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN work_at INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'vault')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN vault INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'rob_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN rob_at INTEGER NOT NULL DEFAULT 0')
}
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clan_treasury (
        clan_id  INTEGER PRIMARY KEY,
        balance  INTEGER NOT NULL DEFAULT 0,
        tax_pct  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_scores (
        user_jid  TEXT PRIMARY KEY,
        name      TEXT NOT NULL DEFAULT '',
        wins      INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS clan_profit (
        clan_id  INTEGER PRIMARY KEY,
        total    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS clan_war_points (
        week_key TEXT NOT NULL,
        clan_id  INTEGER NOT NULL,
        points   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (week_key, clan_id)
    );
`)

if (!userColumns.some((column) => column.name === 'poke_started')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN poke_started INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'clan_cd')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN clan_cd INTEGER NOT NULL DEFAULT 0')
}

const groupColumns = sqlite.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>
if (!groupColumns.some((column) => column.name === 'antibadword')) {
    sqlite.exec('ALTER TABLE groups ADD COLUMN antibadword INTEGER NOT NULL DEFAULT 0')
}
if (!groupColumns.some((column) => column.name === 'autosticker')) {
    sqlite.exec('ALTER TABLE groups ADD COLUMN autosticker INTEGER NOT NULL DEFAULT 0')
}

sqlite.exec("UPDATE autoreact SET emoji = '✅' WHERE emoji = char(10084) || char(65039)")

const now = () => Date.now()

const statements = {
    insertUser: sqlite.prepare('INSERT OR IGNORE INTO users (jid, created_at) VALUES (?, ?)'),
    touchUser: sqlite.prepare('UPDATE users SET name = ? WHERE jid = ?'),
    selectUser: sqlite.prepare('SELECT * FROM users WHERE jid = ?'),
    banUser: sqlite.prepare('UPDATE users SET banned = ? WHERE jid = ?'),
    setAfk: sqlite.prepare('UPDATE users SET afk_reason = ?, afk_since = ? WHERE jid = ?'),
    clearAfk: sqlite.prepare('UPDATE users SET afk_reason = NULL, afk_since = NULL WHERE jid = ?'),
    setTheme: sqlite.prepare('UPDATE users SET theme = ? WHERE jid = ?'),
    setTcgDaily: sqlite.prepare('UPDATE users SET tcg_daily = ? WHERE jid = ?'),
    addCoins: sqlite.prepare('UPDATE users SET coins = coins + ? WHERE jid = ?'),
    setDailyAt: sqlite.prepare('UPDATE users SET daily_at = ? WHERE jid = ?'),
    setDailyState: sqlite.prepare('UPDATE users SET daily_at = ?, daily_streak = ? WHERE jid = ?'),
    setWorkAt: sqlite.prepare('UPDATE users SET work_at = ? WHERE jid = ?'),
    spendCoins: sqlite.prepare('UPDATE users SET coins = coins - ? WHERE jid = ? AND coins >= ?'),
    deposit: sqlite.prepare('UPDATE users SET coins = coins - ?, vault = vault + ? WHERE jid = ? AND coins >= ?'),
    withdraw: sqlite.prepare('UPDATE users SET vault = vault - ?, coins = coins + ? WHERE jid = ? AND vault >= ?'),
    setRobAt: sqlite.prepare('UPDATE users SET rob_at = ? WHERE jid = ?'),
    selectItem: sqlite.prepare('SELECT qty FROM user_items WHERE user_jid = ? AND item = ?'),
    upsertItem: sqlite.prepare(
        'INSERT INTO user_items (user_jid, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_jid, item) DO UPDATE SET qty = qty + excluded.qty',
    ),
    decItem: sqlite.prepare('UPDATE user_items SET qty = qty - ? WHERE user_jid = ? AND item = ? AND qty >= ?'),
    listItems: sqlite.prepare('SELECT item, qty FROM user_items WHERE user_jid = ? AND qty > 0 ORDER BY item'),

    insertGroup: sqlite.prepare('INSERT OR IGNORE INTO groups (jid, created_at) VALUES (?, ?)'),
    selectGroup: sqlite.prepare('SELECT * FROM groups WHERE jid = ?'),
    setGroupFlag: sqlite.prepare(
        'UPDATE groups SET welcome = COALESCE(?, welcome), goodbye = COALESCE(?, goodbye), antilink = COALESCE(?, antilink), antifake = COALESCE(?, antifake), antibadword = COALESCE(?, antibadword), autosticker = COALESCE(?, autosticker), bot_enabled = COALESCE(?, bot_enabled) WHERE jid = ?',
    ),

    upsertFilter: sqlite.prepare('INSERT INTO filters (chat_jid, trigger, response, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (chat_jid, trigger) DO UPDATE SET response = excluded.response, created_by = excluded.created_by'),
    listFilters: sqlite.prepare('SELECT * FROM filters WHERE chat_jid = ? ORDER BY trigger ASC'),
    deleteFilter: sqlite.prepare('DELETE FROM filters WHERE chat_jid = ? AND trigger = ?'),
    clearFilters: sqlite.prepare('DELETE FROM filters WHERE chat_jid = ?'),

    addWarning: sqlite.prepare('INSERT INTO warnings (user_jid, group_jid, reason, warned_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    listWarnings: sqlite.prepare('SELECT * FROM warnings WHERE user_jid = ? AND group_jid = ? ORDER BY id DESC'),
    listGroupWarnings: sqlite.prepare('SELECT * FROM warnings WHERE group_jid = ? ORDER BY id DESC'),
    countWarnings: sqlite.prepare('SELECT COUNT(*) AS total FROM warnings WHERE user_jid = ? AND group_jid = ?'),
    clearWarnings: sqlite.prepare('DELETE FROM warnings WHERE user_jid = ? AND group_jid = ?'),

    upsertAutoreact: sqlite.prepare('INSERT INTO autoreact (chat_jid, enabled, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_jid) DO UPDATE SET enabled = excluded.enabled, emoji = excluded.emoji'),
    getAutoreact: sqlite.prepare('SELECT * FROM autoreact WHERE chat_jid = ?'),

    addNote: sqlite.prepare('INSERT INTO notes (chat_jid, user_jid, body, created_at) VALUES (?, ?, ?, ?)'),
    listNotes: sqlite.prepare('SELECT * FROM notes WHERE chat_jid = ? ORDER BY id ASC'),
    deleteNote: sqlite.prepare('DELETE FROM notes WHERE id = ? AND chat_jid = ?'),
    clearNotes: sqlite.prepare('DELETE FROM notes WHERE chat_jid = ?'),

    setSetting: sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
    listSettings: sqlite.prepare('SELECT * FROM settings ORDER BY key ASC'),
    deleteSetting: sqlite.prepare('DELETE FROM settings WHERE key = ?'),

    upsertStickerTrigger: sqlite.prepare('INSERT INTO sticker_triggers (hash, command, created_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (hash) DO UPDATE SET command = excluded.command, created_by = excluded.created_by'),
    getStickerTrigger: sqlite.prepare('SELECT * FROM sticker_triggers WHERE hash = ?'),
    listStickerTriggers: sqlite.prepare('SELECT * FROM sticker_triggers ORDER BY created_at DESC'),
    deleteStickerTrigger: sqlite.prepare('DELETE FROM sticker_triggers WHERE hash = ?'),

    addXp: sqlite.prepare(
        'INSERT INTO xp (user_jid, chat_jid, xp, messages, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (user_jid, chat_jid) DO UPDATE SET xp = xp + excluded.xp, messages = messages + 1, updated_at = excluded.updated_at',
    ),
    getXp: sqlite.prepare('SELECT * FROM xp WHERE user_jid = ? AND chat_jid = ?'),
    countAbove: sqlite.prepare('SELECT COUNT(*) AS total FROM xp WHERE chat_jid = ? AND xp > ?'),
    topXp: sqlite.prepare('SELECT * FROM xp WHERE chat_jid = ? ORDER BY xp DESC LIMIT ?'),

    addCard: sqlite.prepare(
        'INSERT INTO cards (user_jid, card_id, copies, first_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_jid, card_id) DO UPDATE SET copies = copies + 1',
    ),
    sumCardCopies: sqlite.prepare('SELECT SUM(copies) AS n FROM cards WHERE card_id = ?'),
    insDeckCard: sqlite.prepare(
        'INSERT INTO deck_cards (user_jid, card_id, copies, first_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_jid, card_id) DO UPDATE SET copies = copies + 1',
    ),
    deckRows: sqlite.prepare('SELECT * FROM deck_cards WHERE user_jid = ? ORDER BY first_at ASC'),
    deckRow: sqlite.prepare('SELECT * FROM deck_cards WHERE user_jid = ? AND card_id = ?'),
    delDeckRow: sqlite.prepare('DELETE FROM deck_cards WHERE user_jid = ? AND card_id = ?'),
    gameChatGet: sqlite.prepare('SELECT chat_jid, ht_until, expires_at FROM game_chats WHERE chat_jid = ?'),
    gameChatSet: sqlite.prepare('INSERT INTO game_chats (chat_jid, at, ht_until, expires_at) VALUES (?, ?, NULL, NULL) ON CONFLICT (chat_jid) DO UPDATE SET at = excluded.at, ht_until = excluded.ht_until, expires_at = excluded.expires_at'),
    gameChatSetHt: sqlite.prepare('INSERT INTO game_chats (chat_jid, at, ht_until, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_jid) DO UPDATE SET at = excluded.at, ht_until = excluded.ht_until, expires_at = excluded.expires_at'),
    gameChatDel: sqlite.prepare('DELETE FROM game_chats WHERE chat_jid = ?'),
    listCards: sqlite.prepare('SELECT * FROM cards WHERE user_jid = ? ORDER BY first_at ASC'),
    // Collection and deck are both "owned": .atop and the collector boards count
    // a card wherever it sits, otherwise decking a card erased you from them.
    allCardRows: sqlite.prepare(
        'SELECT user_jid, card_id, SUM(copies) AS copies FROM (' +
            'SELECT user_jid, card_id, copies FROM cards UNION ALL ' +
            'SELECT user_jid, card_id, copies FROM deck_cards' +
            ') GROUP BY user_jid, card_id',
    ),
    getCard: sqlite.prepare('SELECT * FROM cards WHERE user_jid = ? AND card_id = ?'),
    topCollectors: sqlite.prepare(
        // Collection plus deck: staging a card must not drop you down this board.
        'SELECT user_jid, SUM(copies) AS total, COUNT(DISTINCT card_id) AS unique_cards FROM (' +
            'SELECT user_jid, card_id, copies FROM cards UNION ALL ' +
            'SELECT user_jid, card_id, copies FROM deck_cards' +
            ') GROUP BY user_jid ORDER BY total DESC, unique_cards DESC LIMIT ?',
    ),
    topCoins: sqlite.prepare('SELECT jid, name, coins FROM users ORDER BY coins DESC LIMIT ?'),
    topXpAll: sqlite.prepare('SELECT user_jid, SUM(xp) AS xp FROM xp GROUP BY user_jid ORDER BY xp DESC LIMIT ?'),
    clanByName: sqlite.prepare('SELECT * FROM clans WHERE name = ? COLLATE NOCASE'),
    clanById: sqlite.prepare('SELECT * FROM clans WHERE id = ?'),
    clanInsert: sqlite.prepare('INSERT INTO clans (name, tag, owner_jid, created_at) VALUES (?, ?, ?, ?)'),
    clanDelete: sqlite.prepare('DELETE FROM clans WHERE id = ?'),
    clanList: sqlite.prepare('SELECT c.*, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members FROM clans c ORDER BY members DESC, c.created_at ASC'),
    clanMemberCount: sqlite.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ?'),
    clanMember: sqlite.prepare('SELECT * FROM clan_members WHERE user_jid = ?'),
    clanMembers: sqlite.prepare('SELECT * FROM clan_members WHERE clan_id = ? ORDER BY CASE role WHEN \'leader\' THEN 0 WHEN \'officer\' THEN 1 ELSE 2 END, joined_at ASC'),
    clanAdd: sqlite.prepare('INSERT INTO clan_members (user_jid, clan_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_jid) DO UPDATE SET clan_id = excluded.clan_id, role = excluded.role, joined_at = excluded.joined_at'),
    clanRemove: sqlite.prepare('DELETE FROM clan_members WHERE user_jid = ?'),
    clanSetRole: sqlite.prepare('UPDATE clan_members SET role = ? WHERE user_jid = ?'),
    rewardLedgerGet: sqlite.prepare('SELECT total FROM reward_ledger WHERE user_jid = ? AND day = ?'),
    rewardLedgerAdd: sqlite.prepare('INSERT INTO reward_ledger (user_jid, day, total, wins) VALUES (?, ?, ?, 1) ON CONFLICT (user_jid, day) DO UPDATE SET total = total + excluded.total, wins = wins + 1'),

    selectGameStat: sqlite.prepare('SELECT * FROM game_stats WHERE user_jid = ?'),
    upsertGameStat: sqlite.prepare(
        'INSERT INTO game_stats (user_jid, wins, losses, draws, streak, best_streak, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_jid) DO UPDATE SET wins = excluded.wins, losses = excluded.losses, draws = excluded.draws, streak = excluded.streak, best_streak = excluded.best_streak, updated_at = excluded.updated_at',
    ),
    listGameStats: sqlite.prepare('SELECT * FROM game_stats ORDER BY wins DESC, best_streak DESC LIMIT ?'),
    allGameStats: sqlite.prepare('SELECT * FROM game_stats'),
    countGameWinsAbove: sqlite.prepare('SELECT COUNT(*) AS total FROM game_stats WHERE wins > ?'),
    deleteGameStat: sqlite.prepare('DELETE FROM game_stats WHERE user_jid = ?'),
    selectBreakdown: sqlite.prepare('SELECT * FROM game_breakdown WHERE user_jid = ? ORDER BY wins DESC'),
    upsertBreakdown: sqlite.prepare(
        'INSERT INTO game_breakdown (user_jid, game, wins, losses, draws) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_jid, game) DO UPDATE SET wins = excluded.wins, losses = excluded.losses, draws = excluded.draws',
    ),
    deleteBreakdown: sqlite.prepare('DELETE FROM game_breakdown WHERE user_jid = ? AND game = ?'),
    allBreakdown: sqlite.prepare('SELECT * FROM game_breakdown'),


    // Haigusha characters
    haiguShas: sqlite.prepare('SELECT * FROM haigusha ORDER BY random() LIMIT 1'),
    listHaiguShas: sqlite.prepare('SELECT * FROM haigusha'),
    addHaiguSha: sqlite.prepare(
        'INSERT INTO haigusha (name, age, story, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET age = excluded.age, story = excluded.story, created_at = excluded.created_at'
    ),
    getHaiguSha: sqlite.prepare('SELECT * FROM haigusha WHERE name = ?'),

    haiguSha(userJid: string): HaiguShaRow | undefined {
        return statements.getHaiguSha.get(userJid) as HaiguShaRow | undefined
    },
    haiguShaRandom(): HaiguShaRow | undefined {
        const rows = statements.haiguShas.all() as HaiguShaRow[] | undefined
        return rows?.[0]
    }
}

export interface HaiguShaRow {
    id: number
    name: string
    age: string
    story: string
    created_at: number
}






export interface NoteRow {
    id: number
    chat_jid: string
    user_jid: string
    body: string
    created_at: number
}

export interface SettingRow {
    key: string
    value: string
    updated_at: number
}

export interface PokeCaughtRow {
    user_jid: string
    poke_id: number
    name: string
    rarity: string
    power: number
    caught_at: number
    xp?: number
    level?: number
    quality?: number
    location?: string
}

export interface MarriageRow {
    user_jid: string
    name: string
    series: string
    image_url: string
    about: string
    mal_id: number
    married_at: number
}

export interface BattleStoreRow {
    chat_key: string
    data: string
}

const marriageStatements = {
    set: sqlite.prepare(
        'INSERT INTO marriages (user_jid, name, series, image_url, about, mal_id, married_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_jid) DO UPDATE SET name = excluded.name, series = excluded.series, image_url = excluded.image_url, about = excluded.about, mal_id = excluded.mal_id, married_at = excluded.married_at',
    ),
    get: sqlite.prepare('SELECT * FROM marriages WHERE user_jid = ?'),
    del: sqlite.prepare('DELETE FROM marriages WHERE user_jid = ?'),
}

const battleStatements = {
    set: sqlite.prepare('INSERT INTO poke_battles (chat_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (chat_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
    all: sqlite.prepare('SELECT chat_key, data FROM poke_battles'),
    del: sqlite.prepare('DELETE FROM poke_battles WHERE chat_key = ?'),
}

export const db = {
    setMarriage(userJid: string, character: { name: string; series: string; imageUrl: string; about: string; anilistId?: number }): void {
        marriageStatements.set.run(userJid, character.name, character.series, character.imageUrl, character.about, character.anilistId ?? 0, Date.now())
    },

    marriageOf(userJid: string): MarriageRow | undefined {
        return marriageStatements.get.get(userJid) as MarriageRow | undefined
    },

    clearMarriage(userJid: string): void {
        marriageStatements.del.run(userJid)
    },

    saveBattle(chatKey: string, data: unknown): void {
        battleStatements.set.run(chatKey, JSON.stringify(data), Date.now())
    },

    loadBattles(): BattleStoreRow[] {
        return battleStatements.all.all() as BattleStoreRow[]
    },

    delBattle(chatKey: string): void {
        battleStatements.del.run(chatKey)
    },

    pcSet(userJid: string, pokeId: number, slot: number): void {
        sqlite.prepare('INSERT INTO poke_pc (user_jid, poke_id, slot) VALUES (?, ?, ?) ON CONFLICT (user_jid, poke_id) DO UPDATE SET slot = excluded.slot').run(userJid, pokeId, slot)
    },

    pcOf(userJid: string): Array<{ poke_id: number; slot: number }> {
        return sqlite.prepare('SELECT poke_id, slot FROM poke_pc WHERE user_jid = ? ORDER BY slot ASC').all(userJid) as Array<{ poke_id: number; slot: number }>
    },

    pcClear(userJid: string): void {
        sqlite.prepare('DELETE FROM poke_pc WHERE user_jid = ?').run(userJid)
    },

    pcRemove(userJid: string, pokeId: number): void {
        sqlite.prepare('DELETE FROM poke_pc WHERE user_jid = ? AND poke_id = ?').run(userJid, pokeId)
    },

    suspendedSet(name: string): void {
        sqlite.prepare('INSERT OR IGNORE INTO suspended_commands (name) VALUES (?)').run(name)
    },

    suspendedClear(name: string): void {
        sqlite.prepare('DELETE FROM suspended_commands WHERE name = ?').run(name)
    },

    suspendedList(): string[] {
        return (sqlite.prepare('SELECT name FROM suspended_commands ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name)
    },

    isSuspended(name: string): boolean {
        return Boolean(sqlite.prepare('SELECT 1 FROM suspended_commands WHERE name = ?').get(name))
    },



    /** Pokemon switch per group: off by default, turned on with .agb poke (off/kill to revert). */
    pokeEnabled(chatJid: string): boolean {
        return Boolean(sqlite.prepare('SELECT 1 FROM poke_chats WHERE chat_jid = ?').get(chatJid))
    },

    setPokeEnabled(chatJid: string, on: boolean): void {
        if (!on) sqlite.prepare('DELETE FROM poke_chats WHERE chat_jid = ?').run(chatJid)
        else sqlite.prepare('INSERT INTO poke_chats (chat_jid, at) VALUES (?, ?) ON CONFLICT (chat_jid) DO UPDATE SET at = excluded.at').run(chatJid, Date.now())
    },

    /** Casino switch per group, independent of cards and pokemon. */
    casinoEnabled(chatJid: string): boolean {
        return Boolean(sqlite.prepare('SELECT 1 FROM casino_chats WHERE chat_jid = ?').get(chatJid))
    },

    setCasinoEnabled(chatJid: string, on: boolean): void {
        if (!on) sqlite.prepare('DELETE FROM casino_chats WHERE chat_jid = ?').run(chatJid)
        else sqlite.prepare('INSERT INTO casino_chats (chat_jid, at) VALUES (?, ?) ON CONFLICT (chat_jid) DO UPDATE SET at = excluded.at').run(chatJid, Date.now())
    },

    /**
     * Atomic casino settle: takes the stake and credits the payout in one transaction.
     * Returns false (and changes nothing) when the wallet cannot cover the stake.
     */
    settleBet(userJid: string, stake: number, payout: number): boolean {
        this.user(userJid)
        const tx = sqlite.transaction((): boolean => {
            const debit = statements.spendCoins.run(stake, userJid, stake)
            if (debit.changes === 0) return false
            if (payout > 0) statements.addCoins.run(payout, userJid)
            return true
        })
        return tx()
    },

    /** Group-level game switch: the anchor activates collection games per chat (.agb live|kill|poke). */
    gameActive(chatJid: string): boolean {
        const row = statements.gameChatGet.get(chatJid) as { expires_at?: number | null } | undefined
        if (!row) return false
        // Expired activation = automatic .agb kill: drop the row (and pokemon) so the group
        // is back to the plain bot without anyone typing anything.
        if (row.expires_at && row.expires_at < Date.now()) {
            statements.gameChatDel.run(chatJid)
            sqlite.prepare('DELETE FROM poke_chats WHERE chat_jid = ?').run(chatJid)
            return false
        }
        return true
    },

    /** Cards run only when the group record exists AND it is not pokemon-only. */
    cardsActive(chatJid: string): boolean {
        if (!db.gameActive(chatJid)) return false
        const row = sqlite.prepare('SELECT cards_off FROM game_chats WHERE chat_jid = ?').get(chatJid) as { cards_off: number } | undefined
        return Boolean(row) && !row?.cards_off
    },

    setGameActive(chatJid: string, on: boolean, days?: number): void {
        if (!on) {
            statements.gameChatDel.run(chatJid)
            return
        }
        const expires = days && days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : null
        if (expires) statements.gameChatSetHt.run(chatJid, Date.now(), null, expires)
        else statements.gameChatSet.run(chatJid, Date.now())
        // .agb live turns cards on for this group (keeps any pokemon flag as it is).
        sqlite.prepare('UPDATE game_chats SET cards_off = 0 WHERE chat_jid = ?').run(chatJid)
    },

    /**
     * .agb poke on: pokemon on without cards. Creates a pokemon-only record when the
     * group has none; an existing cards record keeps its cards.
     * .agb poke off: pokemon off; a pokemon-only record with nothing left is removed.
     */
    setPokemonToggle(chatJid: string, on: boolean): void {
        if (on) {
            sqlite.prepare('INSERT OR IGNORE INTO game_chats (chat_jid, at, ht_until, expires_at, cards_off) VALUES (?, ?, NULL, NULL, 1)').run(chatJid, Date.now())
            sqlite.prepare('INSERT INTO poke_chats (chat_jid, at) VALUES (?, ?) ON CONFLICT (chat_jid) DO UPDATE SET at = excluded.at').run(chatJid, Date.now())
            return
        }
        sqlite.prepare('DELETE FROM poke_chats WHERE chat_jid = ?').run(chatJid)
        const row = statements.gameChatGet.get(chatJid) as { ht_until?: number | null } | undefined
        const cardsOff = sqlite.prepare('SELECT cards_off FROM game_chats WHERE chat_jid = ?').get(chatJid) as { cards_off: number } | undefined
        if (row && cardsOff?.cards_off) statements.gameChatDel.run(chatJid)
    },

    /** High-tier window: group may pull t5-S until this epoch ms (null = off). */
    highTierUntil(chatJid: string): number | null {
        const row = statements.gameChatGet.get(chatJid) as { ht_until?: number | null } | undefined
        if (!row?.ht_until) return null
        if (row.ht_until < Date.now()) return null
        return row.ht_until
    },

    // Haigusha characters
    haiguShas: sqlite.prepare('SELECT * FROM haigusha ORDER BY random() LIMIT 1'),
    listHaiguShas: sqlite.prepare('SELECT * FROM haigusha'),
    addHaiguSha: sqlite.prepare(
        'INSERT INTO haigusha (name, age, story, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET age = excluded.age, story = excluded.story, created_at = excluded.created_at',
    ),
    getHaiguSha: sqlite.prepare('SELECT * FROM haigusha WHERE name = ?'),

    haiguSha(userJid: string): HaiguShaRow | undefined {
        return statements.getHaiguSha.get(userJid) as HaiguShaRow | undefined
    },
    haiguShaRandom(): HaiguShaRow | undefined {
        const rows = statements.haiguShas.all() as HaiguShaRow[] | undefined
        return rows?.[0]
    },

    setHighTierUntil(chatJid: string, until: number | null): void {
        if (until) statements.gameChatSetHt.run(chatJid, Date.now(), until, null)
        else statements.gameChatSet.run(chatJid, Date.now())
    },

    /** Claimed cards land in the deck first; m2coll moves them to the collection. */
    addDeckCard(userJid: string, cardId: string): { copies: number } {
        statements.insDeckCard.run(userJid, cardId, Date.now())
        const row = statements.deckRow.get(userJid, cardId) as { copies: number }
        return { copies: row?.copies ?? 1 }
    },

    deckRow(userJid: string, cardId: string): { copies: number } | undefined {
        return statements.deckRow.get(userJid, cardId) as { copies: number } | undefined
    },

    deckOf(userJid: string): Array<{ card_id: string; copies: number }> {
        return statements.deckRows.all(userJid) as Array<{ card_id: string; copies: number }>
    },

    /** Remove exactly one copy of a card from the collection (for staging into the deck). */
    takeCollectionCopy(userJid: string, cardId: string): boolean {
        const row = statements.getCard.get(userJid, cardId) as { copies: number } | undefined
        if (!row || row.copies < 1) return false
        if (row.copies === 1) sqlite.prepare('DELETE FROM cards WHERE user_jid = ? AND card_id = ?').run(userJid, cardId)
        else sqlite.prepare('UPDATE cards SET copies = copies - 1 WHERE user_jid = ? AND card_id = ?').run(userJid, cardId)
        return true
    },

    /** Move one deck card (or every deck card when cardId is null) into the collection. */
    moveToCollection(userJid: string, cardId?: string): { moved: number; cardId?: string } {
        if (cardId) {
            const row = statements.deckRow.get(userJid, cardId) as { copies: number } | undefined
            if (!row) return { moved: 0 }
            for (let i = 0; i < row.copies; i += 1) statements.addCard.run(userJid, cardId, Date.now())
            statements.delDeckRow.run(userJid, cardId)
            return { moved: row.copies, cardId }
        }
        const rows = statements.deckRows.all(userJid) as Array<{ card_id: string; copies: number }>
        let moved = 0
        for (const row of rows) {
            for (let i = 0; i < row.copies; i += 1) statements.addCard.run(userJid, row.card_id, Date.now())
            statements.delDeckRow.run(userJid, row.card_id)
            moved += row.copies
        }
        return { moved }
    },

    /** Total copies of a card across all users (spawn "Copy #" counter). */
    cardCount(cardId: string): number {
        const row = statements.sumCardCopies.get(cardId) as { n?: number } | undefined
        return row?.n ?? 0
    },
    user(jid: string, name?: string): UserRow {
        statements.insertUser.run(jid, now())
        if (name) statements.touchUser.run(name, jid)
        return statements.selectUser.get(jid) as UserRow
    },

    isBanned(jid: string): boolean {
        const row = statements.selectUser.get(jid) as UserRow | undefined
        return row?.banned === 1
    },

    bannedAny(jids: string[]): boolean {
        return jids.some((jid) => this.isBanned(jid))
    },

    ban(jid: string, banned = true): void {
        this.user(jid)
        statements.banUser.run(banned ? 1 : 0, jid)
    },

    gbanAdd(chatJid: string, userJid: string, reason: string, bannedBy: string, expiresAt: number | null = null): void {
        sqlite.prepare('INSERT OR REPLACE INTO gbans (group_jid, user_jid, reason, banned_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(chatJid, userJid, reason, bannedBy, Date.now(), expiresAt)
    },

    gbanRemove(chatJid: string, userJid: string): boolean {
        return sqlite.prepare('DELETE FROM gbans WHERE group_jid = ? AND user_jid = ?').run(chatJid, userJid).changes > 0
    },

    gbanAny(chatJid: string, userJids: string[]): boolean {
        if (!userJids.length) return false
        // Drop expired timed bans lazily, then check. Permanent bans have expires_at NULL.
        sqlite.prepare('DELETE FROM gbans WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now())
        const marks = userJids.map(() => '?').join(',')
        return Boolean(sqlite.prepare('SELECT 1 FROM gbans WHERE group_jid = ? AND user_jid IN (' + marks + ') LIMIT 1').get(chatJid, ...userJids))
    },

    modAdd(userJid: string, addedBy: string): void {
        sqlite.prepare('INSERT OR REPLACE INTO mods (user_jid, added_by, created_at) VALUES (?, ?, ?)').run(userJid, addedBy, Date.now())
    },

    modRemove(userJid: string): boolean {
        return sqlite.prepare('DELETE FROM mods WHERE user_jid = ?').run(userJid).changes > 0
    },

    modAny(userJids: string[]): boolean {
        if (!userJids.length) return false
        const marks = userJids.map(() => '?').join(',')
        return Boolean(sqlite.prepare('SELECT 1 FROM mods WHERE user_jid IN (' + marks + ') LIMIT 1').get(...userJids))
    },

    modList(): string[] {
        return (sqlite.prepare('SELECT user_jid FROM mods ORDER BY created_at ASC').all() as Array<{ user_jid: string }>).map((row) => row.user_jid)
    },

    setAfk(jid: string, reason: string): void {
        this.user(jid)
        statements.setAfk.run(reason, now(), jid)
    },

    clearAfk(jid: string): void {
        statements.clearAfk.run(jid)
    },

    theme(jid: string): string {
        return this.user(jid).theme
    },

    setTheme(jid: string, theme: string): void {
        this.user(jid)
        statements.setTheme.run(theme, jid)
    },

    group(jid: string): GroupRow {
        statements.insertGroup.run(jid, now())
        return statements.selectGroup.get(jid) as GroupRow
    },

    updateGroup(
        jid: string,
        patch: Partial<
            Record<'welcome' | 'goodbye' | 'antilink' | 'antifake' | 'antibadword' | 'autosticker' | 'bot_enabled', boolean>
        >,
    ): GroupRow {
        this.group(jid)
        const asInt = (value: boolean | undefined): number | null =>
            value === undefined ? null : value ? 1 : 0
        statements.setGroupFlag.run(
            asInt(patch.welcome),
            asInt(patch.goodbye),
            asInt(patch.antilink),
            asInt(patch.antifake),
            asInt(patch.antibadword),
            asInt(patch.autosticker),
            asInt(patch.bot_enabled),
            jid,
        )
        return this.group(jid)
    },

    addXp(chatJid: string, userJid: string, amount = 1): XpRow {
        statements.addXp.run(userJid, chatJid, amount, now())
        return statements.getXp.get(userJid, chatJid) as XpRow
    },

    xp(chatJid: string, userJid: string): XpRow {
        return (
            (statements.getXp.get(userJid, chatJid) as XpRow | undefined) ?? {
                user_jid: userJid,
                chat_jid: chatJid,
                xp: 0,
                messages: 0,
                updated_at: 0,
            }
        )
    },

    xpRank(chatJid: string, userJid: string): number {
        const row = statements.getXp.get(userJid, chatJid) as XpRow | undefined
        if (!row) return 0
        return (statements.countAbove.get(chatJid, row.xp) as { total: number }).total + 1
    },

    topXp(chatJid: string, limit = 10): XpRow[] {
        return statements.topXp.all(chatJid, limit) as XpRow[]
    },

    addCard(userJid: string, cardId: string): CardRow {
        statements.addCard.run(userJid, cardId, now())
        return statements.getCard.get(userJid, cardId) as CardRow
    },

    cards(userJid: string): CardRow[] {
        return statements.listCards.all(userJid) as CardRow[]
    },

    /** Every owned card row across all users, for collection leaderboards. */
    allCards(): Array<{ user_jid: string; card_id: string; copies: number }> {
        return statements.allCardRows.all() as Array<{ user_jid: string; card_id: string; copies: number }>
    },

    /** Game prize money earned on one day (epoch days), for the daily payout cap. */
    gameEarnedOn(userJid: string, day: number): number {
        const row = statements.rewardLedgerGet.get(userJid, day) as { total: number } | undefined
        return row?.total ?? 0
    },

    addGameEarning(userJid: string, day: number, amount: number): void {
        statements.rewardLedgerAdd.run(userJid, day, amount)
    },

    topCoins(limit = 10): Array<{ jid: string; name: string; coins: number }> {
        return statements.topCoins.all(limit) as Array<{ jid: string; name: string; coins: number }>
    },

    topXpAll(limit = 10): Array<{ user_jid: string; xp: number }> {
        return statements.topXpAll.all(limit) as Array<{ user_jid: string; xp: number }>
    },

    // ── Clans ────────────────────────────────────────────────────────────────

    clanCreate(name: string, tag: string, ownerJid: string): ClanRow {
        const existing = statements.clanByName.get(name) as ClanRow | undefined
        if (existing) throw new Error('that clan name is taken')
        const info = statements.clanInsert.run(name, tag, ownerJid, now())
        const clan = statements.clanById.get(Number(info.lastInsertRowid)) as ClanRow
        statements.clanAdd.run(ownerJid, clan.id, 'leader', now())
        return clan
    },

    setClanBio(clanId: number, bio: string | null): void {
        sqlite.prepare("UPDATE clans SET bio = ? WHERE id = ?").run(bio, clanId)
    },

    clanByName(name: string): ClanRow | undefined {
        return statements.clanByName.get(name) as ClanRow | undefined
    },

    clanById(id: number): ClanRow | undefined {
        return statements.clanById.get(id) as ClanRow | undefined
    },

    clanList(): Array<ClanRow & { members: number }> {
        return statements.clanList.all() as Array<ClanRow & { members: number }>
    },

    clanOf(userJid: string): ClanMemberRow | undefined {
        return statements.clanMember.get(userJid) as ClanMemberRow | undefined
    },

    clanMembers(clanId: number): ClanMemberRow[] {
        return statements.clanMembers.all(clanId) as ClanMemberRow[]
    },

    clanMemberCount(clanId: number): number {
        return (statements.clanMemberCount.get(clanId) as { n: number }).n
    },

    clanAdd(userJid: string, clanId: number, role = 'member'): void {
        statements.clanAdd.run(userJid, clanId, role, now())
    },

    clanRemove(userJid: string): void {
        statements.clanRemove.run(userJid)
    },

    clanSetRole(userJid: string, role: string): void {
        statements.clanSetRole.run(role, userJid)
    },

    clanDelete(clanId: number): void {
        sqlite.prepare('DELETE FROM clan_members WHERE clan_id = ?').run(clanId)
        statements.clanDelete.run(clanId)
    },

    card(userJid: string, cardId: string): CardRow | undefined {
        return statements.getCard.get(userJid, cardId) as CardRow | undefined
    },

    /**
     * Move exactly one copy of a card from one collection to another, atomically.
     * Returns false when the sender does not own it.
     */
    transferCardCopy(fromJid: string, toJid: string, cardId: string): boolean {
        const tx = sqlite.transaction((from: string, to: string, id: string): boolean => {
            const row = statements.getCard.get(from, id) as CardRow | undefined
            if (!row) return false
            if (row.copies > 1) {
                sqlite.prepare('UPDATE cards SET copies = copies - 1 WHERE user_jid = ? AND card_id = ?').run(from, id)
            } else {
                sqlite.prepare('DELETE FROM cards WHERE user_jid = ? AND card_id = ?').run(from, id)
            }
            statements.insDeckCard.run(to, id, Date.now())
            return true
        })
        return tx(fromJid, toJid, cardId)
    },

    /** Give one copy of a card from the sender's DECK to another user's DECK. */
    transferDeckCardCopy(fromJid: string, toJid: string, cardId: string): boolean {
        const tx = sqlite.transaction((from: string, to: string, id: string): boolean => {
            const row = statements.deckRow.get(from, id) as { copies: number } | undefined
            if (!row) return false
            if (row.copies > 1) {
                sqlite.prepare('UPDATE deck_cards SET copies = copies - 1 WHERE user_jid = ? AND card_id = ?').run(from, id)
            } else {
                statements.delDeckRow.run(from, id)
            }
            statements.insDeckCard.run(to, id, Date.now())
            return true
        })
        return tx(fromJid, toJid, cardId)
    },

    /** Give one copy of a card from the sender's DECK to another user's DECK. */

    topCollectors(limit = 10): Array<{ user_jid: string; total: number; unique_cards: number }> {
        return statements.topCollectors.all(limit) as Array<{
            user_jid: string
            total: number
            unique_cards: number
        }>
    },

    tcgDailyAt(userJid: string): number {
        return this.user(userJid).tcg_daily ?? 0
    },

    setTcgDailyAt(userJid: string, at: number): void {
        this.user(userJid)
        statements.setTcgDaily.run(at, userJid)
    },

    /** Raw settings read (used for mine game state and clan upkeep). */
    settingValue(key: string): string | undefined {
        const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
        return row?.value
    },

    clanTreasury(clanId: number): { balance: number; tax_pct: number } {
        sqlite.prepare('INSERT OR IGNORE INTO clan_treasury (clan_id, balance, tax_pct) VALUES (?, 0, 0)').run(clanId)
        return sqlite.prepare('SELECT balance, tax_pct FROM clan_treasury WHERE clan_id = ?').get(clanId) as { balance: number; tax_pct: number }
    },

    /** Add war points to a clan for the week (quizzes, exams, events). */
    addClanWarPoints(clanId: number, points: number, weekKey: string): void {
        sqlite
            .prepare('INSERT INTO clan_war_points (week_key, clan_id, points) VALUES (?, ?, ?) ON CONFLICT (week_key, clan_id) DO UPDATE SET points = points + excluded.points')
            .run(weekKey, clanId, points)
    },

    /** Record a trivia win and return the player's total. */
    recordQuizWin(userJid: string, name: string): number {
        sqlite
            .prepare('INSERT INTO quiz_scores (user_jid, name, wins, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_jid) DO UPDATE SET wins = wins + 1, name = excluded.name, updated_at = excluded.updated_at')
            .run(userJid, name, now())
        const row = sqlite.prepare('SELECT wins FROM quiz_scores WHERE user_jid = ?').get(userJid) as { wins?: number } | undefined
        return row?.wins ?? 0
    },

    quizTop(limit = 10): Array<{ name: string; wins: number }> {
        return sqlite.prepare('SELECT name, wins FROM quiz_scores ORDER BY wins DESC LIMIT ?').all(limit) as Array<{ name: string; wins: number }>
    },

    /** Cumulative net casino profit banked by a clan's members, all time. */
    clanProfit(clanId: number): number {
        const row = sqlite.prepare('SELECT total FROM clan_profit WHERE clan_id = ?').get(clanId) as { total?: number } | undefined
        return row?.total ?? 0
    },

    /** Sum of every member's wallet plus the treasury. */
    clanNetWorth(clanId: number): number {
        const row = sqlite
            .prepare('SELECT COALESCE(SUM(u.coins), 0) AS total FROM clan_members m JOIN users u ON u.jid = m.user_jid WHERE m.clan_id = ?')
            .get(clanId) as { total?: number } | undefined
        return (row?.total ?? 0) + this.clanTreasury(clanId).balance
    },

    setClanTax(clanId: number, pct: number): void {
        this.clanTreasury(clanId)
        sqlite.prepare('UPDATE clan_treasury SET tax_pct = ? WHERE clan_id = ?').run(pct, clanId)
    },

    /** Weekly upkeep in ryo. Owner-set with .clanupkeep, default 5000. */
    clanUpkeep(): number {
        const raw = this.settingValue('CLAN_UPKEEP')
        const value = raw === undefined ? NaN : Number.parseInt(raw, 10)
        return Number.isFinite(value) && value >= 0 ? value : 5000
    },

    setClanUpkeep(amount: number): void {
        this.setSetting('CLAN_UPKEEP', String(amount))
    },

    /** Clan-war standings for one week: every clan, most points first. */
    clanWarStandings(weekKey: string): Array<{ id: number; name: string; points: number }> {
        return sqlite.prepare(
            'SELECT c.id AS id, c.name AS name, COALESCE(p.points, 0) AS points FROM clans c LEFT JOIN clan_war_points p ON p.clan_id = c.id AND p.week_key = ? ORDER BY points DESC, c.name ASC',
        ).all(weekKey) as Array<{ id: number; name: string; points: number }>
    },

    /** Chats where the casino is open (.agb gamble). */
    casinoChats(): string[] {
        return (sqlite.prepare('SELECT chat_jid FROM casino_chats').all() as Array<{ chat_jid: string }>).map((row) => row.chat_jid)
    },

    /**
     * Atomic gamble settle. Debits `debit` (0 when the stake was already taken),
     * credits `payout`, takes the clan cut on profit (profit = payout - roundStake),
     * adds war points for new stakes, and optionally saves or clears a mine game
     * key in the same transaction. Returns false and changes nothing when the wallet
     * cannot cover the debit.
     */
    settleGamble(
        userJid: string,
        debit: number,
        payout: number,
        roundStake: number,
        weekKey: string,
        opts: { clearKey?: string; saveKey?: string; saveValue?: string } = {},
    ): boolean {
        this.user(userJid)
        const tx = sqlite.transaction((): boolean => {
            if (debit > 0) {
                const taken = statements.spendCoins.run(debit, userJid, debit)
                if (taken.changes === 0) return false
            }
            let tax = 0
            const clan = this.clanOf(userJid)
            if (clan) {
                const treasury = this.clanTreasury(clan.clan_id)
                const profit = payout - roundStake
                if (profit > 0 && treasury.tax_pct > 0) tax = Math.floor((profit * treasury.tax_pct) / 100)
                if (profit > 0) {
                    sqlite
                        .prepare('INSERT INTO clan_profit (clan_id, total) VALUES (?, ?) ON CONFLICT (clan_id) DO UPDATE SET total = total + excluded.total')
                        .run(clan.clan_id, profit)
                } else if (profit < 0) {
                    sqlite
                        .prepare('INSERT INTO clan_profit (clan_id, total) VALUES (?, 0) ON CONFLICT (clan_id) DO NOTHING')
                        .run(clan.clan_id)
                }
                if (tax > 0) sqlite.prepare('UPDATE clan_treasury SET balance = balance + ? WHERE clan_id = ?').run(tax, clan.clan_id)
                if (debit > 0) {
                    sqlite
                        .prepare('INSERT INTO clan_war_points (week_key, clan_id, points) VALUES (?, ?, ?) ON CONFLICT (week_key, clan_id) DO UPDATE SET points = points + excluded.points')
                        .run(weekKey, clan.clan_id, debit)
                }
            }
            const credit = payout - tax
            if (credit > 0) statements.addCoins.run(credit, userJid)
            if (opts.clearKey) sqlite.prepare('DELETE FROM settings WHERE key = ?').run(opts.clearKey)
            if (opts.saveKey && opts.saveValue !== undefined) {
                sqlite
                    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
                    .run(opts.saveKey, opts.saveValue, now())
            }
            return true
        })
        return tx()
    },

    /** Atomic upkeep payment from the treasury. False (no change) when the treasury is short. */
    payClanUpkeep(clanId: number, amount: number): boolean {
        const tx = sqlite.transaction((): boolean => {
            const row = this.clanTreasury(clanId)
            if (row.balance < amount) return false
            sqlite.prepare('UPDATE clan_treasury SET balance = balance - ? WHERE clan_id = ?').run(amount, clanId)
            return true
        })
        return tx()
    },

    /**
     * A clan that failed upkeep is dissolved: each member goes to the largest clan
     * that still has room (under maxMembers). Anyone with no room is removed from clans.
     */
    reassignClan(clanId: number, maxMembers: number): { moved: number; unplaced: number; into: string[] } {
        const members = this.clanMembers(clanId)
        const into = new Set<string>()
        let moved = 0
        let unplaced = 0
        const tx = sqlite.transaction((): void => {
            for (const member of members) {
                const target = this.clanList().find((clan) => clan.id !== clanId && clan.members < maxMembers)
                if (!target) {
                    statements.clanRemove.run(member.user_jid)
                    unplaced += 1
                    continue
                }
                statements.clanAdd.run(member.user_jid, target.id, 'member', now())
                into.add(target.name)
                moved += 1
            }
            statements.clanDelete.run(clanId)
            sqlite.prepare('DELETE FROM clan_members WHERE clan_id = ?').run(clanId)
            sqlite.prepare('DELETE FROM clan_treasury WHERE clan_id = ?').run(clanId)
            sqlite.prepare('DELETE FROM clan_war_points WHERE clan_id = ?').run(clanId)
        })
        tx()
        return { moved, unplaced, into: [...into] }
    },

    coins(userJid: string): number {
        return this.user(userJid).coins ?? 0
    },

    addCoins(userJid: string, amount: number): number {
        this.user(userJid)
        statements.addCoins.run(amount, userJid)
        return this.coins(userJid)
    },

    dailyAt(userJid: string): number {
        return this.user(userJid).daily_at ?? 0
    },

    setDailyAt(userJid: string, at: number): void {
        this.user(userJid)
        statements.setDailyAt.run(at, userJid)
    },

    dailyStreak(userJid: string): number {
        return this.user(userJid).daily_streak ?? 0
    },

    setDailyState(userJid: string, at: number, streak: number): void {
        this.user(userJid)
        statements.setDailyState.run(at, streak, userJid)
    },

    workAt(userJid: string): number {
        return this.user(userJid).work_at ?? 0
    },

    setWorkAt(userJid: string, at: number): void {
        this.user(userJid)
        statements.setWorkAt.run(at, userJid)
    },

    /** Atomic: only deducts when the balance covers it. Returns false otherwise. */
    spendCoins(userJid: string, amount: number): boolean {
        this.user(userJid)
        return statements.spendCoins.run(amount, userJid, amount).changes > 0
    },

    vault(userJid: string): number {
        return this.user(userJid).vault ?? 0
    },

    /** Atomic wallet -> vault move. False when the wallet cannot cover it. */
    deposit(userJid: string, amount: number): boolean {
        this.user(userJid)
        return statements.deposit.run(amount, amount, userJid, amount).changes > 0
    },

    /** Atomic vault -> wallet move. False when the vault cannot cover it. */
    withdraw(userJid: string, amount: number): boolean {
        this.user(userJid)
        return statements.withdraw.run(amount, amount, userJid, amount).changes > 0
    },

    robAt(userJid: string): number {
        return this.user(userJid).rob_at ?? 0
    },

    setRobAt(userJid: string, at: number): void {
        this.user(userJid)
        statements.setRobAt.run(at, userJid)
    },

    itemQty(userJid: string, item: string): number {
        return (statements.selectItem.get(userJid, item) as { qty: number } | undefined)?.qty ?? 0
    },

    addItem(userJid: string, item: string, qty: number): void {
        this.user(userJid)
        statements.upsertItem.run(userJid, item, qty)
    },

    /** Atomic consume. Returns true only when the user had at least `qty` of the item. */
    takeItem(userJid: string, item: string, qty: number): boolean {
        return statements.decItem.run(qty, userJid, item, qty).changes > 0
    },

    items(userJid: string): Array<{ item: string; qty: number }> {
        return statements.listItems.all(userJid) as Array<{ item: string; qty: number }>
    },

    gameStat(userJid: string): GameStatRow | undefined {
        return statements.selectGameStat.get(userJid) as GameStatRow | undefined
    },

    gameBreakdown(userJid: string): GameBreakdownRow[] {
        return statements.selectBreakdown.all(userJid) as GameBreakdownRow[]
    },

    /**
     * One row per finished game. The global streak lives on `game_stats` so a
     * win in any game extends it and a loss in any game resets it.
     */
    recordGame(userJid: string, game: string, outcome: GameOutcome): GameStatRow {
        const current = this.gameStat(userJid) ?? {
            user_jid: userJid,
            wins: 0,
            losses: 0,
            draws: 0,
            streak: 0,
            best_streak: 0,
            updated_at: 0,
        }

        const next: GameStatRow = { ...current, updated_at: now() }
        if (outcome === 'win') {
            next.wins += 1
            next.streak += 1
            next.best_streak = Math.max(next.best_streak, next.streak)
        } else if (outcome === 'loss') {
            next.losses += 1
            next.streak = 0
        } else {
            next.draws += 1
        }

        statements.upsertGameStat.run(
            userJid,
            next.wins,
            next.losses,
            next.draws,
            next.streak,
            next.best_streak,
            next.updated_at,
        )

        const perGame = this.gameBreakdown(userJid).find((row) => row.game === game) ?? {
            user_jid: userJid,
            game,
            wins: 0,
            losses: 0,
            draws: 0,
        }
        const updated = {
            ...perGame,
            wins: perGame.wins + (outcome === 'win' ? 1 : 0),
            losses: perGame.losses + (outcome === 'loss' ? 1 : 0),
            draws: perGame.draws + (outcome === 'draw' ? 1 : 0),
        }
        statements.upsertBreakdown.run(userJid, game, updated.wins, updated.losses, updated.draws)

        return next
    },

    gameRank(userJid: string): number {
        const row = this.gameStat(userJid)
        if (!row || row.wins === 0) return 0
        return this.gameRankByWins(row.wins)
    },

    gameRankByWins(wins: number): number {
        if (wins <= 0) return 0
        return (statements.countGameWinsAbove.get(wins) as { total: number }).total + 1
    },

    topGameStats(limit = 10): GameStatRow[] {
        return statements.listGameStats.all(limit) as GameStatRow[]
    },

    allGameStats(): GameStatRow[] {
        return statements.allGameStats.all() as GameStatRow[]
    },

    allGameBreakdown(): GameBreakdownRow[] {
        return statements.allBreakdown.all() as GameBreakdownRow[]
    },

    /** Restore a synced row without ever shrinking local progress. */
    mergeGameStat(row: GameStatRow): void {
        const current = this.gameStat(row.user_jid)
        const merged: GameStatRow = current
            ? {
                  user_jid: row.user_jid,
                  wins: Math.max(current.wins, row.wins),
                  losses: Math.max(current.losses, row.losses),
                  draws: Math.max(current.draws, row.draws),
                  streak: row.updated_at >= current.updated_at ? row.streak : current.streak,
                  best_streak: Math.max(current.best_streak, row.best_streak),
                  updated_at: Math.max(current.updated_at, row.updated_at),
              }
            : row

        statements.upsertGameStat.run(
            merged.user_jid,
            merged.wins,
            merged.losses,
            merged.draws,
            merged.streak,
            merged.best_streak,
            merged.updated_at,
        )
    },

    mergeGameBreakdown(row: GameBreakdownRow): void {
        const current = this.gameBreakdown(row.user_jid).find((entry) => entry.game === row.game)
        statements.upsertBreakdown.run(
            row.user_jid,
            row.game,
            Math.max(current?.wins ?? 0, row.wins),
            Math.max(current?.losses ?? 0, row.losses),
            Math.max(current?.draws ?? 0, row.draws),
        )
    },

    /**
     * Add a legacy row onto another key. Used by the one-time LID -> phone
     * migration: the two rows hold different games, so the counts add rather
     * than take the larger side.
     */
    absorbGameStat(row: GameStatRow): void {
        const current = this.gameStat(row.user_jid)
        if (!current) {
            this.mergeGameStat(row)
            return
        }

        const latest = row.updated_at >= current.updated_at ? row : current
        statements.upsertGameStat.run(
            row.user_jid,
            current.wins + row.wins,
            current.losses + row.losses,
            current.draws + row.draws,
            latest.streak,
            Math.max(current.best_streak, row.best_streak),
            Math.max(current.updated_at, row.updated_at),
        )
    },

    absorbGameBreakdown(row: GameBreakdownRow): void {
        const current = this.gameBreakdown(row.user_jid).find((entry) => entry.game === row.game)
        statements.upsertBreakdown.run(
            row.user_jid,
            row.game,
            (current?.wins ?? 0) + row.wins,
            (current?.losses ?? 0) + row.losses,
            (current?.draws ?? 0) + row.draws,
        )
    },

    deleteGameStat(userJid: string): void {
        statements.deleteGameStat.run(userJid)
    },

    deleteGameBreakdown(userJid: string, game: string): void {
        statements.deleteBreakdown.run(userJid, game)
    },

    setFilter(chatJid: string, trigger: string, response: string, createdBy: string): void {
        statements.upsertFilter.run(chatJid, trigger.trim().toLowerCase(), response, createdBy, now())
    },

    filters(chatJid: string): FilterRow[] {
        return statements.listFilters.all(chatJid) as FilterRow[]
    },

    removeFilter(chatJid: string, trigger: string): number {
        return statements.deleteFilter.run(chatJid, trigger.trim().toLowerCase()).changes
    },

    clearFilters(chatJid: string): number {
        return statements.clearFilters.run(chatJid).changes
    },

    warn(userJid: string, groupJid: string, reason: string, warnedBy: string): number {
        statements.addWarning.run(userJid, groupJid, reason, warnedBy, now())
        return (statements.countWarnings.get(userJid, groupJid) as { total: number }).total
    },

    warnings(userJid: string, groupJid: string): WarningRow[] {
        return statements.listWarnings.all(userJid, groupJid) as WarningRow[]
    },

    warningsForGroup(groupJid: string): WarningRow[] {
        return statements.listGroupWarnings.all(groupJid) as WarningRow[]
    },

    clearWarnings(userJid: string, groupJid: string): void {
        statements.clearWarnings.run(userJid, groupJid)
    },

    clearWarningsFor(userJids: string[], groupJid: string): void {
        for (const jid of new Set(userJids.filter(Boolean))) statements.clearWarnings.run(jid, groupJid)
    },

    autoreact(chatJid: string): { enabled: boolean; emoji: string; configured: boolean } {
        const row = statements.getAutoreact.get(chatJid) as any
        return {
            enabled: row?.enabled === 1,
            emoji: row?.emoji ?? '✅',
            configured: Boolean(row),
        }
    },

    setAutoreact(chatJid: string, enabled: boolean): void {
        const current = this.autoreact(chatJid)
        statements.upsertAutoreact.run(chatJid, enabled ? 1 : 0, current.emoji, now())
    },

    setAutoreactEmoji(chatJid: string, emoji: string): void {
        statements.upsertAutoreact.run(chatJid, 1, emoji, now())
    },

    addNote(chatJid: string, userJid: string, body: string): NoteRow {
        const result = statements.addNote.run(chatJid, userJid, body, now())
        return {
            id: Number(result.lastInsertRowid),
            chat_jid: chatJid,
            user_jid: userJid,
            body,
            created_at: now(),
        }
    },

    notes(chatJid: string): NoteRow[] {
        return statements.listNotes.all(chatJid) as NoteRow[]
    },

    removeNote(chatJid: string, id: number): number {
        return statements.deleteNote.run(id, chatJid).changes
    },

    clearNotes(chatJid: string): number {
        return statements.clearNotes.run(chatJid).changes
    },

    settings(): SettingRow[] {
        return statements.listSettings.all() as SettingRow[]
    },

    setSetting(key: string, value: string): void {
        statements.setSetting.run(key, value, now())
    },

    removeSetting(key: string): number {
        return statements.deleteSetting.run(key).changes
    },

    setStickerTrigger(hash: string, command: string, createdBy: string): void {
        statements.upsertStickerTrigger.run(hash, command, createdBy, now())
    },

    stickerTrigger(hash: string): string {
        const row = statements.getStickerTrigger.get(hash) as StickerTriggerRow | undefined
        return row?.command ?? ''
    },

    stickerTriggers(): StickerTriggerRow[] {
        return statements.listStickerTriggers.all() as StickerTriggerRow[]
    },

    removeStickerTrigger(hash: string): number {
        return statements.deleteStickerTrigger.run(hash).changes
    },

    pokeCatch(jid: string, pokeId: number, name: string, rarity: string, power: number, quality = 0, location = 'roster'): boolean {
        const result = sqlite
            .prepare(
                'INSERT OR IGNORE INTO pokedexcaught (user_jid, poke_id, name, rarity, power, caught_at, quality, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(jid, pokeId, name, rarity, power, now(), quality, location)
        return result.changes > 0
    },

    pokeGet(jid: string, pokeId: number): PokeCaughtRow | undefined {
        return sqlite.prepare('SELECT * FROM pokedexcaught WHERE user_jid = ? AND poke_id = ?').get(jid, pokeId) as PokeCaughtRow | undefined
    },

    pokeCountAt(jid: string, location: string): number {
        const row = sqlite
            .prepare('SELECT COUNT(*) AS n FROM pokedexcaught WHERE user_jid = ? AND location = ?')
            .get(jid, location) as { n: number }
        return row.n
    },

    pokeSetLocation(jid: string, pokeId: number, location: string): void {
        sqlite.prepare('UPDATE pokedexcaught SET location = ? WHERE user_jid = ? AND poke_id = ?').run(location, jid, pokeId)
    },

    /** Permanently removes a pokemon and its moves and deck slot. */
    pokeRelease(jid: string, pokeId: number): boolean {
        sqlite.prepare('DELETE FROM poke_moves WHERE user_jid = ? AND poke_id = ?').run(jid, pokeId)
        sqlite.prepare('DELETE FROM poke_pc WHERE user_jid = ? AND poke_id = ?').run(jid, pokeId)
        return sqlite.prepare('DELETE FROM pokedexcaught WHERE user_jid = ? AND poke_id = ?').run(jid, pokeId).changes > 0
    },

    questGet(jid: string, day: number): { done: boolean } {
        const row = sqlite.prepare('SELECT done FROM poke_quest WHERE user_jid = ? AND day = ?').get(jid, day) as { done: number } | undefined
        return { done: Boolean(row?.done) }
    },

    questSet(jid: string, day: number, done: number, progress: number): void {
        sqlite
            .prepare('INSERT INTO poke_quest (user_jid, day, done, progress) VALUES (?, ?, ?, ?) ON CONFLICT (user_jid, day) DO UPDATE SET done = excluded.done, progress = excluded.progress')
            .run(jid, day, done, progress)
    },

    pokeOne(jid: string, query: string): PokeCaughtRow | undefined {
        const byName = sqlite
            .prepare('SELECT * FROM pokedexcaught WHERE user_jid = ? AND name = ?')
            .get(jid, query) as PokeCaughtRow | undefined
        return byName
    },

    /** When a 24h clan cooldown lifts (0 = no cooldown). */
    clanCooldownUntil(jid: string): number {
        return this.user(jid).clan_cd ?? 0
    },

    setClanCooldown(jid: string, until: number): void {
        this.user(jid)
        sqlite.prepare('UPDATE users SET clan_cd = ? WHERE jid = ?').run(until, jid)
    },

    /** Has this player picked a starter and opened the pokemon game yet? */
    pokeStarted(jid: string): boolean {
        return Boolean(this.user(jid).poke_started)
    },

    setPokeStarted(jid: string): void {
        this.user(jid)
        sqlite.prepare('UPDATE users SET poke_started = 1 WHERE jid = ?').run(jid)
    },

    pokeMoves(jid: string, pokeId: number): string[] {
        return (
            sqlite
                .prepare('SELECT move FROM poke_moves WHERE user_jid = ? AND poke_id = ? ORDER BY rowid ASC')
                .all(jid, pokeId) as Array<{ move: string }>
        ).map((row) => row.move)
    },

    pokeForget(jid: string, pokeId: number, move: string): void {
        sqlite.prepare('DELETE FROM poke_moves WHERE user_jid = ? AND poke_id = ? AND move = ?').run(jid, pokeId, move)
    },

    /** Returns false when the move was already known. */
    pokeLearn(jid: string, pokeId: number, move: string): boolean {
        const info = sqlite
            .prepare('INSERT OR IGNORE INTO poke_moves (user_jid, poke_id, move, learned_at) VALUES (?, ?, ?, ?)')
            .run(jid, pokeId, move, now())
        return info.changes > 0
    },

    /** Add battle XP to one caught pokemon; returns the new xp and level. */
    pokeAddXp(jid: string, pokeId: number, amount: number): { xp: number; level: number } {
        sqlite
            .prepare('UPDATE pokedexcaught SET xp = xp + ? WHERE user_jid = ? AND poke_id = ?')
            .run(amount, jid, pokeId)
        const row = sqlite
            .prepare('SELECT xp FROM pokedexcaught WHERE user_jid = ? AND poke_id = ?')
            .get(jid, pokeId) as { xp: number } | undefined
        const xp = row?.xp ?? 0
        const level = Math.min(100, 1 + Math.floor(xp / 100))
        sqlite
            .prepare('UPDATE pokedexcaught SET level = ? WHERE user_jid = ? AND poke_id = ?')
            .run(level, jid, pokeId)
        return { xp, level }
    },

    /** Swap the caught species in place when it evolves. */
    pokeEvolve(jid: string, fromId: number, to: { id: number; name: string; power: number }): boolean {
        const row = sqlite
            .prepare('SELECT * FROM pokedexcaught WHERE user_jid = ? AND poke_id = ?')
            .get(jid, fromId) as PokeCaughtRow | undefined
        if (!row) return false
        if (sqlite.prepare('SELECT 1 FROM pokedexcaught WHERE user_jid = ? AND poke_id = ?').get(jid, to.id)) {
            // Already own the evolved form: bank the copy instead of duplicating the key.
            return false
        }
        // Keep learned moves with the pokemon across its evolution.
        sqlite
            .prepare(
                'INSERT OR IGNORE INTO poke_moves (user_jid, poke_id, move, learned_at) SELECT user_jid, ?, move, learned_at FROM poke_moves WHERE user_jid = ? AND poke_id = ?',
            )
            .run(to.id, jid, fromId)
        sqlite.prepare('DELETE FROM poke_moves WHERE user_jid = ? AND poke_id = ?').run(jid, fromId)

        return (
            sqlite
                .prepare('UPDATE pokedexcaught SET poke_id = ?, name = ?, power = ? WHERE user_jid = ? AND poke_id = ?')
                .run(to.id, to.name, to.power, jid, fromId).changes > 0
        )
    },

    pokeList(jid: string): PokeCaughtRow[] {
        return sqlite
            .prepare('SELECT * FROM pokedexcaught WHERE user_jid = ? ORDER BY caught_at ASC')
            .all(jid) as PokeCaughtRow[]
    },

    close(): void {
        sqlite.close()
        log.debug('database closed')
    },

    healthcheck(): boolean {
        try {
            sqlite.prepare('SELECT 1').get()
            return true
        } catch {
            return false
        }
    },
}
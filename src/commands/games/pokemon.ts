import { ari, findCommand } from '../../bot/registry.js'
import { db } from '../../db/index.js'
import { jidToNumber } from '../../bot/helpers.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { sameUser } from '../../bot/identity.js'
import { config } from '../../config.js'
import { activeSpawn, clearSpawn, fetchPokemon, levelUpMoves, prettyMove, normalizePokeName, rarityLabel, titleName } from '../../features/pokemon.js'
import { pokeGuard } from '../../features/tcg.js'
import { rewardGameWin, dayIndex, balanceOf, money } from '../../features/economy.js'
import { recordGame } from '../../features/game-stats.js'
import { fetchEvolution } from '../../features/pokemon.js'
import {
    KO_XP,
    PC_CAP,
    ROSTER_CAP,
    openEvoOffer,
    hasEvoOffer,
    takeEvoOffer,
    questTick,
    questTitle,
    featuredType,
    rollCatch,
    rollQuality,
    starText,
    releaseValue,
    setReleasePending,
    takeReleasePending,
} from '../../features/poke-upgrade.js'

// Battle state storage
type BattleState = 'pending' | 'accepted' | 'declined' | 'in_progress' | 'finished'

type Challenge = {
    challengerJid: string
    opponentJid: string
    challengerName: string
    opponentName: string
    challengedAt: number
    challengerPokeId: number | null
    opponentPokeId: number | null
    challengerMoveFirst: boolean
}

interface Fighter {
    pokeId: number
    name: string
    poke: any
    hp: number
    maxHP: number
}

type Battle = {
    state: BattleState
    challenge: Challenge
    challengerTeam: Fighter[]
    opponentTeam: Fighter[]
    challengerIdx: number
    opponentIdx: number
    round: number
    /** Per-side defensive stance (guard/dodge) set last turn; cleared after one hit. */
    defense?: { challenger?: 'guard' | 'dodge'; opponent?: 'guard' | 'dodge' }
    history: string[]
    countdown?: ReturnType<typeof setTimeout>
    swapped: { challenger: boolean; opponent: boolean }
}

const battles = new Map<string, Battle>()

// Persistence: every mutation is mirrored to sqlite so battles survive restarts.
const persist = (key: string): void => {
    const battle = battles.get(key)
    if (battle) db.saveBattle(key, battle)
    else db.delBattle(key)
}

const removeBattle = (key: string): void => {
    const battle = battles.get(key)
    if (battle?.countdown) clearTimeout(battle.countdown)
    battles.delete(key)
    db.delBattle(key)
}

// Boot: restore battles saved before the last restart. Pending challenges
// older than their 4-minute window and battles idle over 2h are dropped.
for (const row of db.loadBattles()) {
    try {
        const battle = JSON.parse(row.data) as Battle
        const idle = Date.now() - (battle.challenge.challengedAt || 0)
        if (battle.state === 'pending' && idle > 4 * 60_000) {
            db.delBattle(row.chat_key)
            continue
        }
        if (idle > 2 * 60 * 60_000) {
            db.delBattle(row.chat_key)
            continue
        }
        if (!battle.swapped) battle.swapped = { challenger: false, opponent: false }
        if (battle.state === 'accepted') battle.state = 'in_progress' // countdown died with the restart
        if (!battle.challengerTeam) battle.challengerTeam = []
        if (!battle.opponentTeam) battle.opponentTeam = []
        battles.set(row.chat_key, battle)
    } catch {
        db.delBattle(row.chat_key)
    }
}


// Check if user has a pending battle challenge
function hasPendingBattle(jid: string): boolean {
    for (const [, battle] of battles) {
        if (!battle) continue
        if (battle.challenge.challengerJid === jid || battle.challenge.opponentJid === jid) {
            return true
        }
    }
    return false
}

// Get pending battle for a user
function getPendingBattle(jid: string): { battle: Battle; key: string } | null {
    for (const [key, battle] of battles) {
        if (!battle) continue
        // A challenge nobody answered dies after 4 minutes.
        if (battle.state === 'pending' && Date.now() - battle.challenge.challengedAt > 4 * 60_000) {
            removeBattle(key)
            continue
        }
        if (battle.challenge.challengerJid === jid || battle.challenge.opponentJid === jid) {
            return { battle, key }
        }
    }
    return null
}
// ── Move levels ─────────────────────────────────────────────────────────────
// Each pokemon has a level (1 + xp/100). Level-up moves unlock at a level
// (pokeapi level_learned_at). Learn-check teaches every move whose level is
// met, lowest level first. Max 4 moves; a full set forgets the oldest.
const MAX_MOVES = 4
const STARTER_XP = 400 // first catch = starter at level 5
const BATTLE_WIN_XP = 50

const learnDue = async (jid: string, pokeId: number, level: number): Promise<string[]> => {
    const learned: string[] = []
    for (const option of await levelUpMoves(pokeId)) {
        if (option.at > level) break
        const known = db.pokeMoves(jid, pokeId)
        if (known.includes(option.move)) continue
        if (known.length >= MAX_MOVES) db.pokeForget(jid, pokeId, known[0]!)
        db.pokeLearn(jid, pokeId, option.move)
        learned.push(option.move)
    }
    return learned
}

// Ari commands
// Team of up to 3, strongest first; PC-staged pokemon take priority
const TEAM_SIZE = 3
const buildTeam = async (jid: string): Promise<Fighter[] | null> => {
    const all = db.pokeList(jid)
    const pcIds = db.pcOf(jid).map((r) => r.poke_id)
    const rows = pcIds.length
        ? pcIds.map((id) => all.find((r) => r.poke_id === id)).filter((r): r is (typeof all)[number] => !!r).slice(0, TEAM_SIZE)
        : all.slice().sort((a, b) => b.power - a.power).slice(0, TEAM_SIZE)
    if (!rows.length) return null
    const team: Fighter[] = []
    for (const row of rows) {
        const poke = await fetchPokemon(row.poke_id)
        if (!poke) continue
        const maxHP = poke.stats?.reduce((sum: number, st: any) => sum + st.base, 0) || 100
        team.push({ pokeId: row.poke_id, name: row.name, poke, hp: maxHP, maxHP })
    }
    return team.length ? team : null
}

// Manual pick: .pswap 2 5 1 collection numbers
const pickTeam = async (jid: string, nums: number[]): Promise<Fighter[] | null> => {
    const rows = db.pokeList(jid)
    const team: Fighter[] = []
    for (const n of nums.slice(0, TEAM_SIZE)) {
        const row = rows[n - 1]
        if (!row) return null
        const poke = await fetchPokemon(row.poke_id)
        if (!poke) continue
        const maxHP = poke.stats?.reduce((sum: number, st: any) => sum + st.base, 0) || 100
        team.push({ pokeId: row.poke_id, name: row.name, poke, hp: maxHP, maxHP })
    }
    return team.length ? team : null
}

// HP bar, 10 slots
const hpBar = (current: number, max: number): string => {
    const filled = Math.max(0, Math.min(10, Math.ceil((current / max) * 10)))
    return '✳'.repeat(filled) + '✧'.repeat(10 - filled)
}

const statOf = (poke: any, name: string): number =>
    poke?.stats?.find((stat: { name: string }) => stat.name === name)?.base ?? 50

ari({
    name: 'pokebattle',
    description: 'Challenge another user to a pokemon team battle (3v3)',
    category: 'games',
    aliases: ['pbattle', 'challenge'],
    usage: 'pokebattle @user',
    cooldownMs: 10_000,
    run: async (ctx) => {
        // `.pbattle end` cancels the group's current battle or pending challenge.
        if (ctx.args[0]?.toLowerCase() === 'end') {
            await runEndBattle(ctx)
            return
        }

        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        if (db.pokeStarted(ctx.sender) === false) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart to start your journey!')
            return
        }
        if (!ctx.isGroup) { await ctx.reply('Battles happen in groups 🐾'); return }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply('Usage: .pbattle @user')
            return
        }

        const opponent = await normalizeTarget(ctx, raw)
        if (sameUser(opponent, ctx.sender)) {
            await ctx.reply('🪞 You cannot battle yourself!')
            return
        }

        if (hasPendingBattle(ctx.sender)) {
            await ctx.reply('You already have a pending battle! Wait for it to resolve.')
            return
        }

        if (hasPendingBattle(opponent)) {
            const oppName = await targetName(ctx, opponent) || jidToNumber(opponent)
            await ctx.reply(`${oppName} already has a pending battle!`)
            return
        }

        const challenge: Challenge = {
            challengerJid: ctx.sender,
            opponentJid: opponent,
            challengerName: ctx.senderName,
            opponentName: await targetName(ctx, opponent) || jidToNumber(opponent),
            challengedAt: Date.now(),
            challengerPokeId: null,
            opponentPokeId: null,
            challengerMoveFirst: Math.random() < 0.5,
        }

        const battleKey = `battle:${ctx.chat}`
        battles.set(battleKey, {
            state: 'pending',
            challenge,
            challengerTeam: [],
            opponentTeam: [],
            challengerIdx: 0,
            opponentIdx: 0,
            round: 0,
            history: [],
            swapped: { challenger: false, opponent: false },
        } as Battle)
        persist(battleKey)

        await ctx.reply([
            '⚔️ *Pokemon Team Battle Challenge* (3v3)',
            '',
            `${ctx.senderName} has challenged ${challenge.opponentName}!`,
            '',
            `▸ ${challenge.opponentName} types accept to fight, or decline / reject to refuse.`,
        ].join('\n'))
    },
})

// .pcoll: view your pokemon collection
ari({
    name: 'pokecollection',
    description: 'View your pokemon collection',
    category: 'games',
    aliases: ['pcoll', 'pc'],
    usage: 'pokecollection',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pokeList = db.pokeList(ctx.sender)
        if (!pokeList.length) {
            await ctx.reply('You have no pokemon yet. Use .pspawn to catch some!')
            return
        }
        const lines = pokeList.map((row, index) => '▸ ' + (index + 1) + '. ' + row.name + ' (Power: ' + row.power + ', ' + starText(row.quality ?? 0) + (row.location === 'pc' ? ', PC' : '') + ')').join('\n')
        await ctx.reply('*Your pokemon collection:*\n' + lines + '\n\nDuring a battle countdown, use .pswap to re-roll your team, or .pswap <numbers> to pick specific ones (e.g. .pswap 2 5 1).')
    },
})


// .pc: alias of .pcoll

ari({
    name: 'pokedeck',
    description: 'View your battle deck (the pokemon available to battle)',
    category: 'games',
    aliases: ['pdeck'],
    usage: 'pokedeck',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pokeList = db.pokeList(ctx.sender)
        const pcIds = db.pcOf(ctx.sender).map((r) => r.poke_id)
        const team = pcIds.length
            ? pcIds.map((id) => pokeList.find((p) => p.poke_id === id)).filter((r): r is typeof pokeList[number] => !!r)
            : pokeList.slice().sort((a, b) => b.power - a.power).slice(0, TEAM_SIZE)
        if (!team.length) {
            await ctx.reply('Your battle deck is empty. Catch some with .pspawn!')
            return
        }
        const lines = team.map((r, i) => '▸ ' + (i + 1) + '. ' + r.name + ' (Power: ' + r.power + ')').join('\n')
        await ctx.reply('⚔️ *Your battle deck:*\n' + lines + (pcIds.length ? '' : '\n\n(auto-picked: your strongest 3. Set it yourself with .m2pc <collection number>)'))
    },
})

ari({
    name: 'm2pcdeck',
    description: 'Stage collection pokemon into your battle deck (max 3), e.g. .m2pcdeck 4 2 1',
    category: 'games',
    aliases: ['m2pc', 'movetopokedeck'],
    usage: 'm2pcdeck <pcoll numbers>',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pokeList = db.pokeList(ctx.sender)
        if (!pokeList.length) {
            await ctx.reply('You have no pokemon yet. Use .pspawn to catch some!')
            return
        }
        const nums = ctx.args.map((n: string) => parseInt(n)).filter((n: number) => !isNaN(n))
        if (!nums.length) {
            await ctx.reply('Usage: .m2pcdeck <pcoll numbers, up to 3>. e.g. .m2pcdeck 4 2 1')
            return
        }
        for (const n of nums) {
            if (n < 1 || n > pokeList.length) {
                await ctx.reply(`Invalid number *${n}*. Check .pcoll first (1-${pokeList.length}).`)
                return
            }
        }
        const unique = [...new Set(nums)].slice(0, TEAM_SIZE)
        db.pcClear(ctx.sender)
        const named: string[] = []
        unique.forEach((n, idx) => {
            const row = pokeList[n - 1]
            if (!row) return
            db.pcSet(ctx.sender, row.poke_id, idx + 1)
            named.push(`*${row.name}*`)
        })
        await ctx.reply(`📦 Battle deck set (${named.length}/${TEAM_SIZE}): ${named.join(', ')}`)
    },
})

// .pswap: re-roll your team while the countdown is running
ari({
    name: 'pswap',
    description: 'Re-roll your battle team during the countdown',
    category: 'games',
    usage: 'pswap',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pending = getPendingBattle(ctx.sender)
        if (!pending || pending.battle.state !== 'accepted') {
            await ctx.reply('No team to change right now. Teams are set when your battle is accepted, and locked once it starts.')
            return
        }
        const { battle, key } = pending
        const isChallenger = sameUser(ctx.sender, battle.challenge.challengerJid)
        if (!isChallenger && !sameUser(ctx.sender, battle.challenge.opponentJid)) {
            await ctx.reply('You are not part of this battle.')
            return
        }
        const nums = ctx.args.map((n: string) => parseInt(n)).filter((n: number) => !isNaN(n))
        const team = nums.length ? await pickTeam(ctx.sender, nums) : await buildTeam(ctx.sender)
        if (!team) {
            await ctx.reply('You need at least one pokemon. Catch some with .pspawn!')
            return
        }
        if (isChallenger) {
            battle.challengerTeam = team
            battle.challengerIdx = 0
        } else {
            battle.opponentTeam = team
            battle.opponentIdx = 0
        }
        persist(key)
        await ctx.reply(`🔄 ${ctx.senderName} set their team: ${team.map((f) => f.name).join(', ')}`)
    },
})

// .move <name>: attack with your active pokemon
ari({
    name: 'move',
    description: 'Choose a move during a pokemon battle',
    category: 'games',
    usage: 'move <move name>',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pending = getPendingBattle(ctx.sender)
        if (!pending || pending.battle.state !== 'in_progress') {
            await ctx.reply('You are not in an active battle!')
            return
        }
        const { battle, key } = pending
        const isChallenger = sameUser(ctx.sender, battle.challenge.challengerJid)
        const isOpponent = sameUser(ctx.sender, battle.challenge.opponentJid)
        if (!isChallenger && !isOpponent) {
            await ctx.reply('You are not part of this battle.')
            return
        }
        const challengerTurn = battle.round % 2 === 1
        if ((challengerTurn && !isChallenger) || (!challengerTurn && !isOpponent)) {
            await ctx.reply('Not your turn yet ⏳')
            return
        }
        const mine = isChallenger ? battle.challengerTeam : battle.opponentTeam
        const theirs = isChallenger ? battle.opponentTeam : battle.challengerTeam
        const myIdx = isChallenger ? battle.challengerIdx : battle.opponentIdx
        const theirIdx = isChallenger ? battle.opponentIdx : battle.challengerIdx
        const attacker = mine[myIdx]
        const defender = theirs[theirIdx]
        if (!attacker || !defender) {
            await ctx.reply('Battle state is broken, start a new one with .pbattle @user.')
            removeBattle(key)
            return
        }
        const attackerName = isChallenger ? battle.challenge.challengerName : (battle.challenge.opponentName || 'Opponent')
        const defenderName = isChallenger ? (battle.challenge.opponentName || 'Opponent') : battle.challenge.challengerName
        const moves = ['tackle', 'guard', 'dodge', ...db.pokeMoves(ctx.sender, attacker.pokeId)]
        const moveName = ctx.args.join(' ').toLowerCase()
        if (!moveName || !moves.includes(moveName)) {
            await ctx.reply(`*${attacker.name}* doesn't know *${moveName || 'that'}*. Available moves: ${[...new Set(moves)].join(', ')}`)
            return
        }
        // Defensive options, eclipse-style: guard halves the next hit, dodge
        // is a coin flip to fully avoid it. Both cost the turn.
        if (moveName === 'guard' || moveName === 'dodge') {
            battle.defense = battle.defense ?? {}
            battle.defense[isChallenger ? 'challenger' : 'opponent'] = moveName
            persist(key)
            const cF = battle.challengerTeam[battle.challengerIdx]
            const oF = battle.opponentTeam[battle.opponentIdx]
            const lines = [
                `⚔️ *Battle Round ${battle.round}*`,
                '',
                `🛡️ *${attackerName}'s ${attacker.name}* takes a defensive stance: *${moveName}*!`,
                moveName === 'guard' ? '→ next hit against it deals half damage' : '→ 50% chance to fully avoid the next hit',
                '',
                `*${battle.challenge.challengerName}* ▸ ${cF?.name}: ${hpBar(cF?.hp ?? 0, cF?.maxHP ?? 1)} ${cF?.hp ?? 0}`,
                `*${battle.challenge.opponentName}* ▸ ${oF?.name}: ${hpBar(oF?.hp ?? 0, oF?.maxHP ?? 1)} ${oF?.hp ?? 0}`,
            ]
            await ctx.reply(lines.join('\n'))
            return
        }
        const atk = statOf(attacker.poke, 'attack')
        const def = statOf(defender.poke, 'defense')
        const bonus = moveName === 'tackle' ? 1 : 1.25
        const variance = 0.85 + Math.random() * 0.3
        let damage = Math.max(3, Math.round((atk * 1.8 - def * 0.7) * variance * bonus))
        const crit = Math.random() < 0.1
        if (crit) damage *= 2
        // defender's stance resolves here
        const defSide = isChallenger ? 'opponent' : 'challenger'
        const stance = battle.defense?.[defSide]
        let note = ''
        if (stance === 'guard') {
            damage = Math.max(1, Math.floor(damage / 2))
            note = ' 🛡️ guarded: damage halved'
        } else if (stance === 'dodge') {
            if (Math.random() < 0.5) {
                note = ' 💨 dodged: no damage!'
                damage = 0
            } else {
                note = ' 💨 dodge failed'
            }
        }
        battle.defense = battle.defense ?? {}
        delete battle.defense[defSide]
        defender.hp = Math.max(0, defender.hp - damage)
        persist(key)
        const cF = battle.challengerTeam[battle.challengerIdx]
        const oF = battle.opponentTeam[battle.opponentIdx]
        const lines = [
            `⚔️ *Battle Round ${battle.round}*`,
            '',
            `*${attackerName}'s ${attacker.name}* used *${moveName}*!${crit ? ' 💥 A critical hit!' : ''}`,
            `→ ${damage} damage to *${defenderName}'s ${defender.name}*${note}`,
            '',
            `*${battle.challenge.challengerName}* ▸ ${cF?.name}: ${hpBar(cF?.hp ?? 0, cF?.maxHP ?? 1)} ${cF?.hp ?? 0}`,
            `*${battle.challenge.opponentName}* ▸ ${oF?.name}: ${hpBar(oF?.hp ?? 0, oF?.maxHP ?? 1)} ${oF?.hp ?? 0}`,
        ]
        if (defender.hp <= 0) {
            lines.push('', `💀 *${defenderName}'s ${defender.name}* fainted!`)
            const theirsAlive = theirs.some((f) => f.hp > 0)
            if (!theirsAlive) {
                const winnerName = isChallenger ? battle.challenge.challengerName : (battle.challenge.opponentName || 'Opponent')
                const winnerJid = isChallenger ? battle.challenge.challengerJid : battle.challenge.opponentJid
                const loserJid = isChallenger ? battle.challenge.opponentJid : battle.challenge.challengerJid
                if (battle.countdown) clearTimeout(battle.countdown)
                removeBattle(key)
                recordGame(winnerJid, 'pokebattle', 'win')
                recordGame(loserJid, 'pokebattle', 'loss')
                const prize = rewardGameWin(winnerJid, 'pokebattle')
                lines.push(`🏆 ${winnerName} wins the battle! (+${prize} coins)`)
                const winnerTeam = isChallenger ? battle.challengerTeam : battle.opponentTeam
                for (const f of winnerTeam) {
                    const grown = db.pokeAddXp(winnerJid, f.pokeId, BATTLE_WIN_XP)
                    const learned = await learnDue(winnerJid, f.pokeId, grown.level)
                    if (learned.length) lines.push(`🎯 *${f.name}* reached Lv ${grown.level} and learned ${learned.map(prettyMove).join(', ')}`)
                    await maybeOfferEvolution(ctx, winnerJid, f.pokeId, grown.level)
                }
                const quest = questTick(winnerJid, { kind: 'win' })
                lines.push(...quest.lines)
                await ctx.reply(lines.join('\n'))
                return
            }
            // Knockdown: the attacker earns KO xp and may be offered an evolution.
            const attackerJid = isChallenger ? battle.challenge.challengerJid : battle.challenge.opponentJid
            const before = db.pokeGet(attackerJid, attacker.pokeId)?.level ?? 1
            const grownKo = db.pokeAddXp(attackerJid, attacker.pokeId, KO_XP)
            if (grownKo.level > before) {
                const learnedKo = await learnDue(attackerJid, attacker.pokeId, grownKo.level)
                if (learnedKo.length) lines.push(`🎯 *${attacker.name}* reached Lv ${grownKo.level} and learned ${learnedKo.map(prettyMove).join(', ')}`)
                await maybeOfferEvolution(ctx, attackerJid, attacker.pokeId, grownKo.level)
            }
            if (isChallenger) battle.opponentIdx += 1
            else battle.challengerIdx += 1
            const nextUp = isChallenger ? battle.opponentTeam[battle.opponentIdx] : battle.challengerTeam[battle.challengerIdx]
            lines.push(`▸ *${defenderName}* sends out *${nextUp?.name ?? '???'}*!`)
        }
        battle.round++
        persist(key)
        lines.push('', `▸ ${challengerTurn ? (battle.challenge.opponentName || 'Opponent') : battle.challenge.challengerName} is up. Use .move <name>`)
        await ctx.reply(lines.join('\n'))
    },
})

// .pstart: open your pokemon journey (picks nothing fancy, just flips the flag)
ari({
    name: 'pstart',
    description: 'Start your pokemon journey',
    category: 'games',
    aliases: ['pokestart'],
    usage: 'pstart',
    cooldownMs: 0,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        if (db.pokeStarted(ctx.sender)) {
            await ctx.reply('Your journey is already started. Go catch something!')
            return
        }
        db.setPokeStarted(ctx.sender)
        await ctx.reply('🐾 Journey started! Wild pokemon spawn hourly. Catch them with .catch <name>, build your deck with .m2pcdeck, and battle with .pokebattle @user.')
    },
})

// .catch <name>: catch the wild pokemon spawned in this chat
ari({
    name: 'catch',
    description: 'Catch the wild pokemon spawned in this chat',
    category: 'games',
    aliases: ['pcatch', 'pokecatch'],
    usage: 'catch <name>',
    cooldownMs: 1000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        if (!ctx.isGroup) {
            await ctx.reply('Pokemon runs in groups only.')
            return
        }
        const spawn = activeSpawn(ctx.chat)
        if (!spawn) {
            await ctx.reply(`No wild pokemon right now. Wait for the next hourly spawn.`)
            return
        }
        const guess = normalizePokeName(ctx.args.join(' '))
        if (!guess) {
            await ctx.reply(`Usage: ${ctx.prefix}catch <name>`)
            return
        }
        const target = spawn.poke
        if (guess !== target.name && guess !== String(target.id)) {
            await ctx.reply('That is not the one.')
            return
        }
        if (db.pokeOne(ctx.sender, target.name)) {
            clearSpawn(ctx.chat)
            await ctx.reply(`You already caught ${titleName(target.name)}.`)
            return
        }
        // Catch roll by rarity (see CATCH_RATE). A miss keeps the spawn open so you can retry.
        if (!rollCatch(target.rarity)) {
            await ctx.reply(`💨 ${titleName(target.name)} broke free! Try again with .catch ${target.name}`)
            return
        }
        clearSpawn(ctx.chat)
        const quality = rollQuality()
        const location = db.pokeCountAt(ctx.sender, 'roster') < ROSTER_CAP ? 'roster' : 'pc'
        if (location === 'pc' && db.pokeCountAt(ctx.sender, 'pc') >= PC_CAP) {
            await ctx.reply(`Your roster (${ROSTER_CAP}) and PC (${PC_CAP}) are both full. Release one with .prelease <pc number> first.`)
            return
        }
        const inserted = db.pokeCatch(ctx.sender, target.id, target.name, target.rarity, target.power, quality, location)
        if (!inserted) {
            await ctx.reply(`You already caught ${titleName(target.name)}.`)
            return
        }
        const isStarter = db.pokeList(ctx.sender).length === 1
        let level = 1
        if (isStarter) level = db.pokeAddXp(ctx.sender, target.id, STARTER_XP).level
        let learned = await learnDue(ctx.sender, target.id, level)
        // Battle-ready at spawn: backfill up to 3 known moves from the species
        // learnset (level-ordered) when the level alone taught fewer.
        if (db.pokeMoves(ctx.sender, target.id).length < 3) {
            for (const option of await levelUpMoves(target.id)) {
                if (db.pokeMoves(ctx.sender, target.id).length >= 3) break
                if (db.pokeMoves(ctx.sender, target.id).includes(option.move)) continue
                db.pokeLearn(ctx.sender, target.id, option.move)
                learned.push(option.move)
            }
        }
        const starterLine = isStarter ? ' Your starter, level 5.' : ''
        const moveLine = learned.length ? `\n🎯 Learned: ${[...new Set(learned)].map(prettyMove).join(', ')}` : ''
        const storeLine = location === 'pc' ? `\n📦 Roster full, sent to PC.` : ''
        await ctx.reply(`Gotcha! ${titleName(target.name)} (power ${target.power}, ${rarityLabel(target.rarity)}, ${starText(quality)}) is in your pokedex.${starterLine}${moveLine}${storeLine}`)
        const quest = questTick(ctx.sender, { kind: 'catch', types: target.types ?? [] })
        for (const line of quest.lines) await ctx.reply(line)
        for (const up of quest.levelUps) await maybeOfferEvolution(ctx, ctx.sender, up.pokeId, up.after)
    },
})

// ── Evolution (anime style) ─────────────────────────────────────────────────
// Offer fires when the level reaches the pokeapi min_level of the next stage.
// Branches: first branch in evolution_chain is used (deterministic, no pick).
const maybeOfferEvolution = async (ctx: any, jid: string, pokeId: number, level: number): Promise<void> => {
    if (hasEvoOffer(ctx.chat, jid)) return
    const next = await fetchEvolution(pokeId)
    if (!next || next.minLevel === null || level < next.minLevel) return
    const row = db.pokeGet(jid, pokeId)
    if (!row) return
    openEvoOffer(
        { jid, chat: ctx.chat, pokeId, name: row.name, toId: next.id, toName: next.name },
        () => {
            void ctx.sock.sendMessage(ctx.chat, { text: `${who || jidToNumber(jid)} ⏳ ${titleName(row.name)} didn't evolve. Offer cancelled, it can ask again at the next level-up.` }).catch(() => undefined)
        },
    )
    const who = await targetName(ctx, jid).catch(() => '')
    await ctx.reply(
        `${who || jidToNumber(jid)} ✨ ${titleName(row.name)} is ready to evolve into *${titleName(next.name)}*!\nReply *evolve* to confirm or *cancel* to keep it. You have 30 seconds.`,
    )
}

/** Plain-word answer to an evolution offer: 'evolve' or 'cancel' (no dot needed). */
export async function runEvolveReply(ctx: any, action: 'evolve' | 'evocancel'): Promise<void> {
    const offer = takeEvoOffer(ctx.chat, ctx.sender)
    if (!offer) return
    if (action === 'evocancel') {
        await ctx.reply(`Okay, ${titleName(offer.name)} stays as it is. It can ask again at the next level-up.`)
        return
    }
    const to = await fetchPokemon(offer.toId)
    const ok = db.pokeEvolve(ctx.sender, offer.pokeId, { id: offer.toId, name: offer.toName, power: to?.power ?? 0 })
    if (!ok) {
        await ctx.reply(`You already own ${titleName(offer.toName)}, so ${titleName(offer.name)} can't evolve into it.`)
        return
    }
    const row = db.pokeGet(ctx.sender, offer.toId)
    const level = row?.level ?? 1
    const learned = await learnDue(ctx.sender, offer.toId, level)
    const moveLine = learned.length ? `\n🎯 Learned: ${learned.map(prettyMove).join(', ')}` : ''
    await ctx.reply(`🌟 ${titleName(offer.name)} evolved into *${titleName(offer.toName)}*! Still Lv ${level}.${moveLine}`)
}

// .pinfo <pcoll number>: full detail on one of your pokemon, moves included
ari({
    name: 'pinfo',
    description: 'Inspect one of your pokemon: power, base stats and learned moves',
    category: 'games',
    aliases: ['pokeinfo'],
    usage: 'pinfo <pcoll number>',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return

        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const pokeList = db.pokeList(ctx.sender)
        if (!pokeList.length) {
            await ctx.reply('You have no pokemon yet. Use .pspawn to catch some!')
            return
        }
        const query = ctx.args.join(' ').trim().toLowerCase()
        let row = /^\d+$/.test(query) ? pokeList[parseInt(query) - 1] : undefined
        if (!row && query) {
            row = pokeList.find((r) => r.name.toLowerCase().includes(query))
        }
        if (!row) {
            await ctx.reply('Usage: .pinfo <pcoll number or name>. Check .pcoll first.')
            return
        }
        const poke = await fetchPokemon(row.poke_id)
        const statLine = poke?.stats?.map((s: any) => `${String(s.name).replace('special-', 'Sp').replace('-', '')} ${s.base}`).join(' · ') ?? ''
        const learned = db.pokeMoves(ctx.sender, row.poke_id)
        const deckNote = db.pcOf(ctx.sender).some((r) => r.poke_id === row.poke_id) ? '\n\n⚔️ In your battle deck' : ''
        const lines = [
            `⚡ *${row.name}* (#${row.poke_id})`,
            `💪 Power: ${row.power} · Lv ${row.level ?? 1} · XP ${row.xp ?? 0}`,
            `🌟 Quality: ${starText(row.quality ?? 0)} · ${(row.location ?? 'roster') === 'pc' ? '📦 PC' : '🎒 roster'}`,
            poke?.stats?.length ? `📊 ${statLine}` : '',
            '',
            `🎯 Moves: ${learned.length ? learned.map((m: any) => (typeof m === "string" ? m : m.move)).map(prettyMove).join(', ') : 'just tackle (default)'}`,
            deckNote,
        ]
        await ctx.reply(lines.filter(Boolean).join('\n'))
    },
})

// ── .suspend: owner kill-switch per command ─────────────────────────────────
// .suspend <command>          suspend it for everyone
// .suspend <command> -r       lift the suspension
// .suspend                    list suspended commands

ari({
    name: 'plearn',
    description: 'Teach a move from the species learnset (500 ryo, level-gated)',
    category: 'games',
    usage: 'plearn <pokemon> <move>',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (ctx.isGroup && !db.gameActive(ctx.chat) && !db.casinoEnabled(ctx.chat)) return
        const pokeList = db.pokeList(ctx.sender)
        if (!pokeList.length) {
            await ctx.reply('You have no pokemon yet. Catch some first!')
            return
        }
        const parts = ctx.args.join(' ').trim().toLowerCase().split(/\s+/)
        if (!parts.length || !parts[0]) {
            await ctx.reply('Usage: .plearn <pokemon name or number> <move>\n.dex-style list: .pmoves <pokemon>')
            return
        }
        let row = /^\d+$/.test(parts[0]) ? pokeList[parseInt(parts[0]!) - 1] : undefined
        if (!row) row = pokeList.find((r) => r.name.toLowerCase().startsWith(parts[0]!))
        if (!row) {
            await ctx.reply('No pokemon called *' + parts[0] + '* in ur roster. Check .pcoll.')
            return
        }
        const move = parts.slice(1).join('-').replace(/[^a-z-]/g, '')
        if (!move) {
            // show learnable moves for this pokemon
            const options = await levelUpMoves(row.poke_id)
            const known = db.pokeMoves(ctx.sender, row.poke_id).map((m: string) => m)
            const level = row.level ?? 1
            const lines = ['🎯 *' + row.name + '* learnset (Lv ' + level + ')', '']
            for (const option of options) {
                const mark = known.includes(option.move) ? '✅ known' : option.at <= level ? '🟢 can learn now' : '🔒 Lv ' + option.at
                lines.push('*' + prettyMove(option.move) + '* — ' + mark)
            }
            await ctx.reply(lines.join('\n'))
            return
        }
        const options = await levelUpMoves(row.poke_id)
        const option = options.find((o) => o.move === move)
        if (!option) {
            await ctx.reply("🛑 *" + row.name + "* can never learn *" + move + "*. Check .plearn " + parts[0] + " for the learnset.")
            return
        }
        const level = row.level ?? 1
        const known = db.pokeMoves(ctx.sender, row.poke_id)
        if (known.includes(move)) {
            await ctx.reply('🛑 *' + row.name + '* already knows *' + prettyMove(move) + '*.')
            return
        }
        if (option.at > level) {
            await ctx.reply('🔒 *' + row.name + '* learns *' + prettyMove(move) + '* at Lv ' + option.at + ' (now Lv ' + level + ').')
            return
        }
        const FEE = 500
        if (!db.spendCoins(ctx.sender, FEE)) {
            await ctx.reply('🛑 teaching costs *' + money(FEE) + '* ryo. Ur wallet: ' + money(balanceOf(ctx.sender)) + '.')
            return
        }
        let forgot = ''
        if (known.length >= MAX_MOVES) {
            db.pokeForget(ctx.sender, row.poke_id, known[0]!)
            forgot = ' (forgot *' + prettyMove(known[0]!) + '*)'
        }
        db.pokeLearn(ctx.sender, row.poke_id, move)
        await ctx.reply('🎯 *' + row.name + '* learned *' + prettyMove(move) + '*' + forgot + ' · 💰 -' + money(FEE))
    },
})

ari({
    name: 'suspend',
    description: 'Suspend a command for everyone (owner only). -r lifts it',
    category: 'owner',
    usage: 'suspend <command> | suspend <command> -r | suspend',
    cooldownMs: 0,
    run: async (ctx) => {
        const senderNumber = jidToNumber(ctx.sender)
        if (!config.owners.includes(senderNumber)) {
            await ctx.reply('Owner only.')
            return
        }
        const query = ctx.args.filter((a: string) => a !== '-r').join(' ').trim().toLowerCase()
        const resume = ctx.args.includes('-r')

        if (!query) {
            const list = db.suspendedList()
            await ctx.reply(list.length ? '⛔ Suspended: ' + list.join(', ') : 'Nothing is suspended.')
            return
        }

        const target = findCommand(query)
        if (!target) {
            await ctx.reply(`No command called *${query}*.`)
            return
        }

        if (resume) {
            db.suspendedClear(target.name)
            await ctx.reply(`✅ *${ctx.prefix}${target.name}* is live again.`)
            return
        }

        if (target.name === 'suspend') {
            await ctx.reply('You cannot suspend .suspend.')
            return
        }
        db.suspendedSet(target.name)
        await ctx.reply(`⛔ *${ctx.prefix}${target.name}* is suspended for everyone until u lift it (${ctx.prefix}suspend ${target.name} -r).`)
    },
})

/**
 * Bare battle replies: the challenged player types accept / decline / reject
 * (no prefix, no quote needed) and the pipeline runs it directly.
 */
export function bareBattleReply(sender: string, body: string): 'accept' | 'decline' | null {
    const word = body.trim().toLowerCase()
    if (!['accept', 'decline', 'reject'].includes(word)) return null
    const pending = getPendingBattle(sender)
    if (!pending) return null
    if (pending.battle.state !== 'pending') return null
    if (!sameUser(sender, pending.battle.challenge.opponentJid)) return null
    return word === 'reject' ? ('decline' as const) : ('accept' as const)
}

export async function runAccept(ctx: any): Promise<void> {
    const pending = getPendingBattle(ctx.sender)
    if (!pending) {
        await ctx.reply('You have no pending battle challenges!')
        return
    }
    const { battle, key } = pending
    if (battle.state !== 'pending') {
        await ctx.reply('This challenge is no longer valid.')
        removeBattle(key)
        return
    }
    if (!sameUser(ctx.sender, battle.challenge.opponentJid)) {
        await ctx.reply('Only the challenged player can accept.')
        return
    }

    const myTeam = await buildTeam(battle.challenge.challengerJid)
    const theirTeam = await buildTeam(battle.challenge.opponentJid)
    if (!myTeam || !theirTeam) {
        await ctx.reply('One of you has no pokemon yet. Catch some first!')
        removeBattle(key)
        return
    }
    battle.challengerTeam = myTeam
    battle.opponentTeam = theirTeam
    battle.challengerIdx = 0
    battle.opponentIdx = 0
    battle.state = 'accepted'
    battle.round = 1
    persist(key)

    const roster = (team: Fighter[]) => team.map((f) => f.name).join(', ')
    await ctx.reply([
        '⚔️ *Battle Accepted!* Teams locked in:',
        '',
        `${battle.challenge.challengerName}: ${roster(myTeam)}`,
        `${battle.challenge.opponentName}: ${roster(theirTeam)}`,
        '',
        'Battle starts in 15 seconds. Quick! Change your team with .pswap (re-roll) or .pswap <numbers> (pick, e.g. .pswap 2 5 1).',
    ].join('\n'))

    const sock = ctx.sock
    const chat = ctx.chat
    const say = (text: string, mentions: string[] = []) => sock.sendMessage(chat, mentions.length ? { text, mentions } : { text }).catch(() => undefined)
    setTimeout(() => {
        const current = battles.get(key)
        if (current?.state === 'accepted') void say('⏳ 10 seconds...')
    }, 5_000)
    setTimeout(() => {
        const current = battles.get(key)
        if (current?.state === 'accepted') void say('⏳ 5 seconds...')
    }, 10_000)
    const timer = setTimeout(() => {
        const current = battles.get(key)
        if (!current || current.state !== 'accepted') return
        current.state = 'in_progress'
        persist(key)
        void say([
            '⚔️ *Battle Round 1* — fight!',
            '',
            `${current.challenge.challengerName} sends out *${current.challengerTeam[0]?.name}*!`,
            `${current.challenge.opponentName} sends out *${current.opponentTeam[0]?.name}*!`,
            '',
            `▸ ${current.challenge.challengerName} is up. Use .move <name>`,
        ].join('\n'))
    }, 15_000)
    battle.countdown = timer
}

// .pbattle end: cancel the group's active battle or pending challenge with no
// winner, no coins and no xp. Only the two battlers or owner/sudo may end it.
export async function runEndBattle(ctx: any): Promise<void> {
    const battleKey = `battle:${ctx.chat}`
    const battle = ctx.isGroup ? battles.get(battleKey) : undefined
    if (!battle) {
        await ctx.reply('🛑 no battle running here')
        return
    }
    const { challengerJid, opponentJid, challengerName, opponentName } = battle.challenge
    const isBattler = sameUser(ctx.sender, challengerJid) || sameUser(ctx.sender, opponentJid)
    if (!isBattler && !ctx.isOwner && !ctx.isSudo) {
        await ctx.reply('🛑 only the two battlers can end this')
        return
    }
    const wasPending = battle.state === 'pending'
    removeBattle(battleKey)
    const header = wasPending ? '🛑 *challenge cancelled*' : '🛑 *battle ended*'
    const tail = wasPending ? '' : 'no winner, no coins or xp.'
    const lines = [
        `${header} by ${ctx.senderName}`,
        `▸ ${challengerName} vs ${opponentName || 'Opponent'}`,
    ]
    if (tail) lines.push(tail)
    await ctx.reply(lines.join('\n'))
}

export async function runDecline(ctx: any): Promise<void> {
    const pending = getPendingBattle(ctx.sender)
    if (!pending) {
        await ctx.reply('You have no pending battle challenges!')
        return
    }
    const { battle, key } = pending
    if (!sameUser(ctx.sender, battle.challenge.opponentJid)) {
        await ctx.reply('Only the challenged player can decline.')
        return
    }
    if (battle.countdown) clearTimeout(battle.countdown)
    removeBattle(key)
    await ctx.reply(`${ctx.senderName} declined the battle challenge from ${battle.challenge.challengerName}.`)
}

// ── PC storage, release, daily quest (added by poke upgrade) ────────────────
// .pcrelease <roster number>: move a roster pokemon to the PC (PC cap 500).
ari({
    name: 'pcrelease',
    description: 'Move one of your roster pokemon to the PC',
    category: 'games',
    usage: 'pcrelease <pcoll number>',
    cooldownMs: 3000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const roster = db.pokeList(ctx.sender).filter((r) => (r.location ?? 'roster') === 'roster')
        const n = parseInt(ctx.args[0] ?? '', 10)
        const row = Number.isFinite(n) ? roster[n - 1] : undefined
        if (!row) {
            await ctx.reply(`Usage: .pcrelease <number from .pcoll>. ${roster.length} on your roster.`)
            return
        }
        if (db.pokeCountAt(ctx.sender, 'pc') >= PC_CAP) {
            await ctx.reply(`📦 Your PC is full (${PC_CAP}). Release something with .prelease first.`)
            return
        }
        db.pokeSetLocation(ctx.sender, row.poke_id, 'pc')
        await ctx.reply(`📦 ${row.name} moved to the PC. Use .pcoll to see the roster.`)
    },
})

// .prelease <pc number>: first call asks, .prelease yes within 60s releases for Ryo.
ari({
    name: 'prelease',
    description: 'Release a PC pokemon for Ryo (asks to confirm first)',
    category: 'games',
    usage: 'prelease <pc number> | prelease yes',
    cooldownMs: 2000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        if (!db.pokeStarted(ctx.sender)) {
            await ctx.reply('🐾 Your pokemon journey has not started yet. Use .pstart first!')
            return
        }
        const arg = (ctx.args[0] ?? '').toLowerCase()
        if (arg === 'yes' || arg === 'confirm') {
            const pending = takeReleasePending(ctx.sender)
            if (!pending) {
                await ctx.reply('🛑 Nothing to confirm. Start with .prelease <pc number>.')
                return
            }
            if (!db.pokeRelease(ctx.sender, pending.pokeId)) {
                await ctx.reply('🛑 That pokemon is already gone.')
                return
            }
            db.addCoins(ctx.sender, pending.value)
            await ctx.reply(`👋 ${pending.name} released. +${pending.value} Ryo 💰`)
            return
        }
        const pc = db.pokeList(ctx.sender).filter((r) => r.location === 'pc')
        const n = parseInt(arg, 10)
        const row = Number.isFinite(n) ? pc[n - 1] : undefined
        if (!row) {
            await ctx.reply(`Usage: .prelease <pc number>. ${pc.length} in your PC. Only PC pokemon can be released.`)
            return
        }
        const value = releaseValue(row.rarity, row.quality ?? 0)
        setReleasePending(ctx.sender, row.poke_id, row.name, value)
        await ctx.reply(`⚠️ Release ${row.name} for ${value} Ryo? This is permanent. Send .prelease yes within 60s to confirm.`)
    },
})

// .quest: today's daily quest and this week's featured type (.pquest kept as alias)
ari({
    name: 'quest',
    aliases: ['pquest'],
    description: "Today's daily quest and the weekly featured type",
    category: 'games',
    usage: 'quest',
    cooldownMs: 2000,
    run: async (ctx) => {
        if (await pokeGuard(ctx)) return
        const day = dayIndex()
        const done = db.questGet(ctx.sender, day).done
        await ctx.reply(`📜 Today: ${questTitle(day)}\nStatus: ${done ? 'done ✅' : 'open'}\n🏷️ Featured type this week: ${featuredType(day)}`)
    },
})

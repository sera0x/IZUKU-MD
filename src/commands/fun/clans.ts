import { ari } from '../../bot/registry.js'
import { jidToNumber } from '../../bot/helpers.js'
import { sameUser } from '../../bot/identity.js'
import { normalizeTarget, resolveTarget, targetName } from '../../bot/group-utils.js'
import { db, type ClanRow } from '../../db/index.js'
import { balanceOf, money } from '../../features/economy.js'
import { progressFor } from '../../features/xp.js'
import { renderClanCard } from '../../features/clan-card.js'

const MAX_MEMBERS = 30
/** Leaving or being kicked locks you out of joining another clan for a day. */
const CLAN_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Creation gate: a clan is a flex, so it costs level and a full wallet. */
const MIN_LEVEL = 5
const MIN_BALANCE = 5_000
const CREATE_FEE = 2_500

const ROLE_ICON: Record<string, string> = { leader: '👑', officer: '⭐', member: '▸' }
const roleIcon = (role: string): string => ROLE_ICON[role] ?? '▸'

const formatClanWait = (ms: number): string => {
    const hours = Math.max(1, Math.ceil(ms / 3_600_000))
    return hours >= 24 ? '24h' : `${hours}h`
}

const tagFor = (name: string): string =>
    (name.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'CLAN').toUpperCase()

const nameOf = (jid: string): string => db.user(jid).name || jidToNumber(jid) || 'unknown'

function clanCard(clan: ClanRow, _prefix: string): string {
    const members = db.clanMembers(clan.id)
    const leaders = members.filter((member) => member.role === 'leader')
    const officers = members.filter((member) => member.role === 'officer')
    const lines = [
        `🛡️ *[${clan.tag}] ${clan.name}*`,
        '',
        `👑 *Leader*  : ${leaders.map((member) => nameOf(member.user_jid)).join(', ') || 'unknown'}`,
        `⭐ *Officers*: ${officers.length ? officers.map((member) => nameOf(member.user_jid)).join(', ') : 'none'}`,
        `👥 *Members* : ${members.length}/${MAX_MEMBERS}`,
    ]
    return lines.join('\n')
}

ari({
    name: 'cclan',
    description: 'Create a clan (needs level ownership standard)',
    category: 'fun',
    aliases: ['createclan', 'newclan'],
    usage: 'cclan <name>',
    cooldownMs: 0,
    run: async (ctx) => {
        const name = ctx.args.join(' ').trim()
        if (!name) {
            await ctx.reply(
                [
                    '*Create a clan*',
                    `▸ *${ctx.prefix}cclan Midnight*`,
                    '',
                    `▸ Needs *level ${MIN_LEVEL}* and *${money(MIN_BALANCE)}* in your wallet`,
                    `▸ Costs *${money(CREATE_FEE)}* (owner pays nothing)`,
                    `▸ Max *${MAX_MEMBERS}* members per clan`,
                ].join('\n'),
            )
            return
        }
        if (name.length < 3 || name.length > 20) {
            await ctx.reply('Clan names run *3-20* characters. 🛑')
            return
        }
        if (!/^[a-z0-9 _-]+$/i.test(name)) {
            await ctx.reply('Letters, numbers, spaces, `_` and `-` only. 🛑')
            return
        }

        if (!ctx.isOwner && db.clanCooldownUntil(ctx.sender) > Date.now()) {
            await ctx.reply(
                `You are on clan cooldown — back in *${formatClanWait(db.clanCooldownUntil(ctx.sender) - Date.now())}*. ⏳`,
            )
            return
        }

        const existing = db.clanOf(ctx.sender)
        if (existing) {
            const clan = db.clanById(existing.clan_id)
            await ctx.reply(`You are already in *${clan ? clan.name : 'a clan'}*. Leave it first. 🛑`)
            return
        }
        if (db.clanByName(name)) {
            await ctx.reply(`A clan called *${name}* already exists. 🛑`)
            return
        }

        if (!ctx.isOwner) {
            const level = progressFor(db.xp(ctx.chat, ctx.sender).xp).level
            if (level < MIN_LEVEL) {
                await ctx.reply(
                    `Clans need *level ${MIN_LEVEL}*. You are level *${level}* — keep chatting and winning. 🛑`,
                )
                return
            }
            if (balanceOf(ctx.sender) < MIN_BALANCE) {
                await ctx.reply(
                    `Clans need *${money(MIN_BALANCE)}* in your wallet. You have *${money(balanceOf(ctx.sender))}*. 🛑`,
                )
                return
            }
            if (!db.spendCoins(ctx.sender, CREATE_FEE)) {
                await ctx.reply(`Could not charge the *${money(CREATE_FEE)}* clan fee. 🛑`)
                return
            }
        }

        const tag = tagFor(name)
        let clan: ClanRow
        try {
            clan = db.clanCreate(name, tag, ctx.sender)
        } catch (error) {
            if (!ctx.isOwner) db.addCoins(ctx.sender, CREATE_FEE)
            await ctx.reply(`Could not create the clan: ${error instanceof Error ? error.message : 'unknown'} 🛑`)
            return
        }

        await ctx.reply(
            [
                `🛡️ *Clan created*`,
                '',
                `🏷️ *Name* : ${clan.name}`,
                `🔖 *Tag*  : [${clan.tag}]`,
                `👑 *You are the leader*`,
                `👥 *Members* : 1/${MAX_MEMBERS}`,
            ].join('\n'),
        )
    },
})

ari({
    name: 'clans',
    description: 'List clans or inspect one',
    category: 'fun',
    aliases: ['clanlist', 'allclans'],
    usage: 'clans [name]',
    cooldownMs: 1000,
    run: async (ctx) => {
        const query = ctx.args.join(' ').trim()

        if (query) {
            const clan = db.clanByName(query)
            if (!clan) {
                await ctx.reply(`No clan called *${query}*. 🛑`)
                return
            }
            const members = db.clanMembers(clan.id)
            const roster = members
                .slice(0, MAX_MEMBERS)
                .map((member) => `${roleIcon(member.role)} *${nameOf(member.user_jid)}* — _${member.role}_`)
            const bioLine = clan.bio ? `🌿 _${clan.bio}_` : '🌿 *ʀᴏꜱᴛᴇʀ*'
            const caption = [clanCard(clan, ctx.prefix), '', bioLine, ...roster].join('\n')
            try {
                const clanMembers = db.clanMembers(clan.id)
                const named = clanMembers.map((member) => ({
                    name: nameOf(member.user_jid),
                    role: member.role,
                }))
                const created = new Date(clan.created_at).toISOString().slice(0, 10)
                const image = await renderClanCard({
                    tag: clan.tag,
                    name: clan.name,
                    leader: named.find((member) => member.role === 'leader')?.name ?? 'unknown',
                    officers: named.filter((member) => member.role === 'officer').map((member) => member.name),
                    memberCount: clanMembers.length,
                    maxMembers: MAX_MEMBERS,
                    created,
                    topMembers: named.filter((member) => member.role !== 'member').slice(0, 2),
                    bio: clan.bio ?? null,
                })
                await ctx.sock.sendMessage(ctx.chat, { image, caption }, { quoted: ctx.msg })
            } catch {
                await ctx.reply(caption)
            }
            return
        }

        const clans = db.clanList()
        if (!clans.length) {
            await ctx.reply(`No clans yet. Start one with *${ctx.prefix}cclan <name>* 🛡️`)
            return
        }

        const lines = clans
            .slice(0, 20)
            .map(
                (clan, index) =>
                    `*${index + 1}.* [${clan.tag}] *${clan.name}* — ${clan.members}/${MAX_MEMBERS} members`,
            )
        await ctx.reply(
            [
                '🛡️ *CLANS*',
                '',
                ...lines,
            ].join('\n'),
        )
    },
})

ari({
    name: 'cjoin',
    description: 'Join a clan',
    category: 'fun',
    aliases: ['joinclan'],
    usage: 'cjoin <name>',
    cooldownMs: 0,
    run: async (ctx) => {
        const query = ctx.args.join(' ').trim()
        if (!query) {
            await ctx.reply(`Usage: *${ctx.prefix}cjoin <clan name>* 🛑 (see ${ctx.prefix}clans)`)
            return
        }

        const clan = db.clanByName(query)
        if (!clan) {
            await ctx.reply(`No clan called *${query}*. 🛑`)
            return
        }
        if (!ctx.isOwner && db.clanCooldownUntil(ctx.sender) > Date.now()) {
            await ctx.reply(
                `You are on clan cooldown — back in *${formatClanWait(db.clanCooldownUntil(ctx.sender) - Date.now())}*. ⏳`,
            )
            return
        }

        const current = db.clanOf(ctx.sender)
        if (current?.clan_id === clan.id) {
            await ctx.reply(`You are already in *${clan.name}*. 🛑`)
            return
        }
        if (current) {
            const old = db.clanById(current.clan_id)
            await ctx.reply(`Leave *${old ? old.name : 'your clan'}* first with *${ctx.prefix}cleave*. 🛑`)
            return
        }
        if (db.clanMemberCount(clan.id) >= MAX_MEMBERS) {
            await ctx.reply(`*${clan.name}* is full — ${MAX_MEMBERS}/${MAX_MEMBERS}. 🛑`)
            return
        }

        db.clanAdd(ctx.sender, clan.id, 'member')
        const count = db.clanMemberCount(clan.id)
        await ctx.reply(
            [`🛡️ You joined *[${clan.tag}] ${clan.name}*`, `👥 Members: *${count}/${MAX_MEMBERS}*`].join('\n'),
        )
    },
})

ari({
    name: 'cleave',
    description: 'Leave your clan',
    category: 'fun',
    aliases: ['lclan', 'leaveclan'],
    usage: 'cleave',
    cooldownMs: 0,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        if (!membership) {
            await ctx.reply(`You are not in a clan. 🛑 (see ${ctx.prefix}clans)`)
            return
        }
        const clan = db.clanById(membership.clan_id)
        if (!clan) {
            db.clanRemove(ctx.sender)
            await ctx.reply('Your clan no longer exists. You are free. 🛑')
            return
        }
        if (membership.role === 'leader') {
            const others = db.clanMembers(clan.id).filter((member) => member.user_jid !== ctx.sender)
            if (others.length) {
                await ctx.reply(
                    `You lead *${clan.name}*. Promote someone with *${ctx.prefix}cpromote @user* first, or *${ctx.prefix}cdisband*. 🛑`,
                )
                return
            }
            db.clanDelete(clan.id)
            await ctx.reply(`You were the last member, so *${clan.name}* is gone. 🗑️`)
            return
        }

        db.clanRemove(ctx.sender)
        db.setClanCooldown(ctx.sender, Date.now() + CLAN_COOLDOWN_MS)
        await ctx.reply(
            [
                `You left *${clan.name}*. 👋`,
                `⏳ You can join or create another clan in *24h*.`,
            ].join('\n'),
        )
    },
})

ari({
    name: 'ckick',
    description: 'Remove a member from your clan (leader/officer)',
    category: 'fun',
    aliases: ['clankick'],
    usage: 'ckick @user',
    cooldownMs: 0,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        const clan = membership ? db.clanById(membership.clan_id) : undefined
        if (!membership || !clan) {
            await ctx.reply('You are not in a clan. 🛑')
            return
        }
        if (membership.role === 'member') {
            await ctx.reply('Only the leader and officers can kick. 🛑')
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(`Usage: *${ctx.prefix}ckick @user* 🛑`)
            return
        }
        const target = await normalizeTarget(ctx, raw)
        if (sameUser(target, ctx.sender)) {
            await ctx.reply(`Use *${ctx.prefix}cleave* to leave your own clan. 🛑`)
            return
        }

        const victim = db.clanOf(target)
        if (!victim || victim.clan_id !== clan.id) {
            await ctx.reply('That user is not in your clan. 🛑')
            return
        }
        if (victim.role === 'leader' || (victim.role === 'officer' && membership.role !== 'leader')) {
            await ctx.reply('You cannot kick someone at or above your rank. 🛑')
            return
        }

        db.clanRemove(target)
        db.setClanCooldown(target, Date.now() + CLAN_COOLDOWN_MS)
        const name = (await targetName(ctx, target).catch(() => '')) || jidToNumber(target)
        await ctx.reply(`👟 Kicked *${name}* from *${clan.name}*.`)
    },
})

ari({
    name: 'cpromote',
    description: 'Make a clan member an officer (leader only)',
    category: 'fun',
    aliases: ['clanpromote'],
    usage: 'cpromote @user',
    cooldownMs: 0,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        const clan = membership ? db.clanById(membership.clan_id) : undefined
        if (!membership || !clan) {
            await ctx.reply('You are not in a clan. 🛑')
            return
        }
        if (membership.role !== 'leader') {
            await ctx.reply('Only the clan leader can promote. 🛑')
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(`Usage: *${ctx.prefix}cpromote @user* 🛑`)
            return
        }
        const target = await normalizeTarget(ctx, raw)
        const member = db.clanOf(target)
        if (!member || member.clan_id !== clan.id) {
            await ctx.reply('That user is not in your clan. 🛑')
            return
        }
        if (member.role === 'leader') {
            await ctx.reply('You are already the leader. 🛑')
            return
        }

        db.clanSetRole(target, 'officer')
        const name = (await targetName(ctx, target).catch(() => '')) || jidToNumber(target)
        await ctx.reply(`⭐ *${name}* is now an officer of *${clan.name}*.`)
    },
})

ari({
    name: 'cdemote',
    description: 'Demote a clan officer back to member (leader only)',
    category: 'fun',
    aliases: ['clandemote'],
    usage: 'cdemote @user',
    cooldownMs: 0,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        const clan = membership ? db.clanById(membership.clan_id) : undefined
        if (!membership || !clan) {
            await ctx.reply('You are not in a clan. 🛑')
            return
        }
        if (membership.role !== 'leader') {
            await ctx.reply('Only the clan leader can demote. 🛑')
            return
        }

        const raw = resolveTarget(ctx)
        if (!raw) {
            await ctx.reply(`Usage: *${ctx.prefix}cdemote @user* 🛑`)
            return
        }
        const target = await normalizeTarget(ctx, raw)
        const member = db.clanOf(target)
        if (!member || member.clan_id !== clan.id) {
            await ctx.reply('That user is not in your clan. 🛑')
            return
        }
        if (member.role === 'leader') {
            await ctx.reply('The leader cannot be demoted. 🛑')
            return
        }

        db.clanSetRole(target, 'member')
        const name = (await targetName(ctx, target).catch(() => '')) || jidToNumber(target)
        await ctx.reply(`▸ *${name}* is back to member in *${clan.name}*.`)
    },
})

ari({
    name: 'cdisband',
    description: 'Delete your clan (leader only)',
    category: 'fun',
    aliases: ['clandelete'],
    usage: 'cdisband',
    cooldownMs: 0,
    run: async (ctx) => {
        const membership = db.clanOf(ctx.sender)
        const clan = membership ? db.clanById(membership.clan_id) : undefined
        if (!membership || !clan) {
            await ctx.reply('You are not in a clan. 🛑')
            return
        }
        if (membership.role !== 'leader') {
            await ctx.reply('Only the clan leader can disband it. 🛑')
            return
        }
        if (ctx.args[0]?.toLowerCase() !== 'yes') {
            await ctx.reply(
                `This deletes *${clan.name}* and removes every member. Type *${ctx.prefix}cdisband yes* to confirm. ⚠️`,
            )
            return
        }
        db.clanDelete(clan.id)
        await ctx.reply(`🗑️ *${clan.name}* is disbanded.`)
    },
})

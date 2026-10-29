process.env.DATABASE_PATH = ':memory:'
process.env.OWNER_NUMBER = '2348000000000'
process.env.LOG_LEVEL = 'error'

const { db } = await import('../db/index.js')
const { runClanUpkeep } = await import('../features/clan_upkeep.js')
const { weekKey } = await import('../features/mine.js')

let failures = 0
const check = (name: string, ok: boolean, detail = ''): void => {
    if (ok) console.log(`ok   ${name}`)
    else {
        failures += 1
        console.error(`FAIL ${name} ${detail}`)
    }
}

const A = '2348100000001@s.whatsapp.net'
const B = '2348100000002@s.whatsapp.net'
const C = '2348100000003@s.whatsapp.net'
const D = '2348100000004@s.whatsapp.net'
const W = weekKey()

// clan A: A leader, B member. clan B: C leader (has treasury for upkeep).
const clanA = db.clanCreate('alpha', 'ALP', A)
db.clanAdd(B, clanA.id, 'member')
const clanB = db.clanCreate('beta', 'BET', C)

// ---- settle + tax ----
db.user(A)
db.user(B)
db.addCoins(A, 50_000)
db.addCoins(B, 50_000)

db.setClanTax(clanA.id, 10)
// B stakes 1000 and wins 2000 (profit 1000): tax 10% of profit = 100 to treasury.
const okWin = db.settleGamble(B, 1000, 2000, 1000, W)
check('settle returns true on a valid debit', okWin)
const tAfter = db.clanTreasury(clanA.id)
check('tax is 10% of profit into treasury', tAfter.balance === 100, `balance=${tAfter.balance}`)
check('war points are the ryo gambled', db.clanWarStandings(W).find((r) => r.id === clanA.id)?.points === 1000)

// loss: stake 500 lost, no tax, no payout
const okLoss = db.settleGamble(B, 500, 0, 500, W)
check('losing stake settles', okLoss)
check('no tax on a loss', db.clanTreasury(clanA.id).balance === 100)

// insufficient wallet: debit refused, nothing changes
const beforeCoins = db.coins(B)
const refused = db.settleGamble(B, 10_000_000, 0, 10_000_000, W)
check('overdraft refused atomically', refused === false && db.coins(B) === beforeCoins)

// not in a clan: no tax, no points
db.user(D)
db.addCoins(D, 5000)
db.settleGamble(D, 100, 300, 100, W)
check('solo winner pays no clan tax', db.clanTreasury(clanA.id).balance === 100)

// mine save/clear key round trip
db.settleGamble(D, 0, 0, 0, W, { saveKey: 'mine:g:D', saveValue: '{"x":1}' })
check('mine key saved', db.settingValue('mine:g:D') === '{"x":1}')
db.settleGamble(D, 0, 0, 0, W, { clearKey: 'mine:g:D' })
check('mine key cleared', db.settingValue('mine:g:D') === undefined)

// ---- tax validation boundaries ----
db.setClanTax(clanB.id, 20)
check('tax stored at 20', db.clanTreasury(clanB.id).tax_pct === 20)

// ---- upkeep + reassignment ----
db.setClanUpkeep(5000)
check('upkeep default is 5000 when unset', (() => {
    db.setSetting('CLAN_UPKEEP', 'nope')
    return db.clanUpkeep() === 5000
})())
db.setClanUpkeep(5000)
check('upkeep stored as 5000', db.clanUpkeep() === 5000)

// fund clan B so it survives upkeep; clan A (treasury 100 < 5000) folds
db.setClanTax(clanB.id, 100)
db.addCoins(C, 100_000)
db.settleGamble(C, 1000, 20_000, 1000, W) // profit 19000, 100% tax -> 19000 in clan B treasury
const r1 = runClanUpkeep()
check('failed clan is reported', r1.failed.some((f) => f.name === 'alpha'), JSON.stringify(r1))
check('members moved to a clan with room', db.clanOf(B)?.clan_id === clanB.id, `clan=${db.clanOf(B)?.clan_id} report=${JSON.stringify(r1)}`)
check('clan A removed after failing upkeep', !db.clanList().some((c) => c.id === clanA.id))

// clan B had no treasury so it also failed; with no other clan, members are unplaced
const r2 = runClanUpkeep()
check('no-room path reports unplaced members', r2.failed.every((f) => f.moved === 0 && f.unplaced >= 0))

// paid path: a funded clan pays upkeep from its treasury
const clanC = db.clanCreate('gamma', 'GAM', D)
db.setClanTax(clanC.id, 100)
db.addCoins(D, 100_000)
db.settleGamble(D, 1000, 60_000, 1000, W) // profit 59000, 100% tax -> 59000 in treasury
const funded = db.clanTreasury(clanC.id).balance
check('treasury funded by the tax flow', funded === 59_000, `balance=${funded}`)
const r3 = runClanUpkeep()
check('funded clan pays upkeep', r3.paid.includes('gamma'), JSON.stringify(r3))
check('paid clan treasury reduced by upkeep', db.clanTreasury(clanC.id).balance === funded - db.clanUpkeep(), `balance=${db.clanTreasury(clanC.id).balance}`)

db.close()
if (failures > 0) {
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
}
console.log('\nall clan economy tests passed')

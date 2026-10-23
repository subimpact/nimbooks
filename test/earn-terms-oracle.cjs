// Staking-terms oracle: bundles src/lib/earnTerms.ts for node and asserts the
// four-terms copy, payout-schedule labels, the restake gain and the calendar
// reminder against exact values.
// Usage: TZ=UTC node test/earn-terms-oracle.cjs
//        TZ=Asia/Kuala_Lumpur node test/earn-terms-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'earnTerms.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'earn-terms-'))
const OUT = path.join(OUT_DIR, 'earnTerms.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`)
}

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], { stdio: 'ignore' })
const { payoutScheduleLabel, restakeGainNim, stakeTerms, restakeReminder } = require(OUT)

// Every string the live validators API returned on 2026-10-24, plus the edge
// cases the label has to survive.
const schedules = [
  ['', null],
  [undefined, null],
  ['   ', null],
  ['Every 12 hours', 'every 12 hours'],
  ['Every 3 hours', 'every 3 hours'],
  ['Every 4 hours', 'every 4 hours'],
  ['Every minute', 'every minute'],
  ['Every 1 minute', 'every minute'],
  ['Every 1 hour', 'every hour'],
  ['0 */6 * * *', 'every 6 hours'],
  ['0 * * * *', 'every hour'],
  ['*/15 * * * *', 'every 15 minutes'],
  ['5 4 * * 1', null],
  ['0 0 1 * *', null],
  ['Payouts over 10 NIM are instant when NimiqPocket is elected .', 'Payouts over 10 NIM are instant when NimiqPocket is elected .'],
  ['x'.repeat(120), null],
]
for (const [raw, want] of schedules) {
  const got = payoutScheduleLabel(raw)
  check(
    `schedule ${JSON.stringify(raw)} -> ${JSON.stringify(want)}`,
    got === want,
    JSON.stringify(got)
  )
}

// Exactly 100 characters is shown, 101 is not.
check('schedule: 100 chars shown', payoutScheduleLabel('y'.repeat(100)) === 'y'.repeat(100))
check('schedule: 101 chars dropped', payoutScheduleLabel('y'.repeat(101)) === null)

// --- stakeTerms ---
const BASE_RISK =
  'If the pool goes offline or is jailed, it earns nothing for those days. Under normal circumstances you cannot lose the staked NIM itself.'
const RATE =
  "Varies. It falls slowly as new NIM issuance declines, and moves with the pool's fee and how much NIM is staked network-wide."
const EXIT =
  'Unstaking usually takes 12 hours to 4 days, in three steps: deactivate, retire, withdraw.'
const GENERIC_HOW =
  'Nimiq proof-of-stake. Your NIM stays in your own staking record; the pool you pick produces blocks with it and pays you the rewards.'

const restake = stakeTerms({
  validator: { name: 'Moon Pool', fee: 0.01, payoutType: 'restake' },
  hasStaker: true,
  scheduleLabel: 'every 12 hours',
})
check(
  'terms restake: how it works names the pool and fee',
  restake.howItWorks ===
    'Nimiq proof-of-stake. Your NIM stays in your own staking record; Moon Pool (1% fee) produces blocks with it and pays you the rewards.',
  restake.howItWorks
)
check('terms restake: rate', restake.rate === RATE, restake.rate)
check(
  'terms restake: risk + schedule suffix',
  restake.risk === BASE_RISK + ' Moon Pool adds your rewards to your stake every 12 hours.',
  restake.risk
)
check('terms restake: exit', restake.exit === EXIT, restake.exit)

const direct = stakeTerms({
  validator: { name: 'Nimiq.Fun', fee: 0.025, payoutType: 'direct' },
  hasStaker: true,
  scheduleLabel: 'every 12 hours',
})
check(
  'terms direct: 2.5% fee, wallet payout sentence',
  direct.howItWorks ===
    'Nimiq proof-of-stake. Your NIM stays in your own staking record; Nimiq.Fun (2.5% fee) produces blocks with it and pays you the rewards.',
  direct.howItWorks
)
check(
  'terms direct: risk names the wallet and the schedule',
  direct.risk ===
    BASE_RISK + ' Nimiq.Fun pays rewards into your wallet every 12 hours, so you rely on the pool to pay.',
  direct.risk
)

const none = stakeTerms({
  validator: { name: 'Nimiq Surf', fee: 0, payoutType: 'none' },
  hasStaker: true,
  scheduleLabel: null,
})
check(
  'terms none: free pool, unknown payout sentence',
  none.howItWorks ===
    'Nimiq proof-of-stake. Your NIM stays in your own staking record; Nimiq Surf (0% fee) produces blocks with it and pays you the rewards.',
  none.howItWorks
)
check(
  'terms none: says the pool does not say',
  none.risk === BASE_RISK + ' Nimiq Surf does not say how it pays rewards, so you rely on the pool to pay.',
  none.risk
)

const missing = stakeTerms({
  validator: { name: 'Old Cache Pool', fee: null },
  hasStaker: true,
  scheduleLabel: null,
})
check(
  'terms missing payout type: fee omitted, unknown payout sentence',
  missing.howItWorks ===
    'Nimiq proof-of-stake. Your NIM stays in your own staking record; Old Cache Pool produces blocks with it and pays you the rewards.',
  missing.howItWorks
)
check(
  'terms missing payout type: unknown sentence',
  missing.risk === BASE_RISK + ' Old Cache Pool does not say how it pays rewards, so you rely on the pool to pay.',
  missing.risk
)

const freeText = stakeTerms({
  validator: { name: 'Odd Pool', fee: 0.05, payoutType: 'direct' },
  hasStaker: true,
  scheduleLabel: 'On Fridays, after lunch',
})
check(
  'terms free-text schedule: parenthesised',
  freeText.risk ===
    BASE_RISK +
      ' Odd Pool pays rewards into your wallet (schedule: On Fridays, after lunch), so you rely on the pool to pay.',
  freeText.risk
)

// A known validator shown to someone not staking yet keeps the generic "how it
// works" (the panel picks the pool for them) but still names it in the risk.
const notStaker = stakeTerms({
  validator: { name: 'Chipmunk', fee: 0.05, payoutType: 'direct' },
  hasStaker: false,
  scheduleLabel: 'every 6 hours',
})
check('terms non-staker: generic how it works', notStaker.howItWorks === GENERIC_HOW, notStaker.howItWorks)
check(
  'terms non-staker: risk still names the pool',
  notStaker.risk === BASE_RISK + ' Chipmunk pays rewards into your wallet every 6 hours, so you rely on the pool to pay.',
  notStaker.risk
)

const bare = stakeTerms({ validator: null, hasStaker: false, scheduleLabel: null })
check('terms no validator: generic how it works', bare.howItWorks === GENERIC_HOW, bare.howItWorks)
check(
  'terms no validator: pools pay themselves',
  bare.risk === BASE_RISK + ' Pools pay rewards themselves, each on its own schedule.',
  bare.risk
)
check('terms no validator: rate unchanged', bare.rate === RATE)

// --- restakeGainNim ---
const gain = restakeGainNim({ stakedNim: 1000, rate: 0.08, now: Date.UTC(2026, 9, 21) })
check('restakeGain: positive for a real stake', gain !== null && gain > 0 && Number.isFinite(gain), String(gain))
check('restakeGain: null rate is null', restakeGainNim({ stakedNim: 1000, rate: null }) === null)
check('restakeGain: zero rate is null', restakeGainNim({ stakedNim: 1000, rate: 0 }) === null)
check('restakeGain: zero stake is null', restakeGainNim({ stakedNim: 0, rate: 0.08 }) === null)

// --- restakeReminder ---
const nowMs = Date.UTC(2026, 9, 21, 12, 30)
const appUrl = 'https://nimbooks.subimpact.net/'
const reminder = restakeReminder({ nowMs, appUrl })

// Recompute the local next-day 09:00 independently of the module.
const startLocal = new Date(nowMs)
startLocal.setDate(startLocal.getDate() + 1)
startLocal.setHours(9, 0, 0, 0)
const endLocal = new Date(startLocal.getTime() + 15 * 60 * 1000)
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const wantStart = stamp(startLocal)
const wantEnd = stamp(endLocal)

check('reminder ics: weekly rule', reminder.ics.includes('RRULE:FREQ=WEEKLY'))
check('reminder ics: PRODID', reminder.ics.includes('PRODID:-//NimBooks//Restake reminder//EN'))
check('reminder ics: UID', reminder.ics.includes(`UID:${nowMs}-restake@nimbooks.subimpact.net`))
check('reminder ics: DTSTART is next day 09:00 local', reminder.ics.includes(`DTSTART:${wantStart}`), wantStart)
check('reminder ics: DTEND is 15 minutes later', reminder.ics.includes(`DTEND:${wantEnd}`), wantEnd)
if (process.env.TZ === 'UTC') {
  check('reminder ics: TZ=UTC gives 20261022T090000Z', reminder.ics.includes('DTSTART:20261022T090000Z'))
}
check(
  'reminder ics: summary and description',
  reminder.ics.includes('SUMMARY:Restake your NIM rewards') &&
    reminder.ics.includes(
      'DESCRIPTION:Open NimBooks and restake the rewards your pool paid out: https://nimbooks.subimpact.net/'
    )
)
check('reminder ics: VALARM', reminder.ics.includes('BEGIN:VALARM') && reminder.ics.includes('TRIGGER:-PT0M'))
const lf = (reminder.ics.match(/\n/g) || []).length
const crlf = (reminder.ics.match(/\r\n/g) || []).length
check('reminder ics: CRLF line endings throughout', lf === crlf && lf > 0 && !/\r(?!\n)/.test(reminder.ics), `${crlf}/${lf}`)

const escaped = restakeReminder({ nowMs, appUrl: 'https://example.com/a,b;c' })
check(
  'reminder ics: description escapes comma and semicolon',
  escaped.ics.includes('https://example.com/a\\,b\\;c'),
  escaped.ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'))
)
const multi = restakeReminder({ nowMs, appUrl: 'https://example.com/a\nb' })
check('reminder ics: description escapes newlines', multi.ics.includes('https://example.com/a\\nb'))

const google = new URL(reminder.googleUrl)
check('googleUrl: template action', google.searchParams.get('action') === 'TEMPLATE')
check('googleUrl: recurring weekly', google.searchParams.get('recur') === 'RRULE:FREQ=WEEKLY')
check('googleUrl: dates match the ics', google.searchParams.get('dates') === `${wantStart}/${wantEnd}`)
check('googleUrl: title and details', google.searchParams.get('text') === 'Restake your NIM rewards')
check(
  'googleUrl: details carry the app link',
  google.searchParams.get('details') === `Open NimBooks and restake the rewards your pool paid out: ${appUrl}`
)

// --- no em dash / en dash in any copy this module returns ---
const everyString = [
  ...schedules.map(([raw]) => payoutScheduleLabel(raw)),
  ...Object.values(restake),
  ...Object.values(direct),
  ...Object.values(none),
  ...Object.values(missing),
  ...Object.values(freeText),
  ...Object.values(notStaker),
  ...Object.values(bare),
  reminder.ics,
  reminder.googleUrl,
].filter((s) => typeof s === 'string')
const dashed = everyString.filter((s) => /[\u2013\u2014]/.test(s))
check('copy: no em or en dash', dashed.length === 0, dashed.join(' | '))

fs.rmSync(OUT_DIR, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed (TZ=${process.env.TZ || 'unset'})`)
process.exit(fail ? 1 : 0)

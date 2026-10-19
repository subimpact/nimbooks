// Rewards across calendar-year requests: the fetch get_summary and
// get_statement lean on.
//
// The rolling 90-day window is gone: these tools are asked for real periods
// (a tax year, a month, or a whole wallet's history), so the range fetcher
// splits its ask across calendar-year requests. The ask itself is an
// inclusive instant range; on the wire the endpoint takes `from` inclusive
// at 00:00 UTC, `to` EXCLUSIVE at 00:00 UTC, and no future `to`, so each
// request's `to` day is the day AFTER the day holding its last included
// instant, capped at today's 00:00. Each request keeps only the groups
// inside its own range. On the live server, responses leak a window or two
// past the requested edges (the ranges are stitched there), so abutting
// requests must not count those rows twice or every tax year boundary
// double-books a window. Here the whole fetch is mocked: fixed clock, and a
// fixture endpoint that leaks on purpose. No network.

import test from 'node:test'
import assert from 'node:assert/strict'

import { getRestakeRewardTxs, rollUpRestakeRewards, REWARDS_FLOOR_DAY } from '../src/chain.ts'

const OWN = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05'
const V1 = 'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL'
const V1_HASH_TAIL = 'NQ97H1NRS3X0CVFQVJ9Y9A0YFRQNQ6EUD0PL'

const NOW = Date.parse('2026-02-10T10:00:00Z')
const OCT19 = Date.parse('2026-10-19T08:00:00Z')

// Fixture windows in the order the mock answers them in. The edge rows are
// bait: 999 sits before requests whose `from` is 2025-03-10, and 400 is the
// row the 2025 response leaks across the year seam (the 2026 request must be
// the only one to keep it, folded into its 440). The 2026-03-31 window lies
// beyond the default clock's `now`, so the mock never serves it until a test
// moves the clock past it.
const GROUPS = [
  { sender_address: V1, time_window: '2025-03-09T23:45:00.000Z', aggregated_value: 999 },
  { sender_address: V1, time_window: '2025-03-10T01:15:00.000Z', aggregated_value: 100 },
  { sender_address: V1, time_window: '2025-03-10T05:15:00.000Z', aggregated_value: 200 },
  { sender_address: V1, time_window: '2025-12-31T21:15:00.000Z', aggregated_value: 27 },
  { sender_address: V1, time_window: '2025-12-31T23:45:00.000Z', aggregated_value: 50 },
  { sender_address: V1, time_window: '2026-01-01T00:15:00.000Z', aggregated_value: 400 },
  { sender_address: V1, time_window: '2026-01-01T05:15:00.000Z', aggregated_value: 40 },
  { sender_address: V1, time_window: '2026-02-04T23:45:00.000Z', aggregated_value: 700 },
  { sender_address: V1, time_window: '2026-02-05T00:15:00.000Z', aggregated_value: 800 },
  { sender_address: V1, time_window: '2026-03-31T21:15:00.000Z', aggregated_value: 33 },
]
// Day roll-ups of the everything-inside-two-requests test below: 300 (Mar 10)
// + 77 (Dec 31: 27 + 50) + 440 (Jan 1: 400 + 40) + 700 + 800.
const EXPECTED_TOTAL = 300 + 77 + 440 + 700 + 800

type Call = { from: string; to: string }
let calls: Call[] = []
let failFor: string | null = null

const realNow = Date.now
const realFetch = globalThis.fetch

// Most tests run on the default clock; the inclusive-`until` and cap tests
// move it (19 October 2026) and restore it.
let clock = NOW
Date.now = () => clock

async function withClock(ms: number, body: () => Promise<void>): Promise<void> {
  const previous = clock
  clock = ms
  try {
    await body()
  } finally {
    clock = previous
  }
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input)
  const params = new URL(url).searchParams
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  calls.push({ from, to })
  if (failFor !== null && from === failFor) {
    return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
  }
  const lo = Date.parse(`${from}T00:00:00Z`)
  const hi = Date.parse(`${to}T00:00:00Z`)
  // Same leak shape the app's oracle mocks: the response carries the last
  // window before `from` and the first at/after `to`, alongside the inside
  // ones. Only the inside ones may survive.
  const inside = GROUPS.filter((g) => {
    const t = Date.parse(g.time_window)
    return t >= lo && t < hi
  })
  const before = GROUPS.filter((g) => Date.parse(g.time_window) < lo).slice(-1)
  const after = GROUPS.filter((g) => {
    const t = Date.parse(g.time_window)
    return t >= hi && t < clock
  }).slice(0, 1)
  return {
    ok: true,
    status: 200,
    json: async () => ({ from, to, groups: [...before, ...inside, ...after] }),
  } as unknown as Response
}) as typeof fetch

test.after(() => {
  Date.now = realNow
  globalThis.fetch = realFetch
})

test('the floor constant is the PoS launch day, same as the app', () => {
  assert.equal(REWARDS_FLOOR_DAY, '2024-11-19')
})

test('a 2025-03-10..2026-02-05 midday range makes two requests and loses no totals', async () => {
  calls = []
  failFor = null
  const txs = await getRestakeRewardTxs(
    OWN,
    Date.parse('2025-03-10T00:00:00Z'),
    Date.parse('2026-02-05T12:00:00Z')
  )
  // Both wire `to`s are the day AFTER the day of the slice's last included
  // instant: 2025 keeps its whole December (its slice ends 1ms before the
  // new year, `to=2026-01-01` exclusive) and 2026 keeps 5 February whole,
  // since 12:00 on 5 Feb is included and 5 Feb's windows belong to it
  // (`to=2026-02-06`).
  assert.deepEqual(calls, [
    { from: '2025-03-10', to: '2026-01-01' },
    { from: '2026-01-01', to: '2026-02-06' },
  ])
  // Leaked edges are dropped: 999 before `from`, and the 400 the 2025
  // response leaks across the seam (it survives only as part of the 2026
  // request's own 440). Inside the two requests: 300 + 77 + 440 + 700 + 800.
  assert.equal(
    txs.reduce((s, t) => s + Number(t.value), 0),
    EXPECTED_TOTAL
  )
  assert.equal(txs.length, 5)
  assert.deepEqual(
    txs.map((t) => t.value),
    ['800', '700', '440', '77', '300']
  )
  assert.ok(txs.every((t) => t.synthetic === 'reward' && t.recipient === OWN && t.sender === V1))
  assert.equal(new Set(txs.map((t) => t.hash)).size, txs.length)
})

test('a whole-2025 ask ending 1ms before 2026 keeps 31 December on the wire', async () => {
  calls = []
  failFor = null
  const txs = await getRestakeRewardTxs(OWN, Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1) - 1)
  // 2025-12-31T23:59:59.999Z is the last included instant, so its day has to
  // be in the request, written the way the endpoint wants it:
  // `to=2026-01-01` (exclusive at 00:00). Flooring the ask to
  // `to=2025-12-31` was the bug - the year's last day was never asked for.
  assert.deepEqual(calls, [{ from: '2025-01-01', to: '2026-01-01' }])
  // So 31 December's two windows (21:15's 27 + 23:45's 50) show as one row,
  // and everything before the seam this clock has seen is inside: 300 + 77 +
  // 999, three day rows.
  assert.ok(txs.some((t) => t.hash === `restake:2025-12-31:${V1_HASH_TAIL}` && t.value === '77'))
  assert.deepEqual(
    txs.map((t) => t.value),
    ['77', '300', '999']
  )
})

test('an `until` at the last millisecond of 2026-03-31 keeps that day, like get_summary --until', async () => {
  calls = []
  failFor = null
  await withClock(OCT19, async () => {
    // What get_summary sends for --until 2026-03-31: the day's last
    // millisecond, inclusive.
    const txs = await getRestakeRewardTxs(
      OWN,
      Date.UTC(2026, 0, 1),
      Date.parse('2026-03-31T23:59:59.999Z')
    )
    // The ask runs through the END of 31 March, so the wire sees
    // `to=2026-04-01`; the cap at today's 00:00 (19 October) is not involved.
    assert.deepEqual(calls, [{ from: '2026-01-01', to: '2026-04-01' }])
    assert.ok(txs.some((t) => t.hash === `restake:2026-03-31:${V1_HASH_TAIL}` && t.value === '33'))
    assert.equal(txs.length, 4)
    assert.equal(
      txs.reduce((s, t) => s + Number(t.value), 0),
      440 + 700 + 800 + 33
    )
  })
})

test('a `to` equal to now never asks past today (the API rejects a future `to`)', async () => {
  calls = []
  failFor = null
  await withClock(OCT19, async () => {
    // What get_summary sends when no `until` is given: toMs = now, right on
    // the clock. Ceils to 2026-10-20, then the cap at today's 00:00 - the
    // only reason this does not read 2026-10-20 - puts it back to this day.
    const txs = await getRestakeRewardTxs(OWN, Date.UTC(2026, 0, 1), Date.now())
    assert.deepEqual(calls, [{ from: '2026-01-01', to: '2026-10-19' }])
    assert.ok(!calls.some((c) => c.to === '2026-10-20'))
    // Everything the clock has seen of this address is inside one request.
    assert.equal(txs.length, 4)
    assert.equal(
      txs.reduce((s, t) => s + Number(t.value), 0),
      440 + 700 + 800 + 33
    )
  })
})

test('a range older than the public data clamps to the floor day', async () => {
  calls = []
  failFor = null
  const txs = await getRestakeRewardTxs(OWN, Date.parse('2020-06-01T00:00:00Z'), NOW)
  assert.deepEqual(calls, [
    { from: '2024-11-19', to: '2025-01-01' },
    { from: '2025-01-01', to: '2026-01-01' },
    { from: '2026-01-01', to: '2026-02-10' },
  ])
  // The clamp widens the ask: with `to` now (2026-02-10), every fixture
  // window at or before that clock lies inside some request, edges and all
  // (the still-future 2026-03-31 window waits for the later-clock tests).
  assert.equal(
    txs.reduce((s, t) => s + Number(t.value), 0),
    999 + 300 + 77 + 440 + 700 + 800
  )
  // Same-day windows collapse (2025-03-10, 2025-12-31 and 2026-01-01 each
  // pair up), and 999 and 800 get rows of their own on their own days.
  assert.equal(txs.length, 6)
})

test('a `to` in the future clamps to now, like the endpoint demands', async () => {
  calls = []
  failFor = null
  const txs = await getRestakeRewardTxs(OWN, Date.parse('2026-02-09T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z'))
  assert.deepEqual(calls, [{ from: '2026-02-09', to: '2026-02-10' }])
  assert.equal(txs.length, 0)
})

test('a failing year request contributes [] and the rest still count', async () => {
  calls = []
  failFor = '2026-01-01'
  try {
    const txs = await getRestakeRewardTxs(
      OWN,
      Date.parse('2025-03-10T00:00:00Z'),
      Date.parse('2026-02-05T12:00:00Z')
    )
    assert.equal(calls.length, 2)
    // The 2026 request failed; 2025's kept range is 300 + 77.
    assert.equal(
      txs.reduce((s, t) => s + Number(t.value), 0),
      300 + 77
    )
  } finally {
    failFor = null
  }
})

test('rollUpRestakeRewards still collides rows day by day', () => {
  const txs = rollUpRestakeRewards(
    [
      { sender_address: V1, time_window: '2025-03-10T01:15:00.000Z', aggregated_value: 10 },
      { sender_address: V1, time_window: '2025-03-10T05:15:00.000Z', aggregated_value: 90 },
    ],
    OWN
  )
  assert.equal(txs.length, 1)
  assert.equal(txs[0].value, '100')
  assert.equal(txs[0].hash, 'restake:2025-03-10:NQ97H1NRS3X0CVFQVJ9Y9A0YFRQNQ6EUD0PL')
})
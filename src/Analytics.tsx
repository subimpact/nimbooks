// Analytics — in-depth charts derived from the loaded NIM transaction history.
// Pure SVG, zero dependencies: daily net flow bars + cumulative balance trajectory.

import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CurrencyCode, NimiqTx, TxLabel } from './lib/chain'
import {
  decodeMemo,
  explorerTxUrl,
  formatFiat,
  formatLuna,
  isLabelledTxKind,
  txLabel,
} from './lib/chain'
import { parseInvoiceMemo } from './lib/invoice'
import DetailSheet from './DetailSheet'

export type AnalyticsPeriod = 7 | 30 | 0 // days; 0 = all available

interface FlowPoint {
  key: string // YYYY-MM-DD (local)
  label: string
  ts: number
  in: number // NIM
  out: number // NIM
  // The very txs that produced `in`/`out` — the day sheet lists these, so a
  // bar and its drilldown can never disagree about what the day contained.
  txs: NimiqTx[]
}

interface Stats {
  totalIn: number
  totalOut: number
  net: number
  count: number
  inCount: number
  outCount: number
  avgIn: number
  avgOut: number
  largestIn: number
  largestOut: number
}

// Which stat card was tapped. The day sheet keys off a date instead, so the
// two drilldowns can't both be open.
type StatSheet = 'in' | 'out' | 'net'

const SHEET_TITLE: Record<StatSheet, string> = {
  in: 'Received',
  out: 'Sent',
  net: 'Net flow',
}

function dayKey(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfDay(tsMs: number): number {
  const d = new Date(tsMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

// Addresses reach us from the index already grouped (NQ12 34AB …) but that
// isn't guaranteed — regroup from the stripped form so two spellings of the
// same address can never render as two separate counterparties.
function spacedAddr(addr: string): string {
  const clean = addr.replace(/\s+/g, '').toUpperCase()
  return clean.match(/.{1,4}/g)?.join(' ') ?? addr
}

function shortAddr(spaced: string): string {
  return spaced.length <= 12 ? spaced : `${spaced.slice(0, 9)}…`
}

// `decodeMemo` hands back the raw hex when the bytes aren't printable text.
// That's honest as a `memo:` line but useless as a stand-in for a name, so a
// memo that didn't actually decode falls through to the address instead.
function memoName(data?: string): string {
  const decoded = decodeMemo(data).trim()
  if (!decoded || decoded === (data ?? '').trim()) return ''
  // `nimbooks:invoice:<id>` is a machine reference this app wrote itself — it
  // decodes cleanly but naming the payer after it is worse than no name.
  return parseInvoiceMemo(decoded) ? '' : decoded
}

interface Counterparty {
  norm: string
  addr: string // canonical spaced form
  name: string // decoded memo, when one decoded
  sum: number // NIM
  count: number
}

// Sum + count per counterparty address, biggest first. There is no contacts
// feature, so the first memo that decoded doubles as the party's name.
function groupCounterparties(txs: NimiqTx[], pick: (tx: NimiqTx) => string): Counterparty[] {
  const byAddr = new Map<string, Counterparty>()
  for (const tx of txs) {
    const raw = pick(tx)
    const norm = raw.replace(/\s+/g, '').toUpperCase()
    if (!norm) continue
    const v = Number(tx.value) / 100000
    if (!Number.isFinite(v)) continue
    let entry = byAddr.get(norm)
    if (!entry) {
      entry = { norm, addr: spacedAddr(raw), name: '', sum: 0, count: 0 }
      byAddr.set(norm, entry)
    }
    entry.sum += v
    entry.count++
    if (!entry.name) entry.name = memoName(tx.data)
  }
  return [...byAddr.values()].sort((a, b) => b.sum - a.sum)
}

function tallyKinds(txs: NimiqTx[], own: string): { kind: TxLabel; n: number }[] {
  const counts = new Map<TxLabel, number>()
  for (const tx of txs) {
    const kind = txLabel(tx, own)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([kind, n]) => ({ kind, n }))
    .sort((a, b) => b.n - a.n)
}

function KindPills({ counts }: { counts: { kind: TxLabel; n: number }[] }) {
  if (counts.length === 0) return null
  return (
    <div className="kind-pills">
      {counts.map(({ kind, n }) => (
        <span key={kind} className="kind-pill">
          <span className={`tx-kind ${kind}`}>{kind}</span>
          <span className="kind-n">{n}</span>
        </span>
      ))}
    </div>
  )
}

function CounterpartyRows({
  rows,
  total,
  incoming,
  fmt,
}: {
  rows: Counterparty[]
  total: number
  incoming: boolean
  fmt: (v: number) => string
}) {
  return (
    <div className="sheet-counterparties">
      {rows.map((c) => (
        <div key={c.norm} className="sheet-counterparty">
          <div className="sheet-cp-who">
            <div className="sheet-cp-name">{c.name || shortAddr(c.addr)}</div>
            <div className="sheet-cp-addr mono">{c.addr}</div>
          </div>
          <div className="sheet-cp-amt">
            <div className={incoming ? 'green' : 'red'}>
              {incoming ? '+' : '−'}
              {fmt(c.sum)} NIM
            </div>
            <div className="sheet-cp-meta">
              {c.count} {c.count === 1 ? 'tx' : 'txs'} ·{' '}
              {total > 0 ? ((c.sum / total) * 100).toFixed(1) : '0.0'}%
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Reconstruct historical balance by walking txs newest → oldest from the current balance.
// Outgoing txs cost value + fee; balances are clamped at 0 (can't go negative).
// One point per day, not per tx: each point is stamped at that day's close and
// carries that day's end-of-day balance, so a busy day reads as its net move
// instead of an intra-day sawtooth.
function buildTrajectory(
  txs: NimiqTx[],
  currentBalanceNim: number,
  ownAddressNorm: string,
  now: number
): { ts: number; balance: number }[] {
  const sorted = [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  let bal = currentBalanceNim
  const pts: { ts: number; balance: number }[] = [{ ts: now, balance: bal }]
  let dayKeyOpen = ''
  for (const tx of sorted) {
    const ts = tx.timestamp ?? 0
    if (ts) {
      const k = dayKey(ts)
      if (k !== dayKeyOpen) {
        // A new day opens: walking backwards, bal is still that day's
        // end-of-day balance (its txs are applied below), and the first tx
        // seen for the day is its last — so its timestamp is the day's close.
        pts.push({ ts, balance: bal })
        dayKeyOpen = k
      }
    }
    const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === ownAddressNorm
    // Funding an HTLC (toType 2) is internal routing, not a payment out: the
    // NIM stays the user's, and the anchor this walk starts from already
    // counts the contract's balance. Undoing it as a spend would credit the
    // whole amount back and lift every earlier point by it.
    if (isOut && tx.toType === 2) continue
    const v = Number(tx.value) / 100000
    const fee = Number(tx.fee) / 100000
    if (Number.isFinite(v)) {
      bal = isOut ? bal + v + (Number.isFinite(fee) ? fee : 0) : bal - v // walk backwards
      bal = Math.max(0, bal)
    }
  }
  return pts.reverse() // oldest → newest for the area chart
}

export default function Analytics({
  txs,
  currentBalanceNim,
  ownAddress,
  period,
  onPeriodChange,
  onOpenHistory,
  lang,
  nimRate,
  currency,
}: {
  txs: NimiqTx[]
  currentBalanceNim: string | null
  ownAddress: string | null
  period: AnalyticsPeriod
  onPeriodChange: (p: AnalyticsPeriod) => void
  onOpenHistory: () => void
  lang: string
  nimRate?: number
  currency?: CurrencyCode
}) {
  const ownNorm = (ownAddress ?? '').replace(/\s+/g, '').toUpperCase()
  // Day key (YYYY-MM-DD) of the bar being drilled into, not an index: the
  // index shifts when the period switch changes the bucket span.
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [statSheet, setStatSheet] = useState<StatSheet | null>(null)
  // Keyboard cursor into the flow chart's slots; -1 until a key or a tap puts
  // it somewhere. An index is right here (unlike `selectedDay`) because it is
  // pure focus state — it is clamped to the new range on a period switch, not
  // carried by day. Only drawn while the chart holds focus, so the tap path
  // looks exactly as it did before.
  const [cursor, setCursor] = useState(-1)
  const [chartFocus, setChartFocus] = useState(false)
  // One clock for every derivation below, read once per mount instead of per
  // memo: `Date.now()` in a memo body makes render impure, and three separate
  // reads let the buckets, the trajectory and the trend window disagree about
  // where "now" is. Re-stamped at midnight and only then: a frozen clock would
  // leave the newest bucket labelled yesterday — and drop every one of today's
  // transactions, which land in a day key no bucket was seeded for.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const untilMidnight = startOfDay(now) + 86400000 - Date.now()
    const id = setTimeout(() => setNow(Date.now()), Math.max(1000, untilMidnight))
    return () => clearTimeout(id)
  }, [now])

  const data = useMemo(() => {
    const buckets = new Map<string, { ts: number; in: number; out: number; txs: NimiqTx[] }>()
    const t = new Date(now)
    // Seed buckets so empty days render as flat segments.
    // For "All", span from the earliest tx (capped at 90 days) so the chart
    // actually covers the full history instead of truncating to 30 days.
    let seedDays: number = period
    if (period === 0) {
      const earliest = txs.reduce((min, tx) => (tx.timestamp && tx.timestamp < min ? tx.timestamp : min), now)
      seedDays = Math.min(90, Math.max(1, Math.ceil((now - earliest) / 86400000)))
    }
    let oldestSeeded = now
    for (let i = 0; i < seedDays; i++) {
      const k = dayKey(t.getTime())
      buckets.set(k, { ts: t.getTime(), in: 0, out: 0, txs: [] })
      oldestSeeded = t.getTime()
      t.setDate(t.getDate() - 1)
    }
    // The window has to start where the oldest *bucket* starts. A rolling
    // `now − period days` cutoff lands mid-day, so everything between it and
    // that day's 00:00 was counted by no bucket and by no total — and the
    // "vs previous" comparison measured calendar days against a rolling window.
    const cutoff = period === 0 ? 0 : startOfDay(oldestSeeded)
    let totalIn = 0
    let totalOut = 0
    let count = 0
    let inCount = 0
    let outCount = 0
    let largestIn = 0
    let largestOut = 0
    for (const tx of txs) {
      // Failed/reverted txs are not real transfers — exclude from analytics
      if (tx.executionResult === false) continue
      const ts = tx.timestamp ?? now
      if (ts < cutoff) continue
      const v = Number(tx.value) / 100000
      if (!Number.isFinite(v) || v <= 0) continue
      const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === ownNorm
      const k = dayKey(ts)
      const b = buckets.get(k)
      if (b) {
        // Sending to yourself is net-zero — the money never left. Counting only
        // the outgoing leg would read as a spend the wallet never made, so it
        // stays out of both flow totals and shows up in the day sheet only.
        if (isOut && tx.recipient.replace(/\s+/g, '').toUpperCase() === ownNorm) {
          // no flow either way
        } else if (isOut) {
          b.out += v
          totalOut += v
          outCount++
          largestOut = Math.max(largestOut, v)
        } else {
          b.in += v
          totalIn += v
          inCount++
          largestIn = Math.max(largestIn, v)
        }
        // Collected inside the same guards as the totals above, so the day
        // sheet can never list a tx the bar's own arithmetic left out.
        b.txs.push(tx)
        count++
      }
    }
    const points: FlowPoint[] = [...buckets.entries()]
      .map(([key, b]) => ({
        key,
        label: dayLabel(b.ts),
        ts: b.ts,
        in: b.in,
        out: b.out,
        txs: b.txs.sort((x, z) => (z.timestamp ?? 0) - (x.timestamp ?? 0)),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
    const stats: Stats = {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      count,
      inCount,
      outCount,
      avgIn: totalIn / Math.max(1, inCount),
      avgOut: totalOut / Math.max(1, outCount),
      largestIn,
      largestOut,
    }
    // `cutoff` travels with the data: the trajectory and the trend window are
    // the same window as the bars, or they are lying about the same period.
    return { points, stats, cutoff }
  }, [txs, period, ownNorm, now])

  const trajectory = useMemo(
    () => {
      if (currentBalanceNim === null) return []
      const filtered = txs.filter(
        // A reverted tx moved no NIM — walking the balance back through one
        // rewrites every point before it (same guard as the bucket loop).
        (tx) => tx.executionResult !== false && (tx.timestamp ?? 0) >= data.cutoff
      )
      return buildTrajectory(filtered, Number(currentBalanceNim) / 100000, ownNorm, now)
    },
    [txs, currentBalanceNim, ownNorm, data.cutoff, now]
  )

  const W = 340
  const H = 150
  const PAD_L = 46
  const PAD_B = 20
  const PAD_T = 8
  const plotW = W - PAD_L - 4
  const plotH = H - PAD_T - PAD_B
  const n = data.points.length
  const maxFlow = Math.max(1, ...data.points.map((p) => Math.abs(p.in - p.out)), 0.000001)
  // The 1-NIM floor above keeps a near-zero period from being magnified into a
  // full-height plot — but when the floor is what's setting the scale, every bar
  // is a sliver against an axis the user never asked for. That is a real reading
  // of the data (a relay address nets out to ~0 daily), so say it in words
  // rather than leaving the chart to look broken.
  const flowFlat = maxFlow <= 1
  const barW = Math.max(2, (plotW / n) * 0.62)
  const slotW = plotW / n

  // Y gridlines: 0 at bottom; symmetric around 0 if net goes negative
  const hasNeg = data.points.some((p) => p.in - p.out < 0)
  const yMax = hasNeg ? Math.max(1, maxFlow) : maxFlow
  const yMin = hasNeg ? -yMax : 0
  const yRange = yMax - yMin

  const y = (v: number) => PAD_T + plotH - ((v - yMin) / yRange) * plotH

  // Bounded y-floor: 25% headroom below the data min (never below 0). Scaling
  // from the min instead makes any wobble, however small, fill the plot height.
  const trajMax = trajectory.length ? Math.max(...trajectory.map((q) => q.balance)) : 0
  const trajMin = trajectory.length ? Math.min(...trajectory.map((q) => q.balance)) : 0
  const trajFloor = Math.max(0, trajMin - 0.25 * (trajMax - trajMin))
  // A single-value trajectory (every tx on one day, or a relay address that
  // holds ~0) has no span to scale against, and scaling it anyway pins every
  // point to the floor — which reads as "the balance went to zero" while both
  // axis labels say it did not. Draw the flat balance through the vertical
  // CENTRE instead: a line hugging either edge of the plot reads as a clipped
  // chart, one through the middle reads as deliberate. The flat case also drops
  // to a single axis label (two identical numbers look like a bug) and gets a
  // caption saying the balance held steady. The area fill is suppressed too
  // (see below) — filling from the line down to the floor paints half the plot.
  const trajFlat = trajectory.length > 0 && trajMax - trajFloor < 1e-9
  const trajFlatY = PAD_T + plotH / 2

  const trajPoints = trajectory.length
    ? (() => {
        const minTs = Math.min(...trajectory.map((q) => q.ts))
        const maxTs = Math.max(...trajectory.map((q) => q.ts))
        const span = Math.max(0.000001, trajMax - trajFloor)
        return trajectory
          .map((p) => {
            // Time-scaled x-axis: gaps in time render as gaps in the chart
            const x = PAD_L + plotW * (maxTs === minTs ? 1 : (p.ts - minTs) / (maxTs - minTs))
            const yv = trajFlat ? trajFlatY : PAD_T + plotH - 4 - ((p.balance - trajFloor) / span) * (plotH - 8)
            return `${x},${yv}`
          })
          .join(' ')
      })()
    : ''

  const fmt = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 })

  // Resolved fresh from the current points, so switching period while a sheet
  // is open closes it rather than showing a day outside the new range.
  const selIdx = selectedDay ? data.points.findIndex((p) => p.key === selectedDay) : -1
  const selected = selIdx >= 0 ? data.points[selIdx] : null
  // Clamped rather than reset on period change: switching 7d → All must never
  // leave the cursor pointing past the end of the new bucket list.
  const curIdx = cursor >= 0 && cursor < n ? cursor : -1

  // Bars are ~48px wide at 7d but 3.2px at "All", and zero-flow days render no
  // rect at all — so the whole plot area is the hit target and the tap snaps
  // to the nearest slot. Every pixel maps to some day.
  const pickDay = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect()
    if (!r.width || n === 0) return
    const xInView = (clientX - r.left) * (W / r.width)
    const i = Math.min(n - 1, Math.max(0, Math.floor((xInView - PAD_L) / slotW)))
    setStatSheet(null) // one sheet at a time — two overlays would stack
    setCursor(i)
    setSelectedDay(data.points[i].key)
  }

  // Keyboard equivalent of the tap: arrows walk the cursor along the days,
  // Enter/Space opens the one it is sitting on. The cursor is separate state
  // from `selectedDay` on purpose — arrowing across the chart should move a
  // marker, not fire the drill-down sheet open on every keypress. Once the
  // sheet *is* open the arrows carry it along, so a keyboard user can page
  // through days the same way a tap-and-swipe user would.
  const onChartKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return
    const at = curIdx >= 0 ? curIdx : selIdx >= 0 ? selIdx : n - 1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const next = Math.min(n - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)))
      setCursor(next)
      if (selIdx >= 0) setSelectedDay(data.points[next].key)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setStatSheet(null)
      setCursor(at)
      setSelectedDay(data.points[at].key)
    }
  }

  const openStat = (which: StatSheet) => {
    setSelectedDay(null)
    setStatSheet(which)
  }

  const dayTitle = (ts: number) =>
    new Date(ts).toLocaleDateString(lang, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  // Everything the three stat sheets show, derived from the same bucket txs the
  // bars are drawn from — so a stat card and the chart can never disagree.
  // Returns null until a card is tapped: zero cost while the sheets are closed.
  const drill = useMemo(() => {
    if (!statSheet) return null
    const own = ownAddress ?? ''
    const all = data.points.flatMap((p) => p.txs)
    const isOut = (tx: NimiqTx) => tx.sender.replace(/\s+/g, '').toUpperCase() === ownNorm
    const isSelf = (tx: NimiqTx) =>
      isOut(tx) && tx.recipient.replace(/\s+/g, '').toUpperCase() === ownNorm
    // Same exclusion the buckets make: a self-transfer is not a flow, so it
    // can't be a top recipient either (it would also push the percentages,
    // which are shares of the bucket totals, past 100%). Its fee was still
    // real money spent, so `all` — not `flow` — is what fees are summed over.
    const flow = all.filter((tx) => !isSelf(tx))
    const inTxs = flow.filter((tx) => !isOut(tx))
    const outTxs = flow.filter(isOut)

    // Composition: in − out per kind, so "you didn't spend 50k NIM, you staked
    // it" reads straight off the list rather than needing to be inferred.
    const byKind = new Map<TxLabel, { in: number; out: number; count: number }>()
    for (const tx of flow) {
      const v = Number(tx.value) / 100000
      if (!Number.isFinite(v)) continue
      const kind = txLabel(tx, own)
      const e = byKind.get(kind) ?? { in: 0, out: 0, count: 0 }
      if (isOut(tx)) e.out += v
      else e.in += v
      e.count++
      byKind.set(kind, e)
    }
    const composition = [...byKind.entries()]
      .map(([kind, e]) => ({ kind, net: e.in - e.out, count: e.count }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    // Previous window [cutoff − period days, cutoff). The buckets only span the
    // selected window, so the comparison needs its own pass over the raw txs,
    // under the same guards the bucket pass uses. Both ends are day-aligned
    // (stepped by calendar days off the bucket cutoff), so this is period
    // calendar days against period calendar days — not against a rolling window.
    let prevNet = 0
    let prevCount = 0
    if (period !== 0) {
      const cutoff = data.cutoff
      const startDate = new Date(cutoff)
      startDate.setDate(startDate.getDate() - period)
      const start = startDate.getTime()
      for (const tx of txs) {
        if (tx.executionResult === false) continue
        const ts = tx.timestamp ?? now
        if (ts < start || ts >= cutoff) continue
        const v = Number(tx.value) / 100000
        if (!Number.isFinite(v) || v <= 0) continue
        if (isSelf(tx)) continue // net-zero, same as the current window
        prevNet += isOut(tx) ? -v : v
        prevCount++
      }
    }
    // An empty previous window means there is nothing to compare against —
    // never a −100% that would read as a real collapse.
    const prevDelta =
      period !== 0 && prevCount > 0 && prevNet !== 0
        ? ((data.stats.net - prevNet) / Math.abs(prevNet)) * 100
        : null

    const byNet = [...data.points].sort((a, b) => b.in - b.out - (a.in - a.out))
    const best = byNet[0]
    const worst = byNet[byNet.length - 1]

    return {
      senders: groupCounterparties(inTxs, (tx) => tx.sender),
      recipients: groupCounterparties(outTxs, (tx) => tx.recipient),
      inKinds: tallyKinds(inTxs, own),
      outKinds: tallyKinds(outTxs, own),
      fees: all.filter(isOut).reduce((sum, tx) => {
        const f = Number(tx.fee) / 100000
        return sum + (Number.isFinite(f) ? f : 0)
      }, 0),
      composition,
      prevDelta,
      best: best && best.in - best.out > 0 ? best : null,
      worst: worst && worst.in - worst.out < 0 ? worst : null,
    }
  }, [statSheet, data, txs, ownAddress, ownNorm, period, now])

  // "All" truncates at 90 days of buckets — never call any of this all-time.
  const scopeLabel = period === 0 ? 'the loaded history (capped at 90 days)' : `the last ${period} days`
  const scopeShort = period === 0 ? 'loaded history' : `last ${period}d`
  const flowTotal = data.stats.totalIn + data.stats.totalOut
  const inPct = flowTotal > 0 ? (data.stats.totalIn / flowTotal) * 100 : 0

  // Compact form for the peak-day rows — the full `dayTitle` would crowd the
  // amount out of a space-between row.
  const shortDay = (ts: number) =>
    new Date(ts).toLocaleDateString(lang, { day: 'numeric', month: 'short' })

  const selNet = selected ? selected.in - selected.out : 0
  // Fees you paid, so only the txs you sent: an incoming tx carries the
  // *sender's* fee, and adding those made "Total fees" a bill for other
  // people's transactions.
  const selFees = selected
    ? selected.txs
        .filter((tx) => tx.sender.replace(/\s+/g, '').toUpperCase() === ownNorm)
        .reduce((sum, tx) => {
          const f = Number(tx.fee) / 100000
          return sum + (Number.isFinite(f) ? f : 0)
        }, 0)
    : 0

  const TX_CAP = 50
  const TOP_N = 5

  return (
    <section className="analytics">
      <div className="analytics-head">
        <h2>Analytics</h2>
        <div className="period-switch">
          {([7, 30, 0] as AnalyticsPeriod[]).map((p) => (
            <button
              key={p}
              className={period === p ? 'period active' : 'period'}
              onClick={() => onPeriodChange(p)}
            >
              {p === 0 ? 'All' : `${p}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid">
        <button
          type="button"
          className="stat stat-btn"
          onClick={() => openStat('in')}
          title="Total NIM received over the period"
        >
          <span className="label">Received</span>
          <span className="value green">+{fmt(data.stats.totalIn)}</span>
        </button>
        <button
          type="button"
          className="stat stat-btn"
          onClick={() => openStat('out')}
          title="Total NIM sent over the period"
        >
          <span className="label">Sent</span>
          <span className="value red">−{fmt(data.stats.totalOut)}</span>
        </button>
        <button
          type="button"
          className="stat stat-btn"
          onClick={() => openStat('net')}
          title="Received minus sent over the period"
        >
          <span className="label">Net flow</span>
          <span className={`value ${data.stats.net >= 0 ? 'green' : 'red'}`}>
            {data.stats.net >= 0 ? '+' : '−'}
            {fmt(Math.abs(data.stats.net))}
          </span>
        </button>
        <button type="button" className="stat stat-btn" onClick={onOpenHistory} title="View all transactions">
          <span className="label">Txs</span>
          <span className="value">{data.stats.count}</span>
        </button>
      </div>

      <div className="card chart-card">
        <span className="label">Daily net flow (NIM)</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart chart-tappable"
          role="button"
          tabIndex={0}
          aria-label={
            selected
              ? `Daily net flow chart — ${dayTitle(selected.ts)} selected. Arrow keys change day, Enter opens that day's transactions.`
              : "Daily net flow chart — tap a bar, or use arrow keys and Enter, for that day's transactions"
          }
          onClick={(e) => pickDay(e.clientX, e.currentTarget)}
          onKeyDown={onChartKey}
          onFocus={() => setChartFocus(true)}
          onBlur={() => setChartFocus(false)}
        >
          {/* keyboard cursor — only while the chart has focus and it sits
              somewhere the selection highlight below isn't already marking */}
          {chartFocus && curIdx >= 0 && curIdx !== selIdx && (
            <rect
              x={PAD_L + curIdx * slotW}
              y={PAD_T}
              width={slotW}
              height={plotH}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="3 2"
              rx="2"
            />
          )}
          {/* selected slot — drawn first so the bars stay on top of it */}
          {selIdx >= 0 && (
            <rect
              x={PAD_L + selIdx * slotW}
              y={PAD_T}
              width={slotW}
              height={plotH}
              fill="var(--chart-grid)"
              opacity={0.25}
            />
          )}
          {/* zero line */}
          <line x1={PAD_L} y1={y(0)} x2={W - 4} y2={y(0)} stroke="var(--chart-grid)" strokeWidth="1" />
          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={PAD_L}
              y1={y(yMin + yRange * f)}
              x2={W - 4}
              y2={y(yMin + yRange * f)}
              stroke="var(--chart-axis)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          ))}
          {/* bars — only render days with actual flow; empty days read as the flat zero line */}
          {data.points.map((p, i) => {
            const net = p.in - p.out
            if (net === 0) return null
            const x = PAD_L + i * slotW + (slotW - barW) / 2
            const barH = Math.max(1.2, (Math.abs(net) / yRange) * plotH)
            const yy = net >= 0 ? y(net) : y(0)
            return (
              <g key={p.key}>
                <rect
                  x={x}
                  y={yy}
                  width={barW}
                  height={barH}
                  rx="1.5"
                  fill={net >= 0 ? 'var(--green)' : 'var(--red)'}
                  opacity="0.9"
                >
                  <title>{`${p.label}: ${formatLuna(Math.abs(net) * 100000, lang)} NIM ${net >= 0 ? 'received' : 'sent'}`}</title>
                </rect>
                {n <= 16 && (
                  <text x={x + barW / 2} y={H - 6} fontSize="8" fill="var(--muted)" textAnchor="middle">
                    {p.label}
                  </text>
                )}
              </g>
            )
          })}
          {/* y labels */}
          <text x={PAD_L - 6} y={y(yMax) + 3} fontSize="8" fill="var(--muted)" textAnchor="end">
            {fmt(yMax)}
          </text>
          {hasNeg && (
            <text x={PAD_L - 6} y={y(yMin) + 3} fontSize="8" fill="var(--muted)" textAnchor="end">
              {fmt(yMin)}
            </text>
          )}
          <text x={PAD_L - 6} y={y(0) + 3} fontSize="8" fill="var(--muted)" textAnchor="end">
            0
          </text>
        </svg>
        {flowFlat && <p className="hint small">No significant daily flow in this period</p>}
      </div>

      {trajectory.length > 1 && (
        <div className="card chart-card">
          <span className="label">Available balance trajectory (NIM, end of day)</span>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Balance trajectory chart">
            <defs>
              <linearGradient id="trajFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline points={trajPoints} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
            {/* area fill: fades out toward the floor line, which is the bounded y-floor.
                Skipped when flat — the line sits at mid-plot, so the fill would be a
                half-height block rather than a shape that tracks the balance. */}
            {!trajFlat && (
              <polygon points={`${PAD_L},${PAD_T + plotH} ${trajPoints} ${W - 4},${PAD_T + plotH}`} fill="url(#trajFill)" />
            )}
            {/* Flat: one label, on the line. The max/floor pair collapses to the
                same number when the balance never moves, and two identical
                numbers stacked up the axis read as a broken axis. */}
            {trajFlat ? (
              <text x={PAD_L - 6} y={trajFlatY + 3} fontSize="8" fill="var(--muted)" textAnchor="end">
                {fmt(trajMax)}
              </text>
            ) : (
              <>
                <text x={PAD_L - 6} y={PAD_T + 10} fontSize="8" fill="var(--muted)" textAnchor="end">
                  {fmt(trajMax)}
                </text>
                <text x={PAD_L - 6} y={PAD_T + plotH - 4} fontSize="8" fill="var(--muted)" textAnchor="end">
                  {fmt(trajFloor)}
                </text>
              </>
            )}
          </svg>
          {trajFlat && <p className="hint small">Balance steady at {fmt(trajMax)} NIM over this period</p>}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <span className="label">Avg received/tx</span>
          <span className="value">{fmt(data.stats.avgIn)}</span>
        </div>
        <div className="stat">
          <span className="label">Avg sent/tx</span>
          <span className="value">{fmt(data.stats.avgOut)}</span>
        </div>
        <div className="stat">
          <span className="label">Largest received</span>
          <span className="value green">+{fmt(data.stats.largestIn)}</span>
        </div>
        <div className="stat">
          <span className="label">Largest sent</span>
          <span className="value red">−{fmt(data.stats.largestOut)}</span>
        </div>
      </div>

      <p className="hint small">
        Based on the loaded transaction history (capped at 90 days for charts).
      </p>

      {selected && (
        <DetailSheet
          title={dayTitle(selected.ts)}
          onClose={() => setSelectedDay(null)}
          footer={
            <button
              className="btn-ghost-lg"
              onClick={() => {
                setSelectedDay(null)
                onOpenHistory()
              }}
            >
              View all in History
            </button>
          }
        >
          <div className={`day-net ${selNet >= 0 ? 'green' : 'red'}`}>
            {selNet >= 0 ? '+' : '−'}
            {fmt(Math.abs(selNet))} NIM
          </div>
          {nimRate && currency && (
            <p className="hint small">
              ≈ {formatFiat(Math.abs(selNet) * nimRate, currency)} at current rate
            </p>
          )}

          <div className="day-breakdown">
            <div className="row">
              <span>Total in</span>
              <span className="green">+{fmt(selected.in)}</span>
            </div>
            <div className="row">
              <span>Total out</span>
              <span className="red">−{fmt(selected.out)}</span>
            </div>
            <div className="row">
              <span>Total fees</span>
              <span>{fmt(selFees)}</span>
            </div>
          </div>

          {selected.txs.length === 0 ? (
            <p className="hint small">No transactions on this day.</p>
          ) : (
            selected.txs.slice(0, TX_CAP).map((tx) => {
              const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === ownNorm
              const label = txLabel(tx, ownAddress ?? '')
              const memo = decodeMemo(tx.data)
              return (
                <div key={tx.hash} className="tx">
                  <div className="tx-main">
                    <span className={isOut ? 'out' : 'in'}>
                      {isOut ? '▼ sent' : '▲ received'}
                      {isLabelledTxKind(label) && <span className={`tx-kind ${label}`}> · {label}</span>}
                    </span>
                    <span className="tx-amount">{formatLuna(tx.value, lang)} NIM</span>
                  </div>
                  <div className="tx-sub">
                    {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString(lang) : '—'} ·{' '}
                    {/* Reward rollups carry a synthetic key, not a chain hash — never link one */}
                    {tx.synthetic ? (
                      <span className="tx-synthetic">{tx.hash.slice(0, 10)}…</span>
                    ) : (
                      <a
                        className="tx-hash-link"
                        href={explorerTxUrl(tx.hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tx.hash.slice(0, 10)}…
                      </a>
                    )}
                  </div>
                  {memo && <div className="tx-memo">memo: {memo}</div>}
                </div>
              )
            })
          )}
          {selected.txs.length > TX_CAP && (
            <p className="hint small">
              Showing the {TX_CAP} most recent of {selected.txs.length} transactions.
            </p>
          )}
          {/* Rewards compound straight into the staking contract, so they are
              not a flow through this balance — History is where they land. */}
          <p className="hint small">Staking rewards roll up in History, not in flow.</p>
        </DetailSheet>
      )}

      {statSheet && drill && (
        <DetailSheet
          title={SHEET_TITLE[statSheet]}
          onClose={() => setStatSheet(null)}
          footer={
            <button
              className="btn-ghost-lg"
              onClick={() => {
                setStatSheet(null)
                onOpenHistory()
              }}
            >
              View all in History
            </button>
          }
        >
          {statSheet === 'in' && (
            <>
              <div className="day-net green">+{fmt(data.stats.totalIn)} NIM</div>
              {nimRate && currency && (
                <p className="hint small">
                  ≈ {formatFiat(data.stats.totalIn * nimRate, currency)} at current rate
                </p>
              )}
              <p className="hint small">Over {scopeLabel}.</p>

              <div className="sheet-metrics">
                <div className="row">
                  <span>Incoming txs</span>
                  <span>{data.stats.inCount}</span>
                </div>
                <div className="row">
                  <span>Avg received/tx</span>
                  <span>{fmt(data.stats.avgIn)}</span>
                </div>
                <div className="row">
                  <span>Largest received</span>
                  <span className="green">+{fmt(data.stats.largestIn)}</span>
                </div>
              </div>

              <span className="label">Top senders · {scopeShort}</span>
              {drill.senders.length === 0 ? (
                <p className="hint small">No incoming transactions in this period.</p>
              ) : (
                <>
                  <CounterpartyRows
                    rows={drill.senders.slice(0, TOP_N)}
                    total={data.stats.totalIn}
                    incoming
                    fmt={fmt}
                  />
                  {drill.senders.length > TOP_N && (
                    <p className="hint small">
                      {drill.senders.length - TOP_N} more sender
                      {drill.senders.length - TOP_N === 1 ? '' : 's'} in this period.
                    </p>
                  )}
                </>
              )}

              <span className="label">By kind</span>
              <KindPills counts={drill.inKinds} />

              <p className="hint small">Staking rewards roll up in History, not here.</p>
            </>
          )}

          {statSheet === 'out' && (
            <>
              <div className="day-net red">−{fmt(data.stats.totalOut)} NIM</div>
              {nimRate && currency && (
                <p className="hint small">
                  ≈ {formatFiat(data.stats.totalOut * nimRate, currency)} at current rate
                </p>
              )}
              <p className="hint small">Over {scopeLabel}.</p>

              <div className="sheet-metrics">
                <div className="row">
                  <span>Outgoing txs</span>
                  <span>{data.stats.outCount}</span>
                </div>
                <div className="row">
                  <span>Avg sent/tx</span>
                  <span>{fmt(data.stats.avgOut)}</span>
                </div>
                <div className="row">
                  <span>Largest sent</span>
                  <span className="red">−{fmt(data.stats.largestOut)}</span>
                </div>
                <div className="row">
                  <span>Fees paid</span>
                  <span>{fmt(drill.fees)} NIM</span>
                </div>
              </div>

              <span className="label">Top recipients · {scopeShort}</span>
              {drill.recipients.length === 0 ? (
                <p className="hint small">No outgoing transactions in this period.</p>
              ) : (
                <>
                  <CounterpartyRows
                    rows={drill.recipients.slice(0, TOP_N)}
                    total={data.stats.totalOut}
                    incoming={false}
                    fmt={fmt}
                  />
                  {drill.recipients.length > TOP_N && (
                    <p className="hint small">
                      {drill.recipients.length - TOP_N} more recipient
                      {drill.recipients.length - TOP_N === 1 ? '' : 's'} in this period.
                    </p>
                  )}
                </>
              )}

              <span className="label">By kind</span>
              <KindPills counts={drill.outKinds} />
            </>
          )}

          {statSheet === 'net' && (
            <>
              <div className={`day-net ${data.stats.net >= 0 ? 'green' : 'red'}`}>
                {data.stats.net >= 0 ? '+' : '−'}
                {fmt(Math.abs(data.stats.net))} NIM
              </div>
              {nimRate && currency && (
                <p className="hint small">
                  ≈ {formatFiat(Math.abs(data.stats.net) * nimRate, currency)} at current rate
                </p>
              )}
              <p className="hint small">
                {data.stats.net >= 0 ? 'Surplus' : 'Deficit'} over {scopeLabel}.
              </p>

              {flowTotal > 0 && (
                <>
                  <span className="label">In / out proportion</span>
                  <div
                    className="flow-ratio-bar"
                    role="img"
                    aria-label={`${inPct.toFixed(0)}% in, ${(100 - inPct).toFixed(0)}% out`}
                  >
                    <div className="seg-in" style={{ width: `${inPct}%` }} />
                    <div className="seg-out" style={{ width: `${100 - inPct}%` }} />
                  </div>
                  <div className="flow-ratio-legend">
                    <span className="green">{inPct.toFixed(1)}% in</span>
                    <span className="red">{(100 - inPct).toFixed(1)}% out</span>
                  </div>
                </>
              )}

              <span className="label">Composition by kind</span>
              {drill.composition.length === 0 ? (
                <p className="hint small">No transactions in this period.</p>
              ) : (
                <div className="sheet-metrics">
                  {drill.composition.map((k) => (
                    <div key={k.kind} className="row">
                      <span>
                        <span className={`tx-kind ${k.kind}`}>{k.kind}</span> · {k.count}{' '}
                        {k.count === 1 ? 'tx' : 'txs'}
                      </span>
                      <span className={k.net >= 0 ? 'green' : 'red'}>
                        {k.net >= 0 ? '+' : '−'}
                        {fmt(Math.abs(k.net))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* No previous window exists for "All" — the panel is dropped, not zeroed. */}
              {period !== 0 && (
                <>
                  <span className="label">Trend</span>
                  <div className="sheet-metrics">
                    <div className="row">
                      <span>vs previous {period}d</span>
                      {drill.prevDelta === null ? (
                        <span>no comparable data</span>
                      ) : (
                        <span className={drill.prevDelta >= 0 ? 'green' : 'red'}>
                          {drill.prevDelta >= 0 ? '+' : '−'}
                          {Math.abs(drill.prevDelta).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {(drill.best || drill.worst) && (
                <>
                  <span className="label">Peak days</span>
                  <div className="sheet-metrics">
                    {drill.best && (
                      <div className="row">
                        <span>Best · {shortDay(drill.best.ts)}</span>
                        <span className="green">+{fmt(drill.best.in - drill.best.out)}</span>
                      </div>
                    )}
                    {drill.worst && (
                      <div className="row">
                        <span>Worst · {shortDay(drill.worst.ts)}</span>
                        <span className="red">
                          −{fmt(Math.abs(drill.worst.in - drill.worst.out))}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </DetailSheet>
      )}
    </section>
  )
}

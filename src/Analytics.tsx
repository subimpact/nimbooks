// Analytics — in-depth charts derived from the loaded NIM transaction history.
// Pure SVG, zero dependencies: daily net flow bars + cumulative balance trajectory.

import { useMemo } from 'react'
import type { NimiqTx } from './lib/chain'
import { formatLuna } from './lib/chain'

export type AnalyticsPeriod = 7 | 30 | 0 // days; 0 = all available

interface FlowPoint {
  key: string // YYYY-MM-DD (local)
  label: string
  in: number // NIM
  out: number // NIM
}

interface Stats {
  totalIn: number
  totalOut: number
  net: number
  count: number
  avgIn: number
  avgOut: number
  largestIn: number
  largestOut: number
}

function dayKey(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

// Reconstruct historical balance by walking txs newest → oldest from the current balance.
function buildTrajectory(
  txs: NimiqTx[],
  currentBalanceNim: number,
  ownAddressNorm: string
): { ts: number; balance: number }[] {
  const sorted = [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  let bal = currentBalanceNim
  const pts: { ts: number; balance: number }[] = [{ ts: Date.now(), balance: bal }]
  for (const tx of sorted) {
    const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === ownAddressNorm
    const v = Number(tx.value) / 100000
    if (Number.isFinite(v)) {
      bal = isOut ? bal + v : bal - v // walk backwards
      if (tx.timestamp) pts.push({ ts: tx.timestamp, balance: bal })
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
  lang,
}: {
  txs: NimiqTx[]
  currentBalanceNim: string | null
  ownAddress: string | null
  period: AnalyticsPeriod
  onPeriodChange: (p: AnalyticsPeriod) => void
  lang: string
}) {
  const ownNorm = (ownAddress ?? '').replace(/\s+/g, '').toUpperCase()

  const data = useMemo(() => {
    const now = Date.now()
    const cutoff = period === 0 ? 0 : now - period * 86400000
    const buckets = new Map<string, { ts: number; in: number; out: number }>()
    const t = new Date(now)
    // seed buckets so empty days render as flat segments
    for (let i = 0; i < (period === 0 ? 30 : period); i++) {
      const k = dayKey(t.getTime())
      buckets.set(k, { ts: t.getTime(), in: 0, out: 0 })
      t.setDate(t.getDate() - 1)
    }
    let totalIn = 0
    let totalOut = 0
    let count = 0
    let largestIn = 0
    let largestOut = 0
    for (const tx of txs) {
      const ts = tx.timestamp ?? now
      if (ts < cutoff) continue
      const v = Number(tx.value) / 100000
      if (!Number.isFinite(v) || v <= 0) continue
      const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === ownNorm
      const k = dayKey(ts)
      const b = buckets.get(k)
      if (b) {
        if (isOut) {
          b.out += v
          totalOut += v
          largestOut = Math.max(largestOut, v)
        } else {
          b.in += v
          totalIn += v
          largestIn = Math.max(largestIn, v)
        }
      }
      count++
    }
    const points: FlowPoint[] = [...buckets.entries()]
      .map(([key, b]) => ({ key, label: dayLabel(b.ts), in: b.in, out: b.out }))
      .sort((a, b) => a.key.localeCompare(b.key))
    const stats: Stats = {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      count,
      avgIn: totalIn / Math.max(1, count),
      avgOut: totalOut / Math.max(1, count),
      largestIn,
      largestOut,
    }
    return { points, stats }
  }, [txs, period, ownNorm])

  const trajectory = useMemo(
    () => (currentBalanceNim !== null ? buildTrajectory(txs, Number(currentBalanceNim) / 100000, ownNorm) : []),
    [txs, currentBalanceNim, ownNorm]
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
  const barW = Math.max(2, (plotW / n) * 0.62)
  const slotW = plotW / n

  // Y gridlines: 0 at bottom; symmetric around 0 if net goes negative
  const hasNeg = data.points.some((p) => p.in - p.out < 0)
  const yMax = hasNeg ? Math.max(1, maxFlow) : maxFlow
  const yMin = hasNeg ? -yMax : 0
  const yRange = yMax - yMin

  const y = (v: number) => PAD_T + plotH - ((v - yMin) / yRange) * plotH

  const trajPoints = trajectory.length
    ? trajectory
        .map((p, i) => {
          const x = PAD_L + plotW * (trajectory.length === 1 ? 1 : i / (trajectory.length - 1))
          const yv = PAD_T + plotH - 4 - ((p.balance - Math.min(...trajectory.map((q) => q.balance))) /
            Math.max(0.000001, Math.max(...trajectory.map((q) => q.balance)) - Math.min(...trajectory.map((q) => q.balance)))) * (plotH - 8)
          return `${x},${yv}`
        })
        .join(' ')
    : ''

  const fmt = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 })

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
        <div className="stat">
          <span className="label">Received</span>
          <span className="value green">+{fmt(data.stats.totalIn)}</span>
        </div>
        <div className="stat">
          <span className="label">Sent</span>
          <span className="value red">−{fmt(data.stats.totalOut)}</span>
        </div>
        <div className="stat">
          <span className="label">Net flow</span>
          <span className={`value ${data.stats.net >= 0 ? 'green' : 'red'}`}>
            {data.stats.net >= 0 ? '+' : '−'}
            {fmt(Math.abs(data.stats.net))}
          </span>
        </div>
        <div className="stat">
          <span className="label">Txs</span>
          <span className="value">{data.stats.count}</span>
        </div>
      </div>

      <div className="card chart-card">
        <span className="label">Daily net flow (NIM)</span>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Daily net flow chart">
          {/* zero line */}
          <line x1={PAD_L} y1={y(0)} x2={W - 4} y2={y(0)} stroke="#3a3f52" strokeWidth="1" />
          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={PAD_L}
              y1={y(yMin + yRange * f)}
              x2={W - 4}
              y2={y(yMin + yRange * f)}
              stroke="#222634"
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
                  fill={net >= 0 ? '#3ddc84' : '#ff5c5c'}
                  opacity="0.9"
                >
                  <title>{`${p.label}: ${formatLuna(Math.abs(net) * 100000, lang)} NIM ${net >= 0 ? 'received' : 'sent'}`}</title>
                </rect>
                {n <= 16 && (
                  <text x={x + barW / 2} y={H - 6} fontSize="8" fill="#8b90a0" textAnchor="middle">
                    {p.label}
                  </text>
                )}
              </g>
            )
          })}
          {/* y labels */}
          <text x={PAD_L - 6} y={y(yMax) + 3} fontSize="8" fill="#8b90a0" textAnchor="end">
            {fmt(yMax)}
          </text>
          <text x={PAD_L - 6} y={y(yMin) + 3} fontSize="8" fill="#8b90a0" textAnchor="end">
            {fmt(yMin)}
          </text>
          <text x={PAD_L - 6} y={y(0) + 3} fontSize="8" fill="#8b90a0" textAnchor="end">
            0
          </text>
        </svg>
      </div>

      {trajectory.length > 1 && (
        <div className="card chart-card">
          <span className="label">Balance trajectory (NIM, from history)</span>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Balance trajectory chart">
            <polyline points={trajPoints} fill="none" stroke="#e9a23b" strokeWidth="2" strokeLinejoin="round" />
            {/* area fill */}
            <polygon points={`${PAD_L},${PAD_T + plotH} ${trajPoints} ${W - 4},${PAD_T + plotH}`} fill="#e9a23b" opacity="0.08" />
            <text x={PAD_L - 6} y={PAD_T + 10} fontSize="8" fill="#8b90a0" textAnchor="end">
              {fmt(Math.max(...trajectory.map((q) => q.balance)))}
            </text>
            <text x={PAD_L - 6} y={PAD_T + plotH - 4} fontSize="8" fill="#8b90a0" textAnchor="end">
              {fmt(Math.min(...trajectory.map((q) => q.balance)))}
            </text>
          </svg>
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

      <p className="hint small">Based on the loaded transaction history (up to 50 txs).</p>
    </section>
  )
}

// Yield calculator sheet: amount, pool and horizon in; rewards out, month by
// month. Same projection as the Earn card (lib/yieldCalc), so the two can't
// disagree. Pure SVG like Analytics: one series (cumulative rewards), a
// crosshair on hover/touch, and a year-by-year table that doubles as the
// chart's text view.

import { useMemo, useState, type PointerEvent } from 'react'
import DetailSheet from './DetailSheet'
import { formatFiat, type CurrencyCode, type ValidatorInfo } from './lib/chain'
import { compoundsFor, projectStake, typicalRate } from './lib/yieldCalc'

const W = 320
const H = 140
const PAD_L = 40
const PAD_R = 8
const PAD_T = 10
const PAD_B = 18
const plotW = W - PAD_L - PAD_R
const plotH = H - PAD_T - PAD_B

const TYPICAL = 'typical'
const HORIZONS = [1, 3, 5] as const

const nimFmt = (n: number, lang: string, max = 2) => n.toLocaleString(lang, { maximumFractionDigits: max })

export default function YieldCalculator({
  validators,
  loading,
  initialAmountNim,
  initialValidator,
  nimPrice,
  currency,
  lang,
  onClose,
  onStake,
}: {
  validators: ValidatorInfo[]
  loading: boolean
  initialAmountNim: number
  /** The delegated pool's address; omitted for someone not yet staking (starts on "typical"). */
  initialValidator: string | null
  nimPrice: number
  currency: CurrencyCode
  lang: string
  onClose: () => void
  /** Opens the stake panel with this amount (and pool, unless "typical"); omitted when staking isn't possible here. */
  onStake?: (amountNim: number, validatorAddress: string | null) => void
}) {
  const [amount, setAmount] = useState(initialAmountNim > 0 ? String(Math.round(initialAmountNim * 100) / 100) : '1000')
  const [pool, setPool] = useState<string>(initialValidator ?? TYPICAL)
  const [years, setYears] = useState<(typeof HORIZONS)[number]>(1)
  const [hover, setHover] = useState<number | null>(null)

  const producing = useMemo(
    () => validators.filter((v) => v.reliability !== null && v.annualReward !== null && v.annualReward > 0),
    [validators]
  )
  const chosen = pool === TYPICAL ? null : (validators.find((v) => v.address === pool) ?? null)
  const rate = chosen ? chosen.annualReward : typicalRate(validators)
  // The typical case assumes a restaking pool, which most are.
  const compound = chosen ? compoundsFor(chosen) : true
  const amountNim = Number(amount.replace(/,/g, ''))
  const amountOk = Number.isFinite(amountNim) && amountNim > 0

  const proj = useMemo(
    () =>
      rate !== null && amountOk
        ? projectStake({ principalNim: amountNim, annualRateNow: rate, months: years * 12, compound })
        : null,
    [rate, amountOk, amountNim, years, compound]
  )

  const maxR = proj ? Math.max(proj.rewardsNim, 1e-9) : 1
  const x = (m: number) => PAD_L + (m / (years * 12)) * plotW
  const y = (r: number) => PAD_T + plotH - (r / maxR) * plotH
  const line = proj ? proj.points.map((p) => `${x(p.month).toFixed(1)},${y(p.rewardsNim).toFixed(1)}`).join(' ') : ''
  const shownPoint = proj ? proj.points[hover ?? proj.points.length - 1] : null

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!proj) return
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const m = Math.round(((px - PAD_L) / plotW) * years * 12)
    setHover(Math.max(0, Math.min(years * 12, m)))
  }

  const yearRows = proj
    ? Array.from({ length: years }, (_, i) => {
        const end = proj.points[(i + 1) * 12]
        const start = proj.points[i * 12]
        return { year: i + 1, earned: end.rewardsNim - start.rewardsNim, total: end.balanceNim }
      })
    : []

  return (
    <DetailSheet title="Yield calculator" onClose={onClose}>
      <div className="calc-form">
        <label className="label" htmlFor="calcAmount">
          Amount (NIM)
        </label>
        <input
          id="calcAmount"
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label className="label" htmlFor="calcPool">
          Validator
        </label>
        <select id="calcPool" className="input" value={pool} onChange={(e) => setPool(e.target.value)}>
          <option value={TYPICAL}>Typical pool (median of {producing.length || '…'})</option>
          {producing.map((v) => (
            <option key={v.address} value={v.address}>
              {v.name}: {((v.annualReward ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% · fee{' '}
              {((v.fee ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 1 })}%
            </option>
          ))}
        </select>

        <div className="period-switch calc-horizons" role="group" aria-label="Time horizon">
          {HORIZONS.map((h) => (
            <button
              key={h}
              className={h === years ? 'period active' : 'period'}
              aria-pressed={h === years}
              onClick={() => {
                setYears(h)
                setHover(null)
              }}
            >
              {h} {h === 1 ? 'year' : 'years'}
            </button>
          ))}
        </div>
      </div>

      {loading && validators.length === 0 ? (
        <p className="hint">Loading validator yields…</p>
      ) : rate === null ? (
        <p className="hint">Validator yields are unavailable right now. Try again shortly.</p>
      ) : !amountOk ? (
        <p className="hint">Enter an amount to see what it earns.</p>
      ) : (
        proj && (
          <>
            <div className="calc-result">
              <p className="earn-hero">
                ≈ {nimFmt(proj.rewardsNim, lang)} NIM
                <span className="earn-unit">
                  {' '}
                  in {years} {years === 1 ? 'year' : 'years'}
                </span>
              </p>
              <p className="hint small">
                {(rate * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% p.a. today
                {compound ? ', rewards restaked' : ', rewards paid out'}
                {nimPrice > 0 ? ` · ${formatFiat(proj.rewardsNim * nimPrice, currency)} at today's price` : ''}
              </p>
            </div>

            <div className="chart-card calc-chart">
              <span className="label">Rewards earned (NIM)</span>
              <p className="calc-readout" aria-live="polite">
                {shownPoint &&
                  (shownPoint.month === 0
                    ? 'Today: 0 NIM'
                    : `Month ${shownPoint.month}: ${nimFmt(shownPoint.rewardsNim, lang)} NIM earned`)}
              </p>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="chart"
                role="img"
                aria-label={`Rewards earned over ${years} ${years === 1 ? 'year' : 'years'}, rising to ${nimFmt(proj.rewardsNim, lang)} NIM`}
                onPointerMove={onMove}
                onPointerDown={onMove}
                onPointerLeave={() => setHover(null)}
              >
                <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD_L - 6} y={PAD_T + 8} fontSize="8" fill="var(--muted)" textAnchor="end">
                  {nimFmt(proj.rewardsNim, lang, 0)}
                </text>
                <text x={PAD_L - 6} y={PAD_T + plotH} fontSize="8" fill="var(--muted)" textAnchor="end">
                  0
                </text>
                {Array.from({ length: years + 1 }, (_, i) => (
                  <text key={i} x={x(i * 12)} y={H - 4} fontSize="8" fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === years ? 'end' : 'middle'}>
                    {i === 0 ? 'now' : `${i}y`}
                  </text>
                ))}
                <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
                {hover !== null && shownPoint && (
                  <>
                    <line x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + plotH} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 2" />
                    <circle cx={x(hover)} cy={y(shownPoint.rewardsNim)} r="4" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
                  </>
                )}
              </svg>
            </div>

            <table className="calc-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Earned</th>
                  <th scope="col">{compound ? 'Staked at year end' : 'Staked'}</th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map((r) => (
                  <tr key={r.year}>
                    <td>{r.year}</td>
                    <td>+{nimFmt(r.earned, lang)}</td>
                    <td>{nimFmt(r.total, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {onStake && (
              <button className="btn-primary" onClick={() => onStake(amountNim, chosen?.address ?? null)}>
                Stake {nimFmt(amountNim, lang)} NIM
              </button>
            )}
          </>
        )
      )}

      <p className="hint small dim calc-note">
        An estimate, not a promise. Rewards shrink a little every year because new NIM issuance falls by about 12% a
        year by design, and the estimate assumes the network's total stake stays as it is today: more NIM staked
        network-wide lowers everyone's rate. A pool only pays while it produces blocks.
      </p>
    </DetailSheet>
  )
}

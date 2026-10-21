// Beta yield calculator: the "New look (beta)" port of YieldCalculator.tsx,
// presented as a vaul bottom sheet. Same props, same numbers: projectStake,
// typicalRate and compoundsFor come straight from lib/yieldCalc, so classic
// and beta can never disagree. Same pool picker semantics (a real pool, or
// "typical", the median producing pool), horizons 1/3/5, the same chart
// geometry (pure SVG, restyled) and the same year table.
//
// Everything renders inside a .ui-beta host; the drawer's Radix portal is
// pointed at that host so no beta portal escapes the scoped root.

import { useMemo, useState, type PointerEvent } from 'react'
import { formatFiat, type CurrencyCode, type ValidatorInfo } from '../lib/chain'
import { compoundsFor, projectStake, typicalRate } from '../lib/yieldCalc'
import {
  Drawer,
  DrawerContent,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
} from './ui/Drawer'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'

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

export default function BetaYieldCalculator({
  validators,
  loading,
  initialAmountNim,
  initialValidator,
  nimPrice,
  currency,
  lang,
  onClose,
  onStake,
  availableNim,
  stakedNim,
  minStakeNim,
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
  /** NIM that can be staked right now (basic balance plus funds in transit). */
  availableNim: number
  /** NIM already staking (active). Above zero means the button adds to the stake. */
  stakedNim: number
  /** Protocol minimum for a first stake. */
  minStakeNim: number
}) {
  const [amount, setAmount] = useState(initialAmountNim > 0 ? String(Math.round(initialAmountNim * 100) / 100) : '1000')
  const [pool, setPool] = useState<string>(initialValidator ?? TYPICAL)
  const [years, setYears] = useState<(typeof HORIZONS)[number]>(1)
  const [hover, setHover] = useState<number | null>(null)
  // The .ui-beta host the drawer ports into (a callback ref, since the portal
  // can only render once the element exists).
  const [host, setHost] = useState<HTMLDivElement | null>(null)

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

  // The button can only ever stake what is free to stake. Whatever is already
  // staking shows up as earnings in the projection, never as an offer to stake again.
  const isStaker = stakedNim > 0
  const freeNim = Math.floor(availableNim * 100000) / 100000
  const canStake = isStaker ? freeNim >= 1 : freeNim >= minStakeNim
  const toStake = amountOk ? Math.min(amountNim, freeNim) : 0
  const stakeNote = !canStake
    ? isStaker
      ? `Your ${nimFmt(stakedNim, lang)} NIM is already staking, so this is what it earns. There is no idle NIM to add right now.`
      : `Staking starts at ${minStakeNim} NIM. You have ${nimFmt(freeNim, lang, 5)} NIM available.`
    : amountOk && amountNim > freeNim
      ? `You have ${nimFmt(freeNim, lang, 5)} NIM available to stake${isStaker ? `, on top of the ${nimFmt(stakedNim, lang)} NIM already staking` : ''}.`
      : null

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
    <div className="ui-beta" ref={setHost}>
      {host && (
        <Drawer open onOpenChange={(open) => { if (!open) onClose() }}>
          <DrawerPortal container={host}>
            <DrawerOverlay />
            <DrawerContent>
              <DrawerTitle className="tw:m-0 tw:mb-3 tw:text-[17px] tw:font-extrabold">
                Yield calculator
              </DrawerTitle>

              <div className="tw:flex tw:flex-col tw:gap-2">
                <label className="tw:text-[13px] tw:font-semibold tw:text-[var(--color-beta-muted)]" htmlFor="betaCalcAmount">
                  Amount (NIM)
                </label>
                <input
                  id="betaCalcAmount"
                  className="beta-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />

                <label className="tw:text-[13px] tw:font-semibold tw:text-[var(--color-beta-muted)]" htmlFor="betaCalcPool">
                  Validator
                </label>
                <select
                  id="betaCalcPool"
                  className="beta-input"
                  value={pool}
                  onChange={(e) => {
                    setPool(e.target.value)
                    setHover(null)
                  }}
                >
                  <option value={TYPICAL}>Typical pool (median of {producing.length || '…'})</option>
                  {producing.map((v) => (
                    <option key={v.address} value={v.address}>
                      {v.name}: {((v.annualReward ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% ·
                      fee {((v.fee ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 1 })}%
                    </option>
                  ))}
                </select>

                <Segmented
                  aria-label="Time horizon"
                  className="tw:mt-1"
                  options={HORIZONS.map((h) => ({ value: h, label: `${h} ${h === 1 ? 'year' : 'years'}` }))}
                  value={years}
                  onValueChange={(h) => {
                    setYears(h)
                    setHover(null)
                  }}
                />
              </div>

              {loading && validators.length === 0 ? (
                <p className="tw:mt-4 tw:text-[14px] tw:text-[var(--color-beta-muted)]">Loading validator yields…</p>
              ) : rate === null ? (
                <p className="tw:mt-4 tw:text-[14px] tw:text-[var(--color-beta-muted)]">
                  Validator yields are unavailable right now. Try again shortly.
                </p>
              ) : !amountOk ? (
                <p className="tw:mt-4 tw:text-[14px] tw:text-[var(--color-beta-muted)]">
                  Enter an amount to see what it earns.
                </p>
              ) : (
                proj && (
                  <>
                    <div className="tw:mt-3">
                      <p className="tw:m-0 tw:text-[30px] tw:font-extrabold tw:leading-tight" data-probe="calc-total">
                        ≈ {nimFmt(proj.rewardsNim, lang)} NIM
                        <span className="tw:text-[15px] tw:font-semibold tw:text-[var(--color-beta-muted)]">
                          {' '}
                          in {years} {years === 1 ? 'year' : 'years'}
                        </span>
                      </p>
                      <p className="tw:m-0 tw:mt-1 tw:text-[13px] tw:text-[var(--color-beta-muted)]">
                        {(rate * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% p.a. today
                        {compound ? ', rewards restaked' : ', rewards paid out'}
                        {nimPrice > 0 ? ` · ${formatFiat(proj.rewardsNim * nimPrice, currency)} at today's price` : ''}
                      </p>
                    </div>

                    <div className="tw:mt-3 tw:rounded-xl tw:bg-[var(--color-beta-card-2)] tw:p-3">
                      <p className="tw:m-0 tw:text-[11px] tw:font-bold tw:uppercase tw:tracking-wide tw:text-[var(--color-beta-muted)]">
                        Rewards earned (NIM)
                      </p>
                      <p className="tw:m-0 tw:mb-1 tw:text-[13px] tw:text-[var(--color-beta-muted)]" aria-live="polite">
                        {shownPoint &&
                          (shownPoint.month === 0
                            ? 'Today: 0 NIM'
                            : `Month ${shownPoint.month}: ${nimFmt(shownPoint.rewardsNim, lang)} NIM earned`)}
                      </p>
                      <svg
                        viewBox={`0 0 ${W} ${H}`}
                        className="tw:block tw:h-auto tw:w-full"
                        role="img"
                        aria-label={`Rewards earned over ${years} ${years === 1 ? 'year' : 'years'}, rising to ${nimFmt(proj.rewardsNim, lang)} NIM`}
                        onPointerMove={onMove}
                        onPointerDown={onMove}
                        onPointerLeave={() => setHover(null)}
                      >
                        <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="var(--color-beta-border)" strokeWidth="1" />
                        <text x={PAD_L - 6} y={PAD_T + 8} fontSize="8" fill="var(--color-beta-muted)" textAnchor="end">
                          {nimFmt(proj.rewardsNim, lang, 0)}
                        </text>
                        <text x={PAD_L - 6} y={PAD_T + plotH} fontSize="8" fill="var(--color-beta-muted)" textAnchor="end">
                          0
                        </text>
                        {Array.from({ length: years + 1 }, (_, i) => (
                          <text
                            key={i}
                            x={x(i * 12)}
                            y={H - 4}
                            fontSize="8"
                            fill="var(--color-beta-muted)"
                            textAnchor={i === 0 ? 'start' : i === years ? 'end' : 'middle'}
                          >
                            {i === 0 ? 'now' : `${i}y`}
                          </text>
                        ))}
                        <polyline points={line} fill="none" stroke="var(--beta-gold-light)" strokeWidth="2" strokeLinejoin="round" />
                        {hover !== null && shownPoint && (
                          <>
                            <line
                              x1={x(hover)}
                              y1={PAD_T}
                              x2={x(hover)}
                              y2={PAD_T + plotH}
                              stroke="var(--color-beta-muted)"
                              strokeWidth="1"
                              strokeDasharray="2 2"
                            />
                            <circle cx={x(hover)} cy={y(shownPoint.rewardsNim)} r="4" fill="var(--beta-gold-light)" stroke="var(--color-beta-card)" strokeWidth="2" />
                          </>
                        )}
                      </svg>
                    </div>

                    <table className="beta-calc-table" data-probe="calc-table">
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

                    {onStake && stakeNote && (
                      <p className="tw:mt-3 tw:text-[13px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">{stakeNote}</p>
                    )}
                    {onStake && canStake && (
                      <Button
                        variant="primary"
                        className="tw:mt-2 tw:w-full"
                        onClick={() => onStake(toStake, chosen?.address ?? null)}
                      >
                        {isStaker ? `Add ${nimFmt(toStake, lang)} NIM to your stake` : `Stake ${nimFmt(toStake, lang)} NIM`}
                      </Button>
                    )}
                  </>
                )
              )}

              <p className="tw:mt-4 tw:text-[12px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">
                An estimate, not a promise. Rewards shrink a little every year because new NIM issuance falls by about
                12% a year by design, and the estimate assumes the network's total stake stays as it is today: more NIM
                staked network-wide lowers everyone's rate. A pool only pays while it produces blocks.
              </p>
            </DrawerContent>
          </DrawerPortal>
        </Drawer>
      )}
    </div>
  )
}
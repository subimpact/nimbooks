// Earn card: the first thing on Overview. Says what the wallet earns now (or
// could earn), in NIM a year, and puts staking one tap away.
//
// The rate is the delegated pool's own net yield for a staker, and the median
// pool's for someone not yet staking (lib/yieldCalc.typicalRate), so the card
// never points a newcomer at one validator. Numbers come from projectStake, so
// they include this year's emission decline and, for restaking pools,
// compounding: the same maths as the calculator behind "See the maths".

import { formatFiat, type CurrencyCode } from './lib/chain'
import { projectStake } from './lib/yieldCalc'

const nimFmt = (n: number, lang: string, max = 2) => n.toLocaleString(lang, { maximumFractionDigits: max })
const pct = (r: number, lang: string) => (r * 100).toLocaleString(lang, { maximumFractionDigits: 2 })

export default function EarnCard({
  stakedNim,
  idleNim,
  hasStaker,
  rate,
  validatorName,
  compound,
  minStakeNim,
  nimPrice,
  currency,
  lang,
  onStake,
  onCalculator,
  lastVisitMs = null,
  rewardsSinceVisit = null,
  trailing = null,
  validatorEarnings = [],
}: {
  /** Active stake, NIM. */
  stakedNim: number
  /** Available to stake now (basic balance plus funds in transit), NIM. */
  idleNim: number
  hasStaker: boolean
  /** Net yield as a fraction; the pool's own for a staker, the median pool's otherwise. Null while loading. */
  rate: number | null
  /** The delegated pool, when known. */
  validatorName: string | null
  compound: boolean
  minStakeNim: number
  nimPrice: number
  currency: CurrencyCode
  lang: string
  onStake: () => void
  onCalculator: () => void
  /** When this account was previously seen (ms). Null on a first visit: nothing to compare against. */
  lastVisitMs?: number | null
  /** Rewards earned since `lastVisitMs`, or null before the history has loaded; `complete` is false while a chunk failed. */
  rewardsSinceVisit?: { ms: number; nim: number; days: number; loaded: boolean; complete: boolean } | null
  /** Actual trailing yield, or null while too little reward history exists. */
  trailing?: { rate: number; windowDays: number } | null
  /** All-time earnings per validator, largest first. */
  validatorEarnings?: readonly { address: string; name: string; nim: number; firstMs: number; lastMs: number }[]
}) {
  const yearOf = (nim: number) =>
    rate === null ? null : projectStake({ principalNim: nim, annualRateNow: rate, months: 12, compound }).firstYearNim
  const stakedYear = hasStaker ? yearOf(stakedNim) : null
  const idleYear = idleNim >= 1 ? yearOf(idleNim) : null
  // Below 1 NIM idle there is nothing worth suggesting; a first stake also
  // needs the protocol minimum.
  const canStartStaking = idleNim >= minStakeNim
  const showIdle = idleYear !== null && (hasStaker ? idleNim >= 1 : canStartStaking)
  const fiat = (nim: number) => (nimPrice > 0 ? ` ≈ ${formatFiat(nim * nimPrice, currency)}` : '')

  return (
    <div className="card earn-card" data-learn="earn" data-tour="earn">
      <div className="earn-head">
        <span className="label">{hasStaker ? 'Earning' : 'Earn with your NIM'}</span>
        {rate !== null && (
          <span className="earn-rate">
            {pct(rate, lang)}% p.a.{hasStaker ? '' : ' typical'}
            {trailing !== null && hasStaker && (
              <span className="earn-actual">Actual: {pct(trailing.rate, lang)}% p.a. over the last {trailing.windowDays} days</span>
            )}
          </span>
        )}
      </div>

      {hasStaker ? (
        <>
          <p className="earn-hero">
            {stakedYear === null ? '…' : `≈ ${nimFmt(stakedYear, lang)} NIM`}
            <span className="earn-unit"> a year</span>
          </p>
          <p className="hint small">
            {nimFmt(stakedNim, lang)} NIM staked{validatorName ? ` with ${validatorName}` : ''}
            {stakedYear !== null && fiat(stakedYear) ? ` · ${fiat(stakedYear).trim()} a year at today's price` : ''}
          </p>
          {/* Why to come back: what was earned since the previous visit. A
              reward history still arriving (or a quiet week, 0 NIM) says
              nothing rather than something wrong. */}
          {rewardsSinceVisit && lastVisitMs !== null && rewardsSinceVisit.loaded && rewardsSinceVisit.nim > 0 && (
            <p className="earn-since">
              Since your last visit on {new Date(lastVisitMs).toLocaleDateString(lang)}: +{nimFmt(rewardsSinceVisit.nim, lang)} NIM in
              rewards{rewardsSinceVisit.complete ? '' : ' (some reward history is still loading)'}
            </p>
          )}
        </>
      ) : canStartStaking ? (
        <>
          <p className="earn-hero">
            {idleYear === null ? '…' : `≈ ${nimFmt(idleYear, lang)} NIM`}
            <span className="earn-unit"> a year</span>
          </p>
          <p className="hint small">
            What your {nimFmt(idleNim, lang)} NIM could earn staked
            {idleYear !== null && fiat(idleYear) ? ` (${fiat(idleYear).trim()} at today's price)` : ''}. It stays yours,
            and you can unstake any time.
          </p>
        </>
      ) : (
        <p className="hint small">
          Staking starts at {minStakeNim} NIM.
          {rate !== null &&
            ` At a typical ${pct(rate, lang)}% p.a., ${minStakeNim} NIM earns about ${nimFmt(yearOf(minStakeNim) ?? 0, lang)} NIM a year.`}
        </p>
      )}

      {/* Where the rewards came from: one row per paying validator. */}
      {validatorEarnings.length > 0 && (
        <details className="earn-validators">
          <summary>Earned per validator</summary>
          <ul>
            {validatorEarnings.map((v) => (
              <li key={v.address}>
                <span className="earn-validator-name">{v.name}</span>
                <span className="earn-validator-amount">
                  {nimFmt(v.nim, lang, 4)} NIM
                  <span className="dim"> · </span>
                  {new Date(v.firstMs).toLocaleDateString(lang)} to {new Date(v.lastMs).toLocaleDateString(lang)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasStaker && showIdle && idleYear !== null && (
        <p className="earn-idle">
          <strong>{nimFmt(idleNim, lang)} NIM</strong> is sitting idle and could add ≈ {nimFmt(idleYear, lang)} NIM a
          year.
        </p>
      )}

      <div className="earn-actions">
        {(hasStaker ? idleNim >= 1 : canStartStaking) && (
          <button className="btn-primary" onClick={onStake}>
            {hasStaker ? 'Stake idle NIM' : 'Start earning'}
          </button>
        )}
        <button className="btn-link-inline" onClick={onCalculator}>
          See the maths
        </button>
      </div>
    </div>
  )
}

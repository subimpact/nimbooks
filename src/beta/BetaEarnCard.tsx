// Beta Earn card: the "New look (beta)" port of EarnCard.tsx. Same props, same
// numbers (projectStake via lib/yieldCalc), same conditions for every line:
// since-last-visit, actual yield, per-validator earnings, the idle nudge, the
// stake button and the link into the calculator. Only the presentation
// differs: Tailwind classes on the beta tokens, all inside a .ui-beta root.
//
// The beta chunk also carries this card's markup, so this file must never
// import anything that lives in the main bundle's render path beyond shared
// libs (lib/chain, lib/yieldCalc) and the beta UI kit.

import { formatFiat, type CurrencyCode } from '../lib/chain'
import { projectStake } from '../lib/yieldCalc'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardLabel } from './ui/Card'

const nimFmt = (n: number, lang: string, max = 2) => n.toLocaleString(lang, { maximumFractionDigits: max })
const pct = (r: number, lang: string) => (r * 100).toLocaleString(lang, { maximumFractionDigits: 2 })

export default function BetaEarnCard({
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
    <Card
      className="ui-beta tw:w-full"
      data-learn="earn"
      data-tour="earn"
    >
      <CardHeader>
        <CardLabel>{hasStaker ? 'Earning' : 'Earn with your NIM'}</CardLabel>
        {rate !== null && (
          <Badge variant="gold">
            {pct(rate, lang)}% p.a.{hasStaker ? '' : ' typical'}
          </Badge>
        )}
      </CardHeader>

      {hasStaker ? (
        <>
          <CardContent>
            <p className="tw:m-0 tw:text-[30px] tw:font-extrabold tw:leading-tight tw:text-[var(--color-beta-fg)]">
              {stakedYear === null ? '…' : `≈ ${nimFmt(stakedYear, lang)} NIM`}
              <span className="tw:text-[15px] tw:font-semibold tw:text-[var(--color-beta-muted)]"> a year</span>
            </p>
            <p className="tw:m-0 tw:mt-1 tw:text-[13px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">
              {nimFmt(stakedNim, lang)} NIM staked{validatorName ? ` with ${validatorName}` : ''}
              {stakedYear !== null && fiat(stakedYear) ? ` · ${fiat(stakedYear).trim()} a year at today's price` : ''}
            </p>
            {/* Why to come back: what was earned since the previous visit. A
                reward history still arriving (or a quiet week, 0 NIM) says
                nothing rather than something wrong. */}
            {rewardsSinceVisit && lastVisitMs !== null && rewardsSinceVisit.loaded && rewardsSinceVisit.nim > 0 && (
              <p className="tw:m-0 tw:mt-2 tw:text-[13px] tw:font-semibold tw:text-[var(--color-beta-green)]">
                Since your last visit on {new Date(lastVisitMs).toLocaleDateString(lang)}: +
                {nimFmt(rewardsSinceVisit.nim, lang)} NIM in rewards
                {rewardsSinceVisit.complete ? '' : ' (some reward history is still loading)'}
              </p>
            )}
            {trailing !== null && hasStaker && (
              <p className="tw:m-0 tw:mt-2 tw:text-[13px] tw:text-[var(--color-beta-muted)]">
                Actual: {pct(trailing.rate, lang)}% p.a. over the last {trailing.windowDays} days
              </p>
            )}
          </CardContent>
        </>
      ) : canStartStaking ? (
        <CardContent>
          <p className="tw:m-0 tw:text-[30px] tw:font-extrabold tw:leading-tight tw:text-[var(--color-beta-fg)]">
            {idleYear === null ? '…' : `≈ ${nimFmt(idleYear, lang)} NIM`}
            <span className="tw:text-[15px] tw:font-semibold tw:text-[var(--color-beta-muted)]"> a year</span>
          </p>
          <p className="tw:m-0 tw:mt-1 tw:text-[13px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">
            What your {nimFmt(idleNim, lang)} NIM could earn staked
            {idleYear !== null && fiat(idleYear) ? ` (${fiat(idleYear).trim()} at today's price)` : ''}. It stays
            yours, and you can unstake any time.
          </p>
        </CardContent>
      ) : (
        <CardContent>
          <p className="tw:m-0 tw:text-[13px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">
            Staking starts at {minStakeNim} NIM.
            {rate !== null &&
              ` At a typical ${pct(rate, lang)}% p.a., ${minStakeNim} NIM earns about ${nimFmt(
                yearOf(minStakeNim) ?? 0,
                lang
              )} NIM a year.`}
          </p>
        </CardContent>
      )}

      {/* Where the rewards came from: one row per paying validator. */}
      {validatorEarnings.length > 0 && (
        <details className="beta-earn-validators">
          <summary>Earned per validator</summary>
          <ul>
            {validatorEarnings.map((v) => (
              <li key={v.address}>
                <span>{v.name}</span>
                <span>
                  {nimFmt(v.nim, lang, 4)} NIM · {new Date(v.firstMs).toLocaleDateString(lang)} to{' '}
                  {new Date(v.lastMs).toLocaleDateString(lang)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasStaker && showIdle && idleYear !== null && (
        <p className="tw:m-0 tw:mb-3 tw:rounded-xl tw:bg-[var(--color-beta-card-2)] tw:px-3 tw:py-2 tw:text-[13px] tw:leading-relaxed tw:text-[var(--color-beta-muted)]">
          <strong className="tw:text-[var(--color-beta-fg)]">{nimFmt(idleNim, lang)} NIM</strong> is sitting idle and
          could add ≈ {nimFmt(idleYear, lang)} NIM a year.
        </p>
      )}

      <div className="tw:mt-3 tw:flex tw:items-center tw:gap-3">
        {(hasStaker ? idleNim >= 1 : canStartStaking) && (
          <Button variant="primary" className="tw:flex-1" onClick={onStake}>
            {hasStaker ? 'Stake idle NIM' : 'Start earning'}
          </Button>
        )}
        <Button variant="link" onClick={onCalculator}>
          See the maths
        </Button>
      </div>
    </Card>
  )
}
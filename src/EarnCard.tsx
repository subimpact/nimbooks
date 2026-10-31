// Earn card: the first thing on Overview. Says what the wallet earns now (or
// could earn), in NIM a year, and puts staking one tap away.
//
// The rate is the delegated pool's own net yield for a staker, and the median
// pool's for someone not yet staking (lib/yieldCalc.typicalRate), so the card
// never points a newcomer at one validator. Numbers come from projectStake, so
// they include this year's emission decline and, for restaking pools,
// compounding: the same maths as the calculator behind "See the maths".

import { useEffect, useRef, useState } from 'react'
import { formatFiat, type CurrencyCode } from './lib/chain'
import { projectStake } from './lib/yieldCalc'
import type { StakeTerms } from './lib/earnTerms'
import { VALIDATOR_HEALTH_INFO, type ValidatorHealthLine } from './lib/validatorHealth'
import InfoIcon from './InfoIcon'

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
  terms = null,
  payoutType,
  scheduleLabel = null,
  restakeGainNim = null,
  inNimiqPay = false,
  reminder = null,
  validatorHealth = null,
  onUnstake,
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
  /** The four staking-terms rows, or null while there is nothing to say. */
  terms?: StakeTerms | null
  /** How the pool pays rewards ('restake' | 'direct' | 'none' | undefined). */
  payoutType?: string
  /** Human label for the pool's payout schedule (lib/earnTerms). */
  scheduleLabel?: string | null
  /** What restaking rewards adds over a year, NIM. Only for a direct pool. */
  restakeGainNim?: number | null
  /** Inside Nimiq Pay's WebView: downloads do not work, clipboard does. */
  inNimiqPay?: boolean
  /** Weekly restake reminder (.ics and Google Calendar link). */
  reminder?: { ics: string; googleUrl: string } | null
  /** The delegated validator's own chain record, as one line. Null when silent. */
  validatorHealth?: ValidatorHealthLine | null
  /** Opens the Stake panel with the unstake flow unfolded (the retired line's way out). */
  onUnstake?: () => void
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

  // The restake loop (Council Cycle 3): a direct pool pays rewards into the
  // wallet, so offer the same tap that a restaking pool does on its own, and
  // say what compounding would add over a year.
  const showRestake = hasStaker && payoutType === 'direct'
  const gain = showRestake ? restakeGainNim : null
  const restakeLabel =
    showRestake && idleNim >= 1 ? `Restake ${nimFmt(idleNim, lang)} NIM` : null
  const reminderLink = showRestake ? reminder : null

  // Copy link is the only reminder path inside Pay (no file downloads); show
  // its result briefly, the way the copy buttons elsewhere do.
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const copyTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )
  const downloadReminder = () => {
    if (!reminderLink) return
    const blob = new Blob([reminderLink.ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nimbooks-restake-reminder.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const copyReminder = async () => {
    if (!reminderLink) return
    try {
      await navigator.clipboard.writeText(reminderLink.googleUrl)
      setCopyState('ok')
    } catch {
      setCopyState('fail')
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2000)
  }

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
          {/* The pool's own chain record: active, inactive, jailed or retired.
              One line, so a staker learns a bad state without hunting. */}
          {validatorHealth && (
            <p
              className={`earn-health earn-health--${validatorHealth.tone}`}
              data-probe="earn-health"
              data-health={validatorHealth.status}
            >
              {validatorHealth.tone === 'ok' && (
                <span className="earn-health-tick" aria-hidden="true">
                  ✓
                </span>
              )}
              <span className="earn-health-text">{validatorHealth.text}</span>
              <InfoIcon text={VALIDATOR_HEALTH_INFO} />
              {validatorHealth.unstake && onUnstake && (
                <button className="btn-link-inline" onClick={onUnstake}>
                  Unstake
                </button>
              )}
            </p>
          )}
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

      {terms && (
        <details className="earn-validators earn-terms-wrap" data-probe="earn-terms-toggle">
        <summary>Staking terms</summary>
        <dl className="earn-terms" data-probe="earn-terms" data-schedule={scheduleLabel ?? undefined}>
          <div>
            <dt>How it works</dt>
            <dd>{terms.howItWorks}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd>{terms.rate}</dd>
          </div>
          <div>
            <dt>What can go wrong</dt>
            <dd>{terms.risk}</dd>
          </div>
          <div>
            <dt>Getting out</dt>
            <dd>{terms.exit}</dd>
          </div>
        </dl>
        </details>
      )}

      {showRestake && (
        <div className="earn-restake" data-probe="earn-restake">
          <p className="earn-restake-line">
            {`${validatorName ?? 'Your pool'} pays your rewards into your wallet instead of restaking them.`}
            {gain !== null && gain >= 0.01 ? ` Restaking them adds about ${nimFmt(gain, lang)} NIM a year at today's network stake.` : ''}
          </p>
          {reminderLink && (
            <p className="earn-reminder">
              Get a weekly reminder:{' '}
              <a
                className="btn-link-inline"
                href={reminderLink.googleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Calendar
              </a>
              {inNimiqPay ? (
                <button className="btn-link-inline" onClick={copyReminder}>
                  {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy link'}
                </button>
              ) : (
                <button className="btn-link-inline" onClick={downloadReminder}>
                  Download .ics
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <div className="earn-actions">
        {(hasStaker ? idleNim >= 1 : canStartStaking) && (
          <button className="btn-primary" onClick={onStake}>
            {restakeLabel ?? (hasStaker ? 'Stake idle NIM' : 'Start earning')}
          </button>
        )}
        <button className="btn-link-inline" onClick={onCalculator}>
          See the maths
        </button>
      </div>
    </div>
  )
}

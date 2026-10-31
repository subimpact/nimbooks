// Beta Earn card content: the "New look (beta)" port of EarnCard.tsx on the
// house shadcn kit. Same props, same numbers (projectStake via lib/yieldCalc),
// same conditions for every line: since-last-visit, actual yield,
// per-validator earnings (a Collapsible with a chevron), the idle nudge, the
// stake button and the button into the calculator.
//
// Only the presentation differs. The Card shell, the title, the rate Badge and
// the collapse-to-a-summary behaviour live in BetaOverview (so the collapsible
// state has one owner); this file renders the card's innards. The card stays
// inside its own .ui-beta scope: it must import nothing beyond the shared libs
// (lib/chain, lib/yieldCalc) and the beta kit.

import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'
import { formatFiat, type CurrencyCode } from '../lib/chain'
import { projectStake } from '../lib/yieldCalc'
import type { StakeTerms } from '../lib/earnTerms'
import { VALIDATOR_HEALTH_INFO, type ValidatorHealthLine } from '../lib/validatorHealth'
import InfoIcon from '../InfoIcon'
import { Button } from './components/ui/button'
import { CardContent } from './components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './components/ui/collapsible'

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
  const canStakeIdle = hasStaker ? idleNim >= 1 : canStartStaking
  const showIdle = idleYear !== null && canStakeIdle
  const fiat = (nim: number) => (nimPrice > 0 ? ` ≈ ${formatFiat(nim * nimPrice, currency)}` : '')

  // The restake loop (Council Cycle 3), identical conditions to the classic
  // card: a direct pool pays rewards into the wallet, so offer the restake tap
  // and say what compounding would add over a year.
  const showRestake = hasStaker && payoutType === 'direct'
  const gain = showRestake ? restakeGainNim : null
  const restakeLabel = showRestake && idleNim >= 1 ? `Restake ${nimFmt(idleNim, lang)} NIM` : null
  const reminderLink = showRestake ? reminder : null
  const reminderLinkClass =
    'tw:text-xs tw:font-semibold tw:text-accent-foreground tw:underline tw:underline-offset-2'

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
    <CardContent className="tw:flex tw:flex-col tw:gap-2">
      {hasStaker ? (
        <>
          <p className="tw:m-0 tw:text-3xl tw:font-semibold tw:tracking-tight" data-probe="earn-year">
            {stakedYear === null ? '…' : `≈ ${nimFmt(stakedYear, lang)} NIM`}
            <span className="tw:text-sm tw:font-normal tw:text-muted-foreground"> a year</span>
          </p>
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            {nimFmt(stakedNim, lang)} NIM staked{validatorName ? ` with ${validatorName}` : ''}
            {stakedYear !== null && fiat(stakedYear) ? ` · ${fiat(stakedYear).trim()} a year at today's price` : ''}
          </p>
          {/* The pool's own chain record, the same line the classic card shows. */}
          {validatorHealth && (
            <p
              data-probe="earn-health"
              data-health={validatorHealth.status}
              className={
                validatorHealth.tone === 'warn'
                  ? 'tw:m-0 tw:flex tw:flex-wrap tw:items-baseline tw:gap-1.5 tw:text-sm tw:font-semibold tw:text-primary'
                  : 'tw:m-0 tw:flex tw:flex-wrap tw:items-baseline tw:gap-1.5 tw:text-sm tw:text-muted-foreground'
              }
            >
              {validatorHealth.tone === 'ok' && (
                <CheckIcon
                  aria-hidden="true"
                  className="tw:size-3.5 tw:shrink-0 tw:self-center tw:text-emerald-600 tw:dark:text-emerald-400"
                />
              )}
              <span className="tw:min-w-0" data-probe="earn-health-text">{validatorHealth.text}</span>
              <InfoIcon text={VALIDATOR_HEALTH_INFO} />
              {validatorHealth.unstake && onUnstake && (
                <button type="button" className={reminderLinkClass} onClick={onUnstake}>
                  Unstake
                </button>
              )}
            </p>
          )}
          {/* Why to come back: what was earned since the previous visit. A
              reward history still arriving (or a quiet week, 0 NIM) says
              nothing rather than something wrong. */}
          {rewardsSinceVisit && lastVisitMs !== null && rewardsSinceVisit.loaded && rewardsSinceVisit.nim > 0 && (
            <p className="tw:m-0 tw:text-sm tw:font-medium" data-probe="earn-since">
              Since your last visit on {new Date(lastVisitMs).toLocaleDateString(lang)}: +{nimFmt(rewardsSinceVisit.nim, lang)} NIM in
              rewards{rewardsSinceVisit.complete ? '' : ' (some reward history is still loading)'}
            </p>
          )}
          {trailing !== null && hasStaker && (
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
              Actual: {pct(trailing.rate, lang)}% p.a. over the last {trailing.windowDays} days
            </p>
          )}
        </>
      ) : canStartStaking ? (
        <>
          <p className="tw:m-0 tw:text-3xl tw:font-semibold tw:tracking-tight" data-probe="earn-year">
            {idleYear === null ? '…' : `≈ ${nimFmt(idleYear, lang)} NIM`}
            <span className="tw:text-sm tw:font-normal tw:text-muted-foreground"> a year</span>
          </p>
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            What your {nimFmt(idleNim, lang)} NIM could earn staked
            {idleYear !== null && fiat(idleYear) ? ` (${fiat(idleYear).trim()} at today's price)` : ''}. It stays yours,
            and you can unstake any time.
          </p>
        </>
      ) : (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground" data-probe="earn-year">
          Staking starts at {minStakeNim} NIM.
          {rate !== null &&
            ` At a typical ${pct(rate, lang)}% p.a., ${minStakeNim} NIM earns about ${nimFmt(
              yearOf(minStakeNim) ?? 0,
              lang
            )} NIM a year.`}
        </p>
      )}

      {/* Where the rewards came from: one row per paying validator. */}
      {validatorEarnings.length > 0 && (
        <Collapsible className="tw:group/earn-validators tw:text-sm">
          <CollapsibleTrigger className="tw:flex tw:min-h-[44px] tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:text-muted-foreground">
            Earned per validator
            <ChevronDownIcon className="tw:size-4 tw:transition-transform tw:group-data-open/earn-validators:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="tw:mt-1 tw:divide-y tw:divide-border">
              {validatorEarnings.map((v) => (
                <li key={v.address} className="tw:flex tw:justify-between tw:gap-3 tw:py-2">
                  <span className="tw:font-medium">{v.name}</span>
                  <span className="tw:text-right tw:text-muted-foreground">
                    {nimFmt(v.nim, lang, 4)} NIM
                    <br />· {new Date(v.firstMs).toLocaleDateString(lang)} to {new Date(v.lastMs).toLocaleDateString(lang)}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {hasStaker && showIdle && idleYear !== null && (
        <p className="tw:m-0 tw:rounded-lg tw:bg-muted tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
          <strong className="tw:font-semibold tw:text-foreground">{nimFmt(idleNim, lang)} NIM</strong> is sitting idle and
          could add ≈ {nimFmt(idleYear, lang)} NIM a year.
        </p>
      )}

      {terms && (
        <Collapsible className="tw:group/earn-terms tw:text-sm">
          <CollapsibleTrigger
            className="tw:flex tw:min-h-[44px] tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:text-muted-foreground"
            data-probe="earn-terms-toggle"
          >
            Staking terms
            <ChevronDownIcon className="tw:size-4 tw:transition-transform tw:group-data-open/earn-terms:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
        <dl
          className="tw:m-0 tw:grid tw:gap-1.5 tw:text-xs tw:text-muted-foreground"
          data-probe="earn-terms"
          data-schedule={scheduleLabel ?? undefined}
        >
          <div className="tw:grid tw:grid-cols-[96px_1fr] tw:gap-x-3">
            <dt className="tw:font-semibold tw:text-foreground">How it works</dt>
            <dd className="tw:m-0">{terms.howItWorks}</dd>
          </div>
          <div className="tw:grid tw:grid-cols-[96px_1fr] tw:gap-x-3">
            <dt className="tw:font-semibold tw:text-foreground">Rate</dt>
            <dd className="tw:m-0">{terms.rate}</dd>
          </div>
          <div className="tw:grid tw:grid-cols-[96px_1fr] tw:gap-x-3">
            <dt className="tw:font-semibold tw:text-foreground">What can go wrong</dt>
            <dd className="tw:m-0">{terms.risk}</dd>
          </div>
          <div className="tw:grid tw:grid-cols-[96px_1fr] tw:gap-x-3">
            <dt className="tw:font-semibold tw:text-foreground">Getting out</dt>
            <dd className="tw:m-0">{terms.exit}</dd>
          </div>
        </dl>
          </CollapsibleContent>
        </Collapsible>
      )}

      {showRestake && (
        <div className="tw:grid tw:gap-1" data-probe="earn-restake">
          <p className="tw:m-0 tw:text-sm">
            {`${validatorName ?? 'Your pool'} pays your rewards into your wallet instead of restaking them.`}
            {gain !== null && gain >= 0.01 ? ` Restaking them adds about ${nimFmt(gain, lang)} NIM a year at today's network stake.` : ''}
          </p>
          {reminderLink && (
            <p className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground">
              Get a weekly reminder:{' '}
              <a
                className={reminderLinkClass}
                href={reminderLink.googleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Calendar
              </a>
              {inNimiqPay ? (
                <button className={reminderLinkClass} onClick={copyReminder}>
                  {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy link'}
                </button>
              ) : (
                <button className={reminderLinkClass} onClick={downloadReminder}>
                  Download .ics
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        {canStakeIdle && (
          // The one gold action on this screen: staking.
          <Button className="tw:min-h-[44px] tw:flex-1" onClick={onStake} data-probe="earn-stake">
            {restakeLabel ?? (hasStaker ? 'Stake idle NIM' : 'Start earning')}
          </Button>
        )}
        <Button variant="outline" className="tw:min-h-[44px]" onClick={onCalculator} data-probe="earn-maths">
          See the maths
        </Button>
      </div>
    </CardContent>
  )
}
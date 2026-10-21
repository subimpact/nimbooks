// Beta Overview: the dashboard rebuilt on the house shadcn kit. Same data and
// actions as the classic dashboard section, in this order:
//   1. Balance card - the NIM balance as the hero number, the total value in
//      the display currency under it (with the currency chip that opens the
//      classic picker), the staked / available / in-transit lines and a
//      Collapsible "Details" holding the classic balance-breakdown and
//      Addresses cards.
//   2. Earn card - the BetaEarnCard content, collapsible to a one-line
//      summary; the choice is remembered in localStorage['nimbooks:earn-collapsed'].
//   3. The "Stake it?" nudge, same condition and handlers as classic.
//   4. Quick actions: Send and Receive side by side.
// The rest of the dashboard (Analytics, count consent, banners) stays classic
// for this release and renders below this component inside .classic-in-beta.
//
// Gold discipline: at most one gold (Button default) action per screen. The
// stake button in the Earn card and the nudge's "Stake it" are gold; Send only
// joins them when no other gold action is visible above the fold. Gold is a
// fill with near-black text (10.22:1), never text on a light surface.

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDownIcon, SendIcon, LeafIcon } from 'lucide-react'

import { formatLuna, type CurrencyCode } from '../lib/chain'
import { projectStake } from '../lib/yieldCalc'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './components/ui/collapsible'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import type { EarnProps } from './betaProps'
import BetaEarnCard from './BetaEarnCard'

const EARN_COLLAPSED_KEY = 'nimbooks:earn-collapsed'

const nimFmt = (n: number, lang: string, max = 2) => n.toLocaleString(lang, { maximumFractionDigits: max })
const pct = (r: number, lang: string) => (r * 100).toLocaleString(lang, { maximumFractionDigits: 2 })

const fmtNimLine = (luna: number, lang: string) => `${formatLuna(String(luna), lang)} NIM`

export default function BetaOverview({
  lang,
  currency,
  currencyFlag,
  onCurrencyPicker,
  balanceHero,
  totalValueFiat,
  nimBalance,
  stakedLuna,
  inTransitLuna,
  earnProps,
  nudge,
  onSend,
  sendDisabled,
  onReceive,
  quickNote,
  details,
}: {
  lang: string
  currency: CurrencyCode
  /** Currency chip: the flag inside public/flags, used as an src value. */
  currencyFlag: string
  onCurrencyPicker: () => void

  /** The hero line, exactly the text the classic balance tile shows. */
  balanceHero: string
  /** The value under the hero: the total value in the display currency. */
  totalValueFiat: string
  /** Available NIM (the basic balance), or null while loading. */
  nimBalance: string | null
  /** Active stake, NIM. */
  stakedLuna: number
  /** NIM in transit (HTLC), NIM. */
  inTransitLuna: number

  /** Everything the earn card gets: the classic EarnCard props, unchanged. */
  earnProps: EarnProps

  /** The "Stake it?" nudge, same condition and handlers as classic, or null. */
  nudge: null | {
    receivedNim: number
    dateMs: number
    rate: number
    yearNim: number
    onAccept: () => void
    onDismiss: () => void
  }

  /** Quick actions. onSend is undefined only while the tour moves the page. */
  onSend: (() => void) | undefined
  sendDisabled: boolean
  onReceive: () => void
  /** The demo/readonly note under the quick action row, or null. */
  quickNote: string | null

  /** The classic Balance details and Addresses cards (wrapped in .classic-in-beta on the App side). */
  details: ReactNode
}) {
  // Collapsed earns more screen: the choice survives reloads.
  const [earnOpen, setEarnOpen] = useState(() => {
    try {
      return localStorage.getItem(EARN_COLLAPSED_KEY) !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(EARN_COLLAPSED_KEY, earnOpen ? '0' : '1')
    } catch {
      /* storage unavailable */
    }
  }, [earnOpen])

  // Gold discipline: when a gold stake action is already above the fold (the
  // earn card's stake button, or the nudge), Send steps aside to secondary.
  const earnRate = earnProps.rate
  const earnIdleYear =
    earnRate === null
      ? null
      : projectStake({
          principalNim: earnProps.idleNim,
          annualRateNow: earnRate,
          months: 12,
          compound: earnProps.compound,
        }).firstYearNim
  const canStartStaking = earnProps.idleNim >= earnProps.minStakeNim
  const goldAboveFold =
    (earnProps.hasStaker ? earnProps.idleNim >= 1 : canStartStaking) && earnIdleYear !== null
  const sendVariant: 'default' | 'secondary' = goldAboveFold ? 'secondary' : 'default'

  const earnSummary = earnProps.hasStaker
    ? `Earning ${earnRate !== null ? `${pct(earnRate, lang)}% p.a.` : '…'}${
        earnProps.rewardsSinceVisit &&
        earnProps.lastVisitMs !== null &&
        earnProps.rewardsSinceVisit.loaded &&
        earnProps.rewardsSinceVisit.nim > 0
          ? ` · +${nimFmt(earnProps.rewardsSinceVisit.nim, lang)} NIM since your last visit`
          : ''
      }`
    : `Earn with your NIM${earnRate !== null ? ` · ${pct(earnRate, lang)}% p.a. typical` : ''}`

  return (
    <div className="tw:flex tw:flex-col tw:gap-4">
      {/* 1. Balance card */}
      <Card data-probe="balance-card">
        <CardHeader>
          <CardTitle>NIM balance</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={onCurrencyPicker}
              title="Change display currency"
              aria-label="Change display currency"
            >
              <img src={`/flags/flag-${currencyFlag}.svg`} alt="" width={16} height={16} />
              {currency.toUpperCase()}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="tw:flex tw:flex-col tw:gap-2">
          <p className="tw:m-0 tw:text-3xl tw:font-semibold tw:tracking-tight" data-probe="balance-hero">
            {balanceHero}
          </p>
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Total value {totalValueFiat}</p>
          <dl className="tw:m-0 tw:mt-1 tw:grid tw:grid-cols-[auto_1fr] tw:justify-items-end tw:text-sm">
            <dt className="tw:justify-self-start tw:text-muted-foreground">Staked</dt>
            <dd className="tw:m-0">{fmtNimLine(stakedLuna, lang)}</dd>
            <dt className="tw:justify-self-start tw:text-muted-foreground">Available</dt>
            <dd className="tw:m-0">{nimBalance === null ? '…' : `${formatLuna(nimBalance, lang)} NIM`}</dd>
            {inTransitLuna > 0 && (
              <>
                <dt className="tw:justify-self-start tw:text-muted-foreground">In transit (HTLC)</dt>
                <dd className="tw:m-0">{fmtNimLine(inTransitLuna, lang)}</dd>
              </>
            )}
          </dl>
          {details && (
            <Collapsible>
              <CollapsibleTrigger className="tw:flex tw:min-h-[44px] tw:items-center tw:gap-1.5 tw:text-muted-foreground">
                Details
                <ChevronDownIcon className="tw:size-4 tw:transition-transform tw:group-data-open/collapsible:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="tw:pt-3 tw:text-sm">{details}</CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* 2. Earn card, collapsible to a one-line summary. The Card shell and
          the collapse live here; the card's content comes from BetaEarnCard. */}
      <Collapsible
        open={earnOpen}
        onOpenChange={setEarnOpen}
        data-learn="earn"
        data-probe="earn-collapsible"
        className="tw:group/earn"
      >
        <Card>
          <CardHeader>
            <CardTitle>{earnProps.hasStaker ? 'Earning' : 'Earn with your NIM'}</CardTitle>
            {/* The rate itself is the badge; the description names its source
                instead of repeating it. */}
            {earnProps.rate !== null && (
              <CardDescription>
                {earnProps.hasStaker
                  ? earnProps.validatorName
                    ? `With ${earnProps.validatorName}`
                    : 'Your current pool'
                  : 'Typical rate across producing pools'}
              </CardDescription>
            )}
            <CardAction className="tw:flex tw:items-center tw:gap-2">
              {earnProps.rate !== null && <Badge data-probe="earn-rate">{pct(earnProps.rate, lang)}% p.a.</Badge>}
              <CollapsibleTrigger
                className="tw:flex tw:size-8 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground"
                aria-label={earnOpen ? 'Collapse the earn summary' : 'Expand the earn summary'}
                data-probe="earn-toggle"
              >
                <ChevronDownIcon className="tw:size-4 tw:transition-transform tw:group-data-open/earn:rotate-180" />
              </CollapsibleTrigger>
            </CardAction>
          </CardHeader>
          {/* Collapsed: the one-line summary stands in for the content. */}
          {!earnOpen && (
            <CardContent data-probe="earn-summary" className="tw:pt-0 tw:text-sm tw:text-muted-foreground">
              {earnSummary}
            </CardContent>
          )}
          <CollapsibleContent data-probe="earn-body">
            <BetaEarnCard {...earnProps} />
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 3. "Stake it?" nudge */}
      {nudge && (
        <Alert className="tw:gap-3" data-probe="stake-nudge">
          <LeafIcon />
          <AlertTitle>Stake it?</AlertTitle>
          <AlertDescription>
            <p className="tw:m-0">
              You received {nimFmt(nudge.receivedNim, lang)} NIM on{' '}
              {new Date(nudge.dateMs).toLocaleDateString(lang)}. Stake it? At {pct(nudge.rate, lang)}% p.a. it
              could earn about {nimFmt(nudge.yearNim, lang)} NIM a year.
            </p>
            <div className="tw:mt-3 tw:flex tw:gap-2">
              <Button className="tw:min-h-[44px]" onClick={nudge.onAccept}>
                Stake it
              </Button>
              <Button variant="ghost" className="tw:min-h-[44px]" onClick={nudge.onDismiss}>
                Not now
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 4. Quick actions: the two things a wallet is for. */}
      <Card data-learn="quick-actions">
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="tw:flex tw:flex-col tw:gap-2">
          <div className="tw:flex tw:gap-2">
            <Button
              variant={sendVariant}
              className="tw:min-h-[44px] tw:flex-1"
              onClick={onSend}
              disabled={sendDisabled}
              data-probe="quick-send"
              data-tour="quick-send"
            >
              <SendIcon />
              Send NIM
            </Button>
            <Button
              variant="outline"
              className="tw:min-h-[44px] tw:flex-1"
              onClick={onReceive}
              data-probe="quick-receive"
            >
              Receive NIM
            </Button>
          </div>
          {quickNote && <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">{quickNote}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
// Beta sidebar widgets: the NIM price card, the "Where your NIM is" ring and
// the sidebar's one action, "Stake idle NIM".
//
// The widgets live inside BetaSidebar's SidebarContent, under the section
// list, and are hidden when the desktop sidebar collapses to icons (the
// `tw:group-data-[collapsible=icon]:hidden` wrapper - see components/ui/
// sidebar.tsx). On a phone the sidebar is the off-canvas Sheet, so the same
// markup renders there at full width.
//
// Every prop is optional on the shell: a caller that does not pass them (a
// future screen, a test harness) gets nothing rendered, never a crash. The
// prices and balances all come from App.tsx, which already has both; this
// component adds one read-only request (the NIM price history) and no RPC.
//
// Colour: Nimiq gold for Staked and for the sparkline, house neutrals for the
// rest of the ring. Gold is a fill or a chart stroke, never text on a light
// surface (see beta.css).

import { useEffect, useMemo, useState } from 'react'
import { LeafIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'

import { hasRate, formatFiat, type CurrencyCode } from '../lib/chain'
import {
  changePct,
  getNimPriceHistory,
  ringSegments,
  sparklinePath,
  type PricePoint,
  type PriceRange,
} from '../lib/priceHistory'
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Separator } from './components/ui/separator'
import { Skeleton } from './components/ui/skeleton'

export interface BetaPriceProps {
  /** NIM price in the display currency; NaN when the rate chain has none. */
  nim: number
  currency: CurrencyCode
  /** USD -> display-currency factor for the history points; NaN when unknown. */
  usdToCur: number
  lang: string
}

export interface BetaHoldingsProps {
  /** Basic account balance, Luna. */
  availableLuna: number
  stakedLuna: number
  /** HTLC in transit ("Moving in Nimiq Pay"), Luna. */
  movingLuna: number
  vestedLuna: number
  /** EVM side assets; amounts in whole units, fiat NaN when unpriced. */
  evm: Array<{ symbol: string; amount: number; fiat: number }>
}

export interface BetaStakeProps {
  show: boolean
  onStake: () => void
}

export interface BetaSidebarWidgetsProps {
  price?: BetaPriceProps
  holdings?: BetaHoldingsProps
  stake?: BetaStakeProps
}

const NIM_LUNA = 100000
const RANGE_LABEL: Record<PriceRange, string> = { '24h': '24 hours', '7d': '7 days' }
const RANGE_ARIA: Record<PriceRange, string> = {
  '24h': 'Show the 7 day NIM price',
  '7d': 'Show the 24 hour NIM price',
}

/** Six significant digits: NIM trades near 0.0003, two decimals would be $0.00. */
function priceDecimals(price: number): number {
  return hasRate(price) ? Math.max(2, Math.ceil(-Math.log10(price)) + 3) : 2
}

const signedPct = (fraction: number) =>
  `${fraction >= 0 ? '+' : '-'}${Math.abs(fraction * 100).toFixed(2)}%`

/** Ring labels and colours, in draw and legend order. */
const RING_PARTS = [
  { key: 'available', label: 'Available', color: 'var(--foreground)' },
  { key: 'staked', label: 'Staked', color: 'var(--primary)' },
  { key: 'moving', label: 'Moving in Nimiq Pay', color: 'var(--muted-foreground)' },
  {
    key: 'vested',
    label: 'Vesting',
    color: 'color-mix(in oklch, var(--muted-foreground) 55%, transparent)',
  },
] as const

const ringColor = (key: string) =>
  RING_PARTS.find((part) => part.key === key)?.color ?? 'var(--muted-foreground)'
const ringLabel = (key: string) => RING_PARTS.find((part) => part.key === key)?.label ?? key

/** `window.innerHeight >= min`, kept live through resizes. */
function useAtLeastHeight(min: number): boolean {
  const [tall, setTall] = useState(() => window.innerHeight >= min)
  useEffect(() => {
    const update = () => setTall(window.innerHeight >= min)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [min])
  return tall
}

export default function BetaSidebarWidgets({ price, holdings, stake }: BetaSidebarWidgetsProps) {
  // Absent props mean "this caller does not use the widgets": render nothing
  // rather than half a card. The hooks live in the body component so this
  // early return cannot break the hooks order.
  if (!price || !holdings || !stake) return null
  return <WidgetsBody price={price} holdings={holdings} stake={stake} />
}

function WidgetsBody({
  price,
  holdings,
  stake,
}: {
  price: BetaPriceProps
  holdings: BetaHoldingsProps
  stake: BetaStakeProps
}) {
  const tall = useAtLeastHeight(520)
  return (
    <div
      className="tw:flex tw:flex-col tw:gap-3 tw:px-2 tw:pb-1 tw:group-data-[collapsible=icon]:hidden"
      data-probe="beta-sidebar-widgets"
    >
      {tall && <PriceCard price={price} />}
      <NimRing holdings={holdings} currency={price.currency} lang={price.lang} />
      {stake.show && (
        <Button className="tw:w-full" onClick={stake.onStake} data-probe="beta-stake-idle">
          <LeafIcon />
          Stake idle NIM
        </Button>
      )}
    </div>
  )
}

function PriceCard({ price }: { price: BetaPriceProps }) {
  // Memory only: no new storage key, a fresh session starts at 24h.
  const [range, setRange] = useState<PriceRange>('24h')
  // null = the range was fetched and had nothing usable (unavailable line).
  const [history, setHistory] = useState<{ range: PriceRange; points: PricePoint[]; fetchedAt: number } | null>(null)
  // null until the first answer: loadedRange !== range is the skeleton state.
  const [loadedRange, setLoadedRange] = useState<PriceRange | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      // The cache answers for 10 minutes, so a hidden tab skipping ticks is
      // free; the visibility listener below catches up on the way back.
      if (document.visibilityState === 'hidden') return
      const result = await getNimPriceHistory(range)
      if (!alive) return
      setHistory(result ? { range, points: result.points, fetchedAt: result.fetchedAt } : null)
      setLoadedRange(range)
    }
    void load()
    const timer = window.setInterval(() => void load(), 10 * 60 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [range])

  const known = hasRate(price.nim)
  const usdOnly = !hasRate(price.usdToCur)
  const factor = usdOnly ? 1 : price.usdToCur
  // Only the points of the range on screen: while the new range loads, the
  // previous series must not be drawn under the new label.
  const display = useMemo(() => {
    if (!history || history.range !== range) return null
    const pts = history.points.map((point) => ({ t: point.t, usd: point.usd * factor }))
    // The chart series trails the live price by an hour or two; end the line
    // (and the change) at the price shown above it, when both are in the
    // same currency.
    if (known && !usdOnly && pts.length > 0 && pts[pts.length - 1].t < history.fetchedAt) {
      pts.push({ t: history.fetchedAt, usd: price.nim })
    }
    return pts
  }, [history, range, factor, known, usdOnly, price.nim])
  const change = useMemo(() => (display ? changePct(display) : null), [display])
  const loading = loadedRange !== range
  const rangeText = RANGE_LABEL[range] + (usdOnly ? ' (USD)' : '')

  return (
    <Card size="sm" data-probe="beta-price-card">
      <CardHeader className="tw:gap-0.5">
        <CardTitle className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-sm">
          <span>NIM price</span>
          <Button
            variant="outline"
            size="xs"
            className="tw:font-normal"
            onClick={() => setRange((current) => (current === '24h' ? '7d' : '24h'))}
            aria-label={RANGE_ARIA[range]}
            data-probe="beta-price-range"
          >
            {range}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="tw:flex tw:flex-col tw:gap-1">
        <span className="tw:text-lg tw:font-semibold tw:tabular-nums">
          {formatFiat(price.nim, price.currency, priceDecimals(price.nim))}
        </span>
        {known && change !== null && (
          <span className="tw:flex tw:items-center tw:gap-1 tw:text-xs">
            {change >= 0 ? (
              <TrendingUpIcon className="tw:size-3.5 tw:text-emerald-600 tw:dark:text-emerald-400" />
            ) : (
              <TrendingDownIcon className="tw:size-3.5 tw:text-red-600 tw:dark:text-red-400" />
            )}
            <span
              className={
                change >= 0
                  ? 'tw:tabular-nums tw:text-emerald-600 tw:dark:text-emerald-400'
                  : 'tw:tabular-nums tw:text-red-600 tw:dark:text-red-400'
              }
            >
              {signedPct(change)}
            </span>
            <span className="tw:text-muted-foreground">in {rangeText}</span>
          </span>
        )}
        {loading ? (
          <Skeleton className="tw:h-10 tw:w-full" />
        ) : display && display.length > 0 ? (
          <svg
            viewBox="0 0 160 40"
            className="tw:h-10 tw:w-full tw:text-primary"
            preserveAspectRatio="none"
            role="img"
            aria-label={`NIM price over the last ${rangeText}`}
            data-probe="beta-price-spark"
          >
            <path
              d={sparklinePath(display, 160, 40)}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <span className="tw:text-xs tw:text-muted-foreground">Price history unavailable</span>
        )}
      </CardContent>
    </Card>
  )
}

function NimRing({
  holdings,
  currency,
  lang,
}: {
  holdings: BetaHoldingsProps
  currency: CurrencyCode
  lang: string
}) {
  const segments = useMemo(
    () =>
      ringSegments([
        { key: 'available', luna: holdings.availableLuna },
        { key: 'staked', luna: holdings.stakedLuna },
        { key: 'moving', luna: holdings.movingLuna },
        { key: 'vested', luna: holdings.vestedLuna },
      ]),
    [holdings]
  )
  const empty = segments.length === 0
  const nim = (luna: number) =>
    (luna / NIM_LUNA).toLocaleString(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  const evmRows = holdings.evm.filter((row) => Number.isFinite(row.amount) && row.amount > 0)

  return (
    <div className="tw:flex tw:flex-col tw:gap-2" data-probe="beta-nim-ring">
      <span className="tw:text-sm tw:font-medium">Where your NIM is</span>
      {/* r=16, stroke-width=6, circumference 2*pi*16 (see ringSegments). */}
      <div className="tw:flex tw:justify-center">
        <svg
          viewBox="0 0 40 40"
          className="tw:size-16 tw:shrink-0"
          role="img"
          aria-label="Where your NIM is"
        >
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke={empty ? 'var(--muted-foreground)' : 'var(--border)'}
            strokeOpacity={empty ? 0.4 : 1}
            strokeWidth="6"
          />
          {segments.map((segment) => (
            <circle
              key={segment.key}
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke={ringColor(segment.key)}
              strokeWidth="6"
              strokeDasharray={segment.dash}
              strokeDashoffset={segment.offset}
              transform="rotate(-90 20 20)"
            />
          ))}
        </svg>
      </div>
      <div className="tw:flex tw:flex-col tw:gap-1">
        {empty ? (
          <span className="tw:text-xs tw:text-muted-foreground">No NIM yet</span>
        ) : (
          segments.map((segment) => (
            <div
              key={segment.key}
              data-probe="beta-ring-row"
              className="tw:flex tw:items-center tw:gap-1.5 tw:text-xs"
            >
              <span
                className="tw:size-2 tw:shrink-0 tw:rounded-full"
                style={{ backgroundColor: ringColor(segment.key) }}
                aria-hidden="true"
              />
              <span className="tw:min-w-0 tw:truncate tw:text-muted-foreground">
                {ringLabel(segment.key)}
              </span>
              <span className="tw:ml-auto tw:shrink-0 tw:tabular-nums">
                {nim(segment.luna)} NIM
              </span>
              <span className="tw:w-10 tw:shrink-0 tw:text-right tw:tabular-nums tw:text-muted-foreground">
                {segment.pct.toFixed(1)}%
              </span>
            </div>
          ))
        )}
      </div>
      {evmRows.length > 0 && (
        <>
          <Separator />
          {evmRows.map((row) => (
            <div
              key={row.symbol}
              data-probe="beta-evm-row"
              className="tw:flex tw:items-center tw:gap-2 tw:text-xs"
            >
              <span className="tw:truncate">
                {row.symbol}{' '}
                {row.amount.toLocaleString(lang, { maximumFractionDigits: 2 })}
              </span>
              <span className="tw:ml-auto tw:shrink-0 tw:tabular-nums tw:text-muted-foreground">
                {formatFiat(row.fiat, currency)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

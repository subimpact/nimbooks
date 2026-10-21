// Beta yield calculator: the "New look (beta)" calculator on the house shadcn
// kit. Same props as the classic YieldCalculator, same maths (projectStake,
// typicalRate, compoundsFor come straight from lib/yieldCalc), same pool
// picker semantics (a real pool, or "typical", the median producing pool),
// horizons 1/3/5 behind Tabs, a shadcn Table for the years and the same pure
// SVG chart, restyled on the kit's chart tokens (--chart-1 is the gold NIM
// series).
//
// Placement follows the screen: a bottom vaul Drawer on phones, a Sheet from
// the right at desktop sizes. Both are Radix portals pointed at the .ui-beta
// host (this component owns one when the shell above is not mounted) so the
// calculator never escapes the scoped look.

import { useMemo, useState, useEffect, type PointerEvent } from 'react'
import { formatFiat, type CurrencyCode, type ValidatorInfo } from '../lib/chain'
import { compoundsFor, projectStake, typicalRate } from '../lib/yieldCalc'
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from './components/ui/drawer'
import {
  Sheet,
  SheetContent,
} from './components/ui/sheet'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs'
import { Button } from './components/ui/button'
import { BetaPortalContext } from './lib/portal'

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

function useDesktop(minWidth: number): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(min-width: ${minWidth}px)`).matches : true
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`)
    const on = () => setWide(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [minWidth])
  return wide
}

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
  // A .ui-beta host of its own when this calculator is open while the shell is
  // not above it (it is always open inside the beta shell today, but the
  // standalone host keeps the portal scoping true either way).
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const desktop = useDesktop(1024)

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

  const title = (
    <DrawerTitle className="tw:text-base tw:font-semibold">
      Yield calculator
    </DrawerTitle>
  )

  const body = (
    <div className="tw:flex tw:flex-col tw:gap-3">
      <div className="tw:grid tw:gap-1.5">
        <Label htmlFor="betaCalcAmount">Amount (NIM)</Label>
        <Input
          id="betaCalcAmount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="tw:grid tw:gap-1.5">
        <Label htmlFor="betaCalcPool">Validator</Label>
        <Select
          value={pool}
          onValueChange={(v) => {
            setPool(v)
            setHover(null)
          }}
        >
          <SelectTrigger id="betaCalcPool" className="tw:w-full">
            <SelectValue placeholder="Pick a pool" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TYPICAL}>Typical pool (median of {producing.length || '…'})</SelectItem>
            {producing.map((v) => (
              <SelectItem key={v.address} value={v.address}>
                {v.name}:{' '}
                {((v.annualReward ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% · fee{' '}
                {((v.fee ?? 0) * 100).toLocaleString(lang, { maximumFractionDigits: 1 })}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs
        value={String(years)}
        onValueChange={(v) => {
          setYears(Number(v) as (typeof HORIZONS)[number])
          setHover(null)
        }}
      >
        <TabsList className="tw:w-full" aria-label="Time horizon">
          {HORIZONS.map((h) => (
            <TabsTrigger key={h} value={String(h)} className="tw:flex-1" data-probe="calc-horizon">
              {h} {h === 1 ? 'year' : 'years'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading && validators.length === 0 ? (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Loading validator yields…</p>
      ) : rate === null ? (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          Validator yields are unavailable right now. Try again shortly.
        </p>
      ) : !amountOk ? (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Enter an amount to see what it earns.</p>
      ) : (
        proj && (
          <>
            <div>
              <p className="tw:m-0 tw:text-3xl tw:font-semibold tw:tracking-tight" data-probe="calc-total">
                ≈ {nimFmt(proj.rewardsNim, lang)} NIM
              </p>
              <p className="tw:m-0 tw:mt-1 tw:text-sm tw:text-muted-foreground">
                in {years} {years === 1 ? 'year' : 'years'} ·{' '}
                {(rate * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% p.a. today
                {compound ? ', rewards restaked' : ', rewards paid out'}
                {nimPrice > 0 ? ` · ${formatFiat(proj.rewardsNim * nimPrice, currency)} at today's price` : ''}
              </p>
            </div>

            <div className="tw:rounded-lg tw:bg-muted/50 tw:p-3">
              <p className="tw:m-0 tw:text-sm tw:font-medium">Rewards earned (NIM)</p>
              <p className="tw:m-0 tw:mb-1 tw:text-sm tw:text-muted-foreground" aria-live="polite">
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
                <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD_L - 6} y={PAD_T + 8} fontSize="8" fill="var(--muted-foreground)" textAnchor="end">
                  {nimFmt(proj.rewardsNim, lang, 0)}
                </text>
                <text x={PAD_L - 6} y={PAD_T + plotH} fontSize="8" fill="var(--muted-foreground)" textAnchor="end">
                  0
                </text>
                {Array.from({ length: years + 1 }, (_, i) => (
                  <text
                    key={i}
                    x={x(i * 12)}
                    y={H - 4}
                    fontSize="8"
                    fill="var(--muted-foreground)"
                    textAnchor={i === 0 ? 'start' : i === years ? 'end' : 'middle'}
                  >
                    {i === 0 ? 'now' : `${i}y`}
                  </text>
                ))}
                <polyline points={line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" />
                {hover !== null && shownPoint && (
                  <>
                    <line x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + plotH} stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="2 2" />
                    <circle cx={x(hover)} cy={y(shownPoint.rewardsNim)} r="4" fill="var(--chart-1)" stroke="var(--card)" strokeWidth="2" />
                  </>
                )}
              </svg>
            </div>

            <Table data-probe="calc-table">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Year</TableHead>
                  <TableHead scope="col" className="tw:text-right">Earned</TableHead>
                  <TableHead scope="col" className="tw:text-right">
                    {compound ? 'Staked at year end' : 'Staked'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yearRows.map((r) => (
                  <TableRow key={r.year}>
                    <TableCell>{r.year}</TableCell>
                    <TableCell className="tw:text-right">+{nimFmt(r.earned, lang)}</TableCell>
                    <TableCell className="tw:text-right">{nimFmt(r.total, lang)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {onStake && stakeNote && (
              <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">{stakeNote}</p>
            )}
            {onStake && canStake && (
              <Button
                variant="outline"
                className="tw:min-h-[44px]"
                onClick={() => onStake(toStake, chosen?.address ?? null)}
              >
                {isStaker ? `Add ${nimFmt(toStake, lang)} NIM to your stake` : `Stake ${nimFmt(toStake, lang)} NIM`}
              </Button>
            )}
          </>
        )
      )}

      <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
        An estimate, not a promise. Rewards shrink a little every year because new NIM issuance falls by about 12% a
        year by design, and the estimate assumes the network's total stake stays as it is today: more NIM staked
        network-wide lowers everyone's rate. A pool only pays while it produces blocks.
      </p>
    </div>
  )

  return (
    <div className="ui-beta" ref={setHost} data-probe="beta-calc">
      {host && (
        <BetaPortalContext.Provider value={host}>
          {desktop ? (
            <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
              <SheetContent side="right" className="tw:w-[400px] tw:overflow-y-auto tw:sm:max-w-[400px]">
                {title}
                {body}
              </SheetContent>
            </Sheet>
          ) : (
            <Drawer open onOpenChange={(open) => { if (!open) onClose() }}>
              <DrawerContent>
                {title}
                {body}
              </DrawerContent>
            </Drawer>
          )}
        </BetaPortalContext.Provider>
      )}
    </div>
  )
}
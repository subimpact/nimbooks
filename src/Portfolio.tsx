import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import Iqon from './Iqon'
import { formatFiat, formatLuna, type CurrencyCode } from './lib/chain'
import {
  fetchAddressHolding,
  formatAddress,
  loadPortfolioAddresses,
  savePortfolioAddresses,
  validateNewPortfolioAddress,
  type AddressHolding,
  type PortfolioAddress,
} from './lib/portfolio'
import { type StakeGateStatus } from './lib/stakeGate'

export interface PortfolioProps {
  account: string
  walletLiquidLuna: number
  walletStakedLuna: number
  vestedLuna: number
  nimPrice: number
  currency: CurrencyCode
  lang: string
  gate: StakeGateStatus
  onStake: () => void
  inNimiqPay: boolean
  demo: boolean
  // Bumped after every heartbeat (see App.tsx). Every sixth one re-reads the extra addresses.
  refreshTick: number
}

function shortAddress(addr: string): string {
  const formatted = formatAddress(addr)
  return formatted.length > 14 ? `${formatted.slice(0, 14)}…` : formatted
}

// A holding as the card shows it. `stale` marks the last good figures kept after a
// refresh failed, so one flaky read never blanks a number that was right a minute ago.
type HoldingView = AddressHolding & { stale?: boolean }

// The extra addresses are re-read on every sixth heartbeat (60 s).
const EXTRA_REFRESH_EVERY_TICKS = 6
// Gap between extra addresses in one pass, to respect the RPC rate limiter.
const HOLDING_PACE_MS = 250

// A new read replaces the old one when it lands. A failed read keeps the last good
// figures, marked stale; only an address with nothing good to show gets the error state.
function keepOrReplace(
  prev: Record<string, HoldingView>,
  address: string,
  next: AddressHolding
): Record<string, HoldingView> {
  const before = prev[address]
  if (next.error && before && !before.error) {
    return { ...prev, [address]: { ...before, stale: true } }
  }
  return { ...prev, [address]: { ...next, stale: false } }
}

export function Portfolio({
  account,
  walletLiquidLuna,
  walletStakedLuna,
  vestedLuna,
  nimPrice,
  currency,
  lang,
  gate,
  onStake,
  inNimiqPay,
  refreshTick,
}: PortfolioProps) {
  const [addresses, setAddresses] = useState<PortfolioAddress[]>(() => loadPortfolioAddresses())
  const [holdings, setHoldings] = useState<Record<string, HoldingView>>({})
  const [loadingHoldings, setLoadingHoldings] = useState(false)

  const [inputAddress, setInputAddress] = useState('')
  const [inputLabel, setInputLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  // Stamped at the moment Save as PDF is pressed, so the printed "Generated"
  // line is the print time, not whenever the card last rendered.
  const [generatedAt, setGeneratedAt] = useState(() => new Date())

  // Extra-address reads run one pass at a time, sequentially and paced. A newer pass
  // (a change to the list, or the heartbeat) supersedes the one still running, so two
  // never write over each other. Each value replaces the old one as it lands.
  const passRef = useRef(0)
  const readHoldings = useCallback(async (list: PortfolioAddress[]) => {
    const pass = ++passRef.current
    const current = () => pass === passRef.current
    for (let i = 0; i < list.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, HOLDING_PACE_MS))
        if (!current()) return
      }
      const item = list[i]
      const next = await fetchAddressHolding(item.address)
      if (!current()) return
      setHoldings((prev) => keepOrReplace(prev, item.address, next))
    }
    if (current()) setLoadingHoldings(false)
  }, [])
  // Invalidates whatever pass is running (see passRef above).
  const cancelHoldingPasses = useCallback(() => {
    passRef.current++
  }, [])

  // Fetch extra-address holdings sequentially with 250ms spacing to respect RPC rate limits
  useEffect(() => {
    if (addresses.length === 0) return

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setLoadingHoldings(true)
    })
    void readHoldings(addresses)

    return () => {
      cancelled = true
      // A run cut short by a list change (or by removing the last address)
      // never reaches its own setLoadingHoldings(false); the next run, if
      // any, sets it again.
      cancelHoldingPasses()
      setLoadingHoldings(false)
    }
  }, [addresses, readHoldings, cancelHoldingPasses])

  // The heartbeat re-reads the extra addresses every sixth tick (60 s). This card is
  // only mounted in the Export view, so being mounted is the "Export view open" part;
  // the page must also be on screen. No timer of its own: it rides refreshTick.
  const addressesRef = useRef(addresses)
  const seenTickRef = useRef(refreshTick)
  useEffect(() => {
    addressesRef.current = addresses
  }, [addresses])
  useEffect(() => {
    if (refreshTick === seenTickRef.current) return
    seenTickRef.current = refreshTick
    if (refreshTick % EXTRA_REFRESH_EVERY_TICKS !== 0) return
    if (document.visibilityState !== 'visible') return
    if (addressesRef.current.length === 0) return
    void readHoldings(addressesRef.current)
  }, [refreshTick, readHoldings])

  const retryAddress = async (addressToRetry: string) => {
    setHoldings((prev) => {
      const copy = { ...prev }
      delete copy[addressToRetry]
      return copy
    })
    const fresh = await fetchAddressHolding(addressToRetry)
    setHoldings((prev) => ({ ...prev, [addressToRetry]: fresh }))
  }

  const handleAddAddress = () => {
    const check = validateNewPortfolioAddress(inputAddress, addresses, account)
    if (!check.valid) {
      setAddError(check.error)
      return
    }
    const next: PortfolioAddress[] = [
      ...addresses,
      { address: check.canonical, label: inputLabel.trim() },
    ]
    setAddresses(next)
    savePortfolioAddresses(next)
    setInputAddress('')
    setInputLabel('')
    setAddError(null)
  }

  const handleRemove = (addressToRemove: string) => {
    const next = addresses.filter((a) => a.address !== addressToRemove)
    setAddresses(next)
    savePortfolioAddresses(next)
    setHoldings((prev) => {
      const copy = { ...prev }
      delete copy[addressToRemove]
      return copy
    })
  }

  // A missing rate (CoinGecko down or blocked) reads as 0: print a dash and say
  // so rather than a confident-looking 0.00 on a document meant for records.
  const priced = Number.isFinite(nimPrice) && nimPrice > 0

  // Rows and totals
  const walletTotalLuna = walletLiquidLuna + walletStakedLuna + vestedLuna
  const walletFiat = (walletTotalLuna / 100000) * nimPrice

  const successfulExtraRows = useMemo(() => {
    return addresses
      .map((entry) => ({
        entry,
        holding: holdings[entry.address],
      }))
      .filter((row): row is { entry: PortfolioAddress; holding: HoldingView } => {
        return !!row.holding && !row.holding.error
      })
  }, [addresses, holdings])

  const failedCount = useMemo(() => {
    return addresses.filter((a) => holdings[a.address]?.error).length
  }, [addresses, holdings])

  const staleCount = useMemo(() => {
    return addresses.filter((a) => holdings[a.address]?.stale).length
  }, [addresses, holdings])

  // Aggregate grand totals
  const grandTotals = useMemo(() => {
    let liquidLuna = account ? walletLiquidLuna : 0
    let stakedLuna = account ? walletStakedLuna : 0
    let totalLuna = account ? walletTotalLuna : 0

    for (const r of successfulExtraRows) {
      liquidLuna += r.holding.liquidLuna
      stakedLuna += r.holding.stakedLuna
      totalLuna += r.holding.liquidLuna + r.holding.stakedLuna
    }

    const totalFiat = (totalLuna / 100000) * nimPrice
    return {
      liquidLuna,
      stakedLuna,
      totalLuna,
      totalFiat,
    }
  }, [account, walletLiquidLuna, walletStakedLuna, walletTotalLuna, successfulExtraRows, nimPrice])

  // PDF print routine. Browsers block inside window.print() until the dialog
  // closes. Nimiq Pay's Android WebView returns at once, fires beforeprint and
  // afterprint ~0.3 s later, and only then opens its own print screen (seen
  // after up to ~4 s), which can lay the page out again on a paper-size
  // change. So in Pay the report class stays on until the user is back on this
  // page, and beforeprint is the "a print screen is coming" signal.
  // Verified on Nimiq Pay / Android 16 (2026-10-11); iOS is unverified, hence
  // the fallback hint when no beforeprint ever arrives.
  const [printFallback, setPrintFallback] = useState(false)
  const printCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => printCleanupRef.current?.(), [])
  const handlePrint = useCallback(() => {
    if (!gate.unlocked) return
    printCleanupRef.current?.()
    setPrintFallback(false)
    const prevTitle = document.title
    const today = new Date().toISOString().slice(0, 10)
    document.title = `NimBooks portfolio ${today}`
    flushSync(() => setGeneratedAt(new Date()))
    document.body.classList.add('printing-portfolio')

    let cleanedUp = false
    let sawPrint = false
    let leftPage = false
    const timers: number[] = []
    const onBeforePrint = () => {
      sawPrint = true
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leftPage = true
      else if (leftPage) cleanup()
    }
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      document.body.classList.remove('printing-portfolio')
      document.title = prevTitle
      window.removeEventListener('afterprint', cleanup)
      window.removeEventListener('beforeprint', onBeforePrint)
      document.removeEventListener('visibilitychange', onVisibility)
      timers.forEach((t) => window.clearTimeout(t))
      if (printCleanupRef.current === cleanup) printCleanupRef.current = null
    }
    printCleanupRef.current = cleanup

    if (inNimiqPay) {
      window.addEventListener('beforeprint', onBeforePrint)
      document.addEventListener('visibilitychange', onVisibility)
    } else {
      window.addEventListener('afterprint', cleanup)
    }

    const started = performance.now()
    let threw = false
    try {
      window.print()
    } catch {
      threw = true
    }
    const blocked = performance.now() - started > 500

    if (!inNimiqPay || blocked) {
      // A normal browser, or a dialog that already ran to completion.
      timers.push(window.setTimeout(cleanup, 1000))
      return
    }
    // Pay: no beforeprint means no print screen on this phone.
    timers.push(
      window.setTimeout(() => {
        if (!sawPrint && !cleanedUp) {
          cleanup()
          setPrintFallback(true)
        }
      }, threw ? 0 : 2500),
    )
    // Never leave report mode on if no "back on the page" event arrives.
    timers.push(window.setTimeout(cleanup, 10 * 60 * 1000))
  }, [gate.unlocked, inNimiqPay])

  // Printed report portal rendered into document.body
  const printReportPortal = typeof document !== 'undefined' ? createPortal(
    <div className="portfolio-report" aria-hidden="true">
      <header className="portfolio-report-head">
        <div className="portfolio-report-brand">
          <span className="portfolio-report-logo">NimBooks</span>
          <span className="portfolio-report-title">Portfolio report</span>
        </div>
        <div className="portfolio-report-meta">
          <div>Generated {generatedAt.toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short' })} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</div>
          <div>nimbooks.subimpact.net</div>
        </div>
      </header>

      <table className="portfolio-report-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Address</th>
            <th className="num">Liquid NIM</th>
            <th className="num">Staked NIM</th>
            <th className="num">Total NIM</th>
            <th className="num">Value ({currency.toUpperCase()})</th>
          </tr>
        </thead>
        <tbody>
          {account && (
            <tr>
              <td>
                This wallet{inNimiqPay ? ' (incl. Nimiq Pay balance)' : ''}
                {vestedLuna > 0 && <span className="portfolio-subnote"> (Vesting: {formatLuna(vestedLuna, lang)} NIM)</span>}
              </td>
              <td className="mono">{formatAddress(account)}</td>
              <td className="num">{formatLuna(walletLiquidLuna, lang)}</td>
              <td className="num">{formatLuna(walletStakedLuna, lang)}</td>
              <td className="num">{formatLuna(walletTotalLuna, lang)}</td>
              <td className="num">{priced ? formatFiat(walletFiat, currency) : '-'}</td>
            </tr>
          )}

          {successfulExtraRows.map(({ entry, holding }) => {
            const rowTotal = holding.liquidLuna + holding.stakedLuna
            const rowFiat = (rowTotal / 100000) * nimPrice
            return (
              <tr key={entry.address}>
                <td>
                  {entry.label || '-'}
                  {holding.stale && <span className="portfolio-subnote"> (last figures, not refreshed)</span>}
                </td>
                <td className="mono">{entry.address}</td>
                <td className="num">{formatLuna(holding.liquidLuna, lang)}</td>
                <td className="num">{formatLuna(holding.stakedLuna, lang)}</td>
                <td className="num">{formatLuna(rowTotal, lang)}</td>
                <td className="num">{priced ? formatFiat(rowFiat, currency) : '-'}</td>
              </tr>
            )
          })}

          <tr className="portfolio-report-total-row">
            <td colSpan={2}><strong>Grand total</strong></td>
            <td className="num"><strong>{formatLuna(grandTotals.liquidLuna, lang)}</strong></td>
            <td className="num"><strong>{formatLuna(grandTotals.stakedLuna, lang)}</strong></td>
            <td className="num"><strong>{formatLuna(grandTotals.totalLuna, lang)}</strong></td>
            <td className="num"><strong>{priced ? formatFiat(grandTotals.totalFiat, currency) : '-'}</strong></td>
          </tr>
        </tbody>
      </table>

      <p className="portfolio-report-rate">
        {priced
          ? <>Valued at {formatFiat(nimPrice, currency, 6)} per NIM (live CoinGecko rate at generation time).</>
          : 'NIM price unavailable at generation time, so values are left blank. NIM amounts are exact.'}
      </p>

      <footer className="portfolio-report-footer">
        <p>Balances read from the public Nimiq blockchain at the time shown. Not tax or financial advice.</p>
        <p>Generated with NimBooks - nimbooks.subimpact.net</p>
      </footer>
    </div>,
    document.body
  ) : null

  const cardBody = (
    <div className="portfolio-body">
      <div className="portfolio-rows">
        {account && (
          <div className="portfolio-row">
            <div className="portfolio-row-info">
              <Iqon address={account} size={28} />
              <div className="portfolio-row-meta">
                <div className="portfolio-row-title">
                  This wallet{inNimiqPay ? ' (incl. Nimiq Pay balance)' : ''}
                </div>
                <div className="portfolio-row-addr mono">{shortAddress(account)}</div>
                {vestedLuna > 0 && (
                  <div className="portfolio-row-subnote">
                    (Vesting: {formatLuna(vestedLuna, lang)} NIM)
                  </div>
                )}
              </div>
            </div>

            <div className="portfolio-row-stats">
              <div className="portfolio-stat">
                <span className="stat-label">Liquid</span>
                <span className="stat-value">{formatLuna(walletLiquidLuna, lang)} NIM</span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Staked</span>
                <span className="stat-value">{formatLuna(walletStakedLuna, lang)} NIM</span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Total</span>
                <span className="stat-value bold">{formatLuna(walletTotalLuna, lang)} NIM</span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Value</span>
                <span className="stat-value fiat">{formatFiat(walletFiat, currency)}</span>
              </div>
            </div>
          </div>
        )}

        {addresses.map((entry) => {
          const h = holdings[entry.address]
          const isError = h?.error
          const rowTotal = h ? h.liquidLuna + h.stakedLuna : 0
          const rowFiat = (rowTotal / 100000) * nimPrice

          return (
            <div className="portfolio-row" key={entry.address}>
              <div className="portfolio-row-info">
                <Iqon address={entry.address} size={28} />
                <div className="portfolio-row-meta">
                  <div className="portfolio-row-title">{entry.label || 'Extra address'}</div>
                  <div className="portfolio-row-addr mono">{shortAddress(entry.address)}</div>
                  {h?.stale && (
                    <div className="portfolio-row-subnote">Could not refresh. Showing the last figures.</div>
                  )}
                </div>
              </div>

              {isError ? (
                <div className="portfolio-row-error">
                  <span>Could not load</span>
                  <button className="btn-small" onClick={() => retryAddress(entry.address)}>
                    Retry
                  </button>
                </div>
              ) : (
                <div className="portfolio-row-stats">
                  <div className="portfolio-stat">
                    <span className="stat-label">Liquid</span>
                    <span className="stat-value">
                      {h ? `${formatLuna(h.liquidLuna, lang)} NIM` : '…'}
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="stat-label">Staked</span>
                    <span className="stat-value">
                      {h ? `${formatLuna(h.stakedLuna, lang)} NIM` : '…'}
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="stat-label">Total</span>
                    <span className="stat-value bold">
                      {h ? `${formatLuna(rowTotal, lang)} NIM` : '…'}
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="stat-label">Value</span>
                    <span className="stat-value fiat">
                      {h ? formatFiat(rowFiat, currency) : '…'}
                    </span>
                  </div>
                </div>
              )}

              <button
                className="btn-small danger portfolio-remove-btn"
                onClick={() => handleRemove(entry.address)}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>

      {loadingHoldings && (
        <p className="hint small portfolio-loading">Loading balances…</p>
      )}

      {staleCount > 0 && (
        <p className="hint small">
          {staleCount === 1
            ? '1 address could not be refreshed. Its last figures are shown and counted in the totals.'
            : `${staleCount} addresses could not be refreshed. Their last figures are shown and counted in the totals.`}
        </p>
      )}
      {failedCount > 0 && (
        <p className="hint small warn">
          {failedCount === 1
            ? '1 address could not be loaded and is excluded from totals.'
            : `${failedCount} addresses could not be loaded and are excluded from totals.`}
        </p>
      )}

      <div className="portfolio-add-box">
        <div className="portfolio-add-fields">
          <input
            type="text"
            className="input"
            placeholder="Nimiq address (NQ...)"
            value={inputAddress}
            onChange={(e) => {
              setInputAddress(e.target.value)
              if (addError) setAddError(null)
            }}
          />
          <input
            type="text"
            className="input"
            placeholder="Label (optional)"
            value={inputLabel}
            onChange={(e) => setInputLabel(e.target.value)}
            maxLength={50}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={handleAddAddress}
          disabled={addresses.length >= 10}
        >
          Add address
        </button>
      </div>
      {addError && <p className="hint small warn" role="alert">{addError}</p>}

      <p className="hint small">
        Extra addresses show their own balance and stake. Funds held by Nimiq Pay for those addresses are not included.
      </p>

      <div className="portfolio-grand-line">
        <span className="portfolio-grand-label">Grand total</span>
        <span className="portfolio-grand-nim">
          {formatLuna(grandTotals.totalLuna, lang)} NIM
        </span>
        <span className="portfolio-grand-fiat">
          ≈ {formatFiat(grandTotals.totalFiat, currency)}
        </span>
      </div>

      <div className="portfolio-actions">
        <button
          className="btn-primary"
          onClick={handlePrint}
          disabled={!gate.unlocked}
        >
          Save as PDF
        </button>
        {inNimiqPay && !printFallback && (
          <p className="hint small">
            Opens your phone's print screen. Choose Save as PDF as the printer.
          </p>
        )}
        {printFallback && (
          <p className="hint small" role="status">
            Your phone did not open a print screen here. Take a screenshot of the totals above to keep a copy.
          </p>
        )}
      </div>

      {gate.unlocked && gate.reason === 'staked' && (
        <p className="hint small portfolio-thanks">
          Unlocked by your ImpactZero stake. Thank you for supporting NimBooks.
        </p>
      )}
      {gate.unlocked && gate.reason === 'granted' && (
        <p className="hint small portfolio-thanks">Unlocked for this wallet.</p>
      )}
    </div>
  )

  return (
    <div className={`card portfolio-card${!gate.unlocked ? ' locked' : ''}`} data-learn="portfolio">
      <span className="label">Portfolio report</span>
      <p className="hint small">
        Your wallet plus any other Nimiq addresses you hold, in one report with a grand total. Save it as a PDF for your records or your accountant.
      </p>

      {!gate.unlocked ? (
        <>
          <div className="gate-locked" aria-hidden="true" inert>
            {cardBody}
          </div>
          <div className="gate-overlay">
            <h3>Support NimBooks to unlock</h3>
            <p className="hint">
              {gate.reason === 'not-staked' &&
                "Portfolio reports unlock when you stake 1,000 NIM or more with ImpactZero, the validator that keeps NimBooks running. Stakes with other validators don't count. Your NIM stays yours, keeps earning staking rewards, and helps secure the Nimiq network."}
              {gate.reason === 'below-min' &&
                `You have ${gate.activeNim.toLocaleString(lang, { maximumFractionDigits: 5 })} NIM staked with ImpactZero. Add ${Math.ceil(gate.missingNim).toLocaleString(lang)} NIM more to unlock portfolio reports. Thank you for supporting NimBooks.`}
              {gate.reason === 'other-validator' &&
                "Stakes with other validators don't unlock this. Only ImpactZero does. Portfolio reports need 1,000 NIM or more staked with ImpactZero, the validator that keeps NimBooks running. To switch, unstake from your current validator in the Stake panel, then restake with ImpactZero."}
            </p>
            <button className="btn-primary" onClick={onStake}>
              {gate.reason === 'other-validator' ? 'Open Stake panel' : 'Stake with ImpactZero'}
            </button>
          </div>
        </>
      ) : (
        cardBody
      )}

      {printReportPortal}
    </div>
  )
}

export default Portfolio

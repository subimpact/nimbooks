import { useCallback, useEffect, useMemo, useState } from 'react'
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
}

function shortAddress(addr: string): string {
  const formatted = formatAddress(addr)
  return formatted.length > 14 ? `${formatted.slice(0, 14)}…` : formatted
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
}: PortfolioProps) {
  const [addresses, setAddresses] = useState<PortfolioAddress[]>(() => loadPortfolioAddresses())
  const [holdings, setHoldings] = useState<Record<string, AddressHolding>>({})
  const [loadingHoldings, setLoadingHoldings] = useState(false)

  const [inputAddress, setInputAddress] = useState('')
  const [inputLabel, setInputLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  // Stamped at the moment Save as PDF is pressed, so the printed "Generated"
  // line is the print time, not whenever the card last rendered.
  const [generatedAt, setGeneratedAt] = useState(() => new Date())

  // Fetch extra-address holdings sequentially with 250ms spacing to respect RPC rate limits
  useEffect(() => {
    if (addresses.length === 0) return

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setLoadingHoldings(true)
    })

    ;(async () => {
      for (let i = 0; i < addresses.length; i++) {
        if (cancelled) return
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          if (cancelled) return
        }
        const item = addresses[i]
        const holding = await fetchAddressHolding(item.address)
        if (cancelled) return
        setHoldings((prev) => ({ ...prev, [item.address]: holding }))
      }
      if (!cancelled) {
        setLoadingHoldings(false)
      }
    })()

    return () => {
      cancelled = true
      // A run cut short by a list change (or by removing the last address)
      // never reaches its own setLoadingHoldings(false); the next run, if
      // any, sets it again.
      setLoadingHoldings(false)
    }
  }, [addresses])

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
      .filter((row): row is { entry: PortfolioAddress; holding: AddressHolding } => {
        return !!row.holding && !row.holding.error
      })
  }, [addresses, holdings])

  const failedCount = useMemo(() => {
    return addresses.filter((a) => holdings[a.address]?.error).length
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

  // PDF print routine
  const handlePrint = useCallback(() => {
    if (!gate.unlocked) return
    const prevTitle = document.title
    const today = new Date().toISOString().slice(0, 10)
    document.title = `NimBooks portfolio ${today}`
    flushSync(() => setGeneratedAt(new Date()))
    document.body.classList.add('printing-portfolio')

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      document.body.classList.remove('printing-portfolio')
      document.title = prevTitle
      window.removeEventListener('afterprint', cleanup)
    }

    window.addEventListener('afterprint', cleanup)

    try {
      window.print()
    } finally {
      setTimeout(cleanup, 1000)
    }
  }, [gate.unlocked])

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
                <td>{entry.label || '-'}</td>
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
        {inNimiqPay ? (
          <p className="hint small">
            Saving a PDF needs a browser. Open nimbooks.subimpact.net on your phone or computer browser, connect the same wallet, and save it there.
          </p>
        ) : (
          <button
            className="btn-primary"
            onClick={handlePrint}
            disabled={!gate.unlocked}
          >
            Save as PDF
          </button>
        )}
      </div>

      {gate.unlocked && gate.reason === 'staked' && (
        <p className="hint small portfolio-thanks">
          Unlocked by your ImpactZero stake. Thank you for supporting NimBooks.
        </p>
      )}
    </div>
  )

  return (
    <div className={`card portfolio-card${!gate.unlocked ? ' locked' : ''}`}>
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

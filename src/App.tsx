import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'
import {
  connectWallet,
  connectHub,
  connectDemoAccount,
  isDemoMode,
  getDeviceId,
  getLanguage,
  signReceipt,
  type WalletAccount,
} from './lib/wallet'
import {
  getNimiqBalance,
  getNimiqTransactionHistory,
  getEvmBalances,
  getAllFiatRates,
  formatLuna,
  formatUnits,
  classifyTx,
  decodeMemo,
  explorerTxUrl,
  type NimiqTx,
  type EvmBalance,
} from './lib/chain'
import { encodeReceipt, type SignedReceipt } from './lib/receipt'
import Analytics, { type AnalyticsPeriod } from './Analytics'

type View = 'dashboard' | 'history' | 'receipts' | 'export'

const RATES_KEY = 'nimbooks:rates'

// chain.ts owns this key and writes { asset: { rates: {usd,myr}, at } }.
// Read that schema for the no-flash initial state.
interface RateCache {
  [asset: string]: { rates?: { usd?: number; myr?: number }; at?: number }
}

function readRates(): RateCache {
  try {
    return JSON.parse(localStorage.getItem(RATES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function sanitizeCsvCell(val: unknown): string {
  const str = String(val ?? '')
  // CSV formula injection guard: prefix =, +, -, @, tab, CR with a single quote
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str
}

function isValidReceipt(r: unknown): r is SignedReceipt {
  if (!r || typeof r !== 'object') return false
  const x = r as Record<string, unknown>
  return (
    typeof x.app === 'string' &&
    typeof x.txHash === 'string' &&
    typeof x.sender === 'string' &&
    typeof x.recipient === 'string' &&
    typeof x.amount === 'string' &&
    typeof x.timestamp === 'number' &&
    typeof x.publicKey === 'string' &&
    typeof x.signature === 'string'
  )
}

export default function App() {
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [hubConnecting, setHubConnecting] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(30)
  const [nimBalance, setNimBalance] = useState<string | null>(null)
  const [nimTxs, setNimTxs] = useState<NimiqTx[]>([])
  const [evmBalances, setEvmBalances] = useState<EvmBalance[]>([])
  const [rates, setRates] = useState<{ nim: number; usdt: number; eth: number; pol: number }>({
    nim: 0,
    usdt: 1,
    eth: 0,
    pol: 0,
  })
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [lang, setLang] = useState<string>('en')
  const [receipts, setReceipts] = useState<SignedReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [signingHash, setSigningHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showReceiptHelp, setShowReceiptHelp] = useState(false)
  const [visibleTxCount, setVisibleTxCount] = useState(50)

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  const receiptsKey = useMemo(
    () => (account?.nimiqAddress ? `nimbooks:receipts:${account.nimiqAddress}` : 'nimbooks:receipts'),
    [account?.nimiqAddress]
  )

  const fetchRates = useCallback(async () => {
    try {
      const all = await getAllFiatRates()
      setRates({ nim: all.nim.usd, usdt: all.usdt.usd, eth: all.eth.usd, pol: all.pol.usd })
    } catch (e) {
      console.warn('Rate fetch failed:', e)
      setError('Live rates unavailable — showing cached values.')
    }
  }, [])

  useEffect(() => {
    setLang(getLanguage() ?? navigator.language.split('-')[0] ?? 'en')
    // Load rates from localStorage cache immediately (no flash of $0)
    const cached = readRates()
    setRates((p) => ({
      ...p,
      nim: cached.nim?.rates?.usd ?? 0,
      usdt: cached.usdt?.rates?.usd ?? 1,
      eth: cached.eth?.rates?.usd ?? 0,
      pol: cached.pol?.rates?.usd ?? 0,
    }))
    // Fetch fresh rates (single consolidated request)
    fetchRates()
  }, [fetchRates])

  // Toasts auto-dismiss after 4s (tap still dismisses immediately)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Load receipts scoped to the connected account
  useEffect(() => {
    if (!account?.nimiqAddress) return
    try {
      const saved = localStorage.getItem(receiptsKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          setReceipts(parsed.filter(isValidReceipt))
        }
      }
    } catch {
      setReceipts([])
    }
  }, [receiptsKey, account?.nimiqAddress])

  const connect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const acc = await connectWallet()
      if (!acc.nimiqAddress && !acc.evmAddress) {
        setError('No wallet found. Open this app inside Nimiq Pay, or use the browser login below.')
        return
      }
      setAccount(acc)
      await refresh(acc)
    } catch (e) {
      setError('Connection failed: ' + (e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const connectWithHub = async () => {
    setHubConnecting(true)
    setError(null)
    try {
      const acc = await connectHub()
      setAccount(acc)
      await refresh(acc)
    } catch (e) {
      setError('Browser login failed: ' + (e as Error).message)
    } finally {
      setHubConnecting(false)
    }
  }

  const connectDemo = async () => {
    setConnecting(true)
    setError(null)
    try {
      // Public mainnet address with real human activity — read-only demo mode.
      // (NQ43 6G6H FE78 TV0B YCM5 TD84 P7QX 46XS SNM5: 50 txs over 4 days,
      // 7 distinct senders, mixed in/out — a believable sample wallet.)
      const acc = connectDemoAccount('NQ43 6G6H FE78 TV0B YCM5 TD84 P7QX 46XS SNM5')
      setAccount(acc)
      await refresh(acc)
      setToast('Demo mode — read-only sample wallet.')
    } catch (e) {
      setError('Demo load failed: ' + (e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const refresh = async (acc: WalletAccount) => {
    setLoading(true)
    setError(null)
    try {
      if (acc.nimiqAddress) {
        const [bal, txs] = await Promise.all([
          getNimiqBalance(acc.nimiqAddress),
          // Full history via cursor pagination (up to 1000 txs) — the 50-tx
          // cap silently truncated "accountant-ready" statements.
          getNimiqTransactionHistory(acc.nimiqAddress, 1000),
        ])
        setNimBalance(bal)
        setNimTxs(txs)
      }
      if (acc.evmAddress) {
        const evm = await getEvmBalances(acc.evmAddress)
        setEvmBalances(evm)
      }
    } catch (e) {
      setError('Refresh failed: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const totalUsd = useMemo(() => {
    let total = 0
    if (nimBalance !== null) total += (Number(nimBalance) / 100000) * rates.nim
    for (const b of evmBalances) {
      const val = Number(b.balance) / 10 ** b.decimals
      if (!Number.isFinite(val)) continue
      if (b.symbol === 'USDT') total += val * rates.usdt
      else if (b.symbol === 'POL') total += val * rates.pol
      else total += val * rates.eth
    }
    return Number.isFinite(total) ? total : 0
  }, [nimBalance, evmBalances, rates])

  const makeReceipt = async (tx: NimiqTx) => {
    if (!account?.nimiqAddress) return
    if (receipts.some((r) => r.txHash === tx.hash)) {
      setToast('Receipt already signed for this transaction.')
      return
    }
    try {
      setSigningHash(tx.hash)
      const receipt = await signReceipt(
        {
          app: 'nimbooks',
          v: 1,
          txHash: tx.hash,
          sender: tx.sender,
          recipient: tx.recipient,
          amount: tx.value,
          asset: 'NIM',
          timestamp: Math.floor((tx.timestamp ?? Date.now()) / 1000), // seconds in the signed payload
          memo: tx.data,
        },
        account.nimiqAddress // sign with the connected address — no address-selector step
      )
      if (!receipt) {
        setError('Signing cancelled — no signature returned.')
        return
      }
      // Fallback: if the returned public key doesn't bind to sender/recipient,
      // the receipt is still created but the verify page will flag it.
      const next = [receipt, ...receipts].slice(0, 50)
      setReceipts(next)
      try {
        localStorage.setItem(receiptsKey, JSON.stringify(next))
      } catch {
        /* storage full — keep in memory */
      }
      setToast('Receipt signed ✓')
    } catch (e) {
      console.error('signReceipt failed:', e)
      setError('Signing failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSigningHash(null)
    }
  }

  const shareReceipt = async (r: SignedReceipt) => {
    const enc = encodeReceipt(r)
    const url = `${window.location.origin}${window.location.pathname}#/verify/${enc}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NimBooks receipt', text: 'Verified payment receipt', url })
        return
      }
    } catch (e) {
      // User cancelled the share sheet — do NOT fall through to clipboard (would overwrite it)
      if (e instanceof Error && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast('Verification link copied!')
    } catch {
      setError('Could not copy link — long-press the URL in the address bar.')
    }
  }

  // Shared CSV row builder — one source of truth for export + copy.
  const buildCsv = () => {
    if (!account?.nimiqAddress) return ''
    const own = account.nimiqAddress.replace(/\s+/g, '').toUpperCase()
    const rows = [
      ['timestamp', 'txHash', 'type', 'kind', 'sender', 'recipient', 'amountNIM', 'feeNIM', 'valueUSD_indicative', 'memo'],
      ...nimTxs
        // Failed/reverted txs are not real transfers — exclude from statements
        .filter((t) => t.executionResult !== false)
        .map((t) => {
          const isOut = t.sender.replace(/\s+/g, '').toUpperCase() === own
          return [
            new Date(t.timestamp ?? Date.now()).toISOString(),
            t.hash,
            isOut ? 'sent' : 'received',
            classifyTx(t, own),
            t.sender,
            t.recipient,
            (Number(t.value) / 100000).toFixed(5), // raw decimals — no locale separators (accounting-safe)
            (Number(t.fee) / 100000).toFixed(5),
            ((Number(t.value) / 100000) * rates.nim).toFixed(6),
            decodeMemo(t.data) ?? '',
          ]
        }),
    ]
    return (
      '\uFEFF' + // UTF-8 BOM for Excel
      rows
        .map((r) => r.map((c) => `"${sanitizeCsvCell(c).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    )
  }

  const exportCsv = () => {
    if (!account?.nimiqAddress) return
    const csv = buildCsv()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nimbooks-${account.nimiqAddress.replace(/\s+/g, '').slice(0, 8)}.csv`
    document.body.appendChild(a)
    a.click()
    // Defer revoke so the download completes
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 1000)
  }

  const copyCsv = async () => {
    if (!account?.nimiqAddress) return
    try {
      await navigator.clipboard.writeText(buildCsv())
      setToast('CSV copied to clipboard!')
    } catch {
      setError('Could not copy CSV — use Download instead.')
    }
  }

  const disconnect = () => {
    setAccount(null)
    setNimBalance(null)
    setNimTxs([])
    setEvmBalances([])
    setReceipts([])
    setError(null)
    setToast(null)
    setVisibleTxCount(50)
  }

  const requestDeviceId = async () => {
    if (deviceId) return
    try {
      const id = await getDeviceId()
      if (id) {
        setDeviceId(id)
        setToast('Device preferences enabled — settings are saved to this device.')
      } else {
        setError('Device preferences unavailable — this works inside Nimiq Pay.')
      }
    } catch (e) {
      setError('Device preferences unavailable: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (!account) {
    const isInNimiqPay = typeof window !== 'undefined' && !!window.nimiqPay
    // Mobile = touch-primary device (phone/tablet) → Nimiq Pay is the natural
    // wallet. Desktop → Nimiq Hub browser login is the primary path.
    const isMobile =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))
    return (
      <div className="app">
        <header className="hero">
          <button
            className="btn-ghost theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div className="logo">📒</div>
          <h1>NimBooks</h1>
          <p className="tagline">The books for your Nimiq wallet.</p>
        </header>
        <main className="connect-panel">
          {isInNimiqPay ? (
            <>
              <button className="btn-primary" onClick={connect} disabled={connecting || hubConnecting}>
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </button>
              <div className="connect-divider">or</div>
            </>
          ) : isMobile ? (
            <>
              <a
                className="btn-primary btn-link"
                href="https://nimpay.app/miniapps/open/nimbooks.pages.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Nimiq Pay →
              </a>
              <p className="hint">
                Opens NimBooks inside the Nimiq Pay app — that's where your NIM wallet lives. Tap
                it on your phone.
              </p>
              <div className="connect-divider">or use the web</div>
            </>
          ) : (
            <>
              <button className="btn-primary" onClick={connectWithHub} disabled={connecting || hubConnecting}>
                {hubConnecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
              </button>
              <p className="hint">
                Sign in with your Nimiq wallet right here in the browser — no app needed.
              </p>
              <div className="connect-divider">or on your phone</div>
            </>
          )}
          {isInNimiqPay ? (
            <button className="btn-secondary" onClick={connectWithHub} disabled={connecting || hubConnecting}>
              {hubConnecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
            </button>
          ) : isMobile ? (
            <button className="btn-secondary" onClick={connectWithHub} disabled={connecting || hubConnecting}>
              {hubConnecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
            </button>
          ) : (
            <a
              className="btn-ghost-lg"
              href="https://nimpay.app/miniapps/open/nimbooks.pages.dev"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Nimiq Pay →
            </a>
          )}
          <button className="btn-ghost-lg" onClick={connectDemo} disabled={connecting || hubConnecting}>
            Try with a sample wallet
          </button>
          {error && <p className="error">{error}</p>}
          <p className="hint">
            In Nimiq Pay you also get balances, history, and signed receipts — or use{' '}
            <strong>Nimiq Hub</strong> right here in your browser.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo small">📒</div>
        <h1>NimBooks</h1>
        <button
          className="btn-ghost"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button className="btn-ghost" onClick={() => refresh(account)} disabled={loading}>
          {loading ? '…' : '↻'}
        </button>
        <button className="btn-ghost" onClick={disconnect} title="Disconnect wallet">
          ⏻
        </button>
      </header>

      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error} <span className="dismiss">✕</span>
        </div>
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      <nav className="tabs">
        <button className={view === 'dashboard' ? 'tab active' : 'tab'} onClick={() => setView('dashboard')}>
          Overview
        </button>
        <button className={view === 'history' ? 'tab active' : 'tab'} onClick={() => setView('history')}>
          History
        </button>
        <button className={view === 'receipts' ? 'tab active' : 'tab'} onClick={() => setView('receipts')}>
          Receipts
        </button>
        <button className={view === 'export' ? 'tab active' : 'tab'} onClick={() => setView('export')}>
          Export
        </button>
      </nav>

      <main>
        {view === 'dashboard' && (
          <section className="dashboard">
            <div className="card total">
              <span className="label">Total value</span>
              <span className="value">${totalUsd.toFixed(2)}</span>
              <span className="sub">≈ USD · {lang}</span>
            </div>

            <div className="card">
              <span className="label">NIM balance</span>
              {nimBalance === null ? (
                <span className="value dim">…</span>
              ) : (
                <>
                  <span className="value">{formatLuna(nimBalance, lang)} NIM</span>
                  <span className="sub">
                    ≈ ${((Number(nimBalance) / 100000) * rates.nim).toFixed(4)}
                  </span>
                </>
              )}
            </div>

            {evmBalances.length > 0 && (
              <div className="card">
                <span className="label">EVM assets</span>
                {evmBalances
                  .filter((b) => Number.isFinite(Number(b.balance)) && Number(b.balance) > 0)
                  .map((b) => (
                    <div key={b.chainId + b.symbol} className="row">
                      <span>
                        {b.symbol} · {b.chainName}
                      </span>
                      <span>{formatUnits(b.balance, b.decimals, lang)}</span>
                    </div>
                  ))}
                {evmBalances.every((b) => !(Number.isFinite(Number(b.balance)) && Number(b.balance) > 0)) && (
                  <span className="sub">No EVM balances found</span>
                )}
              </div>
            )}

            <div className="card">
              <span className="label">Addresses</span>
              {account.nimiqAddress && (
                <div className="addr" title={account.nimiqAddress}>
                  NIM: {account.nimiqAddress.slice(0, 12)}…
                </div>
              )}
              {account.evmAddress && (
                <div className="addr" title={account.evmAddress}>
                  EVM: {account.evmAddress.slice(0, 10)}…
                </div>
              )}
            </div>

            <Analytics
              txs={nimTxs}
              currentBalanceNim={nimBalance}
              ownAddress={account.nimiqAddress ?? null}
              period={analyticsPeriod}
              onPeriodChange={setAnalyticsPeriod}
              lang={lang}
            />
          </section>
        )}

        {view === 'history' && (
          <section className="history">
            <div className="section-head">
              <h2>NIM transactions</h2>
              <button className="btn-link-inline" onClick={() => setShowReceiptHelp((v) => !v)}>
                {showReceiptHelp ? 'Hide' : 'What is a signed receipt?'}
              </button>
            </div>
            {showReceiptHelp && (
              <div className="card help-card">
                <p>
                  A signed receipt is a shareable proof-of-payment. NimBooks signs the
                  transaction details with your wallet key, then anyone can verify them on a
                  public page: the signature is checked, the signer must be the sender or
                  recipient, and the transaction is cross-checked on the Nimiq chain.
                </p>
                <p className="hint small">
                  Forged, reverted, or non-existent transactions fail verification.
                </p>
              </div>
            )}
            {loading && nimTxs.length === 0 && <p className="empty">Loading transactions…</p>}
            {!loading && nimTxs.length === 0 && (
              <p className="empty">No transactions found for this address.</p>
            )}
            {nimTxs.slice(0, visibleTxCount).map((tx) => {
              const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === account.nimiqAddress?.replace(/\s+/g, '').toUpperCase()
              const kind = classifyTx(tx, account.nimiqAddress ?? '')
              const memo = decodeMemo(tx.data)
              const demo = isDemoMode()
              return (
                <div key={tx.hash} className="tx">
                  <div className="tx-main">
                    <span className={isOut ? 'out' : 'in'}>
                      {isOut ? '▼ sent' : '▲ received'}
                      {kind !== 'payment' && kind !== 'unknown' && (
                        <span className={`tx-kind ${kind}`}> · {kind}</span>
                      )}
                    </span>
                    <span className="tx-amount">{formatLuna(tx.value, lang)} NIM</span>
                  </div>
                  <div className="tx-sub">
                    {tx.timestamp ? new Date(tx.timestamp).toLocaleString(lang) : '—'} ·{' '}
                    <a
                      className="tx-hash-link"
                      href={explorerTxUrl(tx.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tx.hash.slice(0, 10)}…
                    </a>
                    {tx.executionResult === false && <span className="tx-failed"> · failed</span>}
                  </div>
                  {memo && <div className="tx-memo">memo: {memo}</div>}
                  <button
                    className="btn-small"
                    onClick={() => makeReceipt(tx)}
                    disabled={
                      demo ||
                      receipts.some((r) => r.txHash === tx.hash) ||
                      signingHash === tx.hash
                    }
                    title={demo ? 'Demo mode is read-only — connect your wallet to sign receipts.' : undefined}
                  >
                    {signingHash === tx.hash
                      ? 'Signing…'
                      : receipts.some((r) => r.txHash === tx.hash)
                        ? '✓ Signed'
                        : demo
                          ? 'Sign receipt (demo)'
                          : 'Sign receipt'}
                  </button>
                </div>
              )
            })}
            {nimTxs.length > visibleTxCount && (
              <button
                className="btn-ghost-lg"
                onClick={() => setVisibleTxCount((c) => c + 100)}
              >
                Load more ({nimTxs.length - visibleTxCount} remaining)
              </button>
            )}
          </section>
        )}

        {view === 'receipts' && (
          <section className="receipts">
            <h2>Signed receipts</h2>
            {receipts.length === 0 && (
              <p className="empty">
                No receipts yet. Go to History and tap "Sign receipt" on a transaction to create
                a shareable proof-of-payment.
              </p>
            )}
            {receipts.map((r) => (
              <div key={r.txHash} className="receipt">
                <div className="tx-main">
                  <span>
                    {formatLuna(r.amount, lang)} {r.asset}
                  </span>
                  <span className="ok">✓ signed</span>
                </div>
                <div className="tx-sub">
                  {r.txHash.slice(0, 12)}… · {new Date(r.timestamp * 1000).toLocaleDateString(lang)}
                </div>
                <button className="btn-small" onClick={() => shareReceipt(r)}>
                  Share verification link
                </button>
              </div>
            ))}
          </section>
        )}

        {view === 'export' && (
          <section className="export">
            <h2>Export</h2>
            <p className="hint">
              Download your NIM transaction history as CSV — ready for your accountant or tax
              records.
            </p>
            <button className="btn-primary" onClick={exportCsv} disabled={nimTxs.length === 0}>
              Download CSV ({nimTxs.length} transactions)
            </button>
            <button className="btn-secondary" onClick={copyCsv} disabled={nimTxs.length === 0}>
              Copy CSV to clipboard
            </button>
            <button className="btn-secondary" onClick={requestDeviceId}>
              {deviceId ? `Device: ${deviceId.slice(0, 12)}…` : 'Enable device preferences'}
            </button>
            <p className="hint small">Lang: {lang}</p>
          </section>
        )}
      </main>
    </div>
  )
}

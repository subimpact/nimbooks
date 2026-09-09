import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import QrCode from './QrCode'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'
import { isInNimiqPay, isMobileDevice, NIMIQ_PAY_APP_URL, payDeepLink, siteLink } from './lib/device'
import {
  canSend,
  connectHub,
  connectWallet,
  getConnectedAccount,
  getHubRedirectError,
  sendNim,
  signReceipt,
  type WalletAccount,
} from './lib/wallet'
import {
  clearTxCache,
  explorerTxUrl,
  findSentTx,
  getNimiqTransactionByHash,
  encodeMemo,
} from './lib/chain'
import {
  decodeInvoice,
  formatLunaExact,
  invoiceMemo,
  invoiceStatus,
  invoiceUrl,
  upsertInvoice,
  type InvoicePayload,
} from './lib/invoice'
import { encodeReceipt, type SignedReceipt } from './lib/receipt'

type PayState = 'idle' | 'confirm' | 'sending' | 'locating' | 'sent'

// A lookup that answers "what does the chain say", where an RPC hiccup and a
// tx the index hasn't picked up yet are the same answer: not yet.
async function fetchTx(hash: string) {
  try {
    return await getNimiqTransactionByHash(hash)
  } catch (e) {
    console.warn('Receipt tx lookup failed:', e)
    return null
  }
}

export default function InvoicePage() {
  const [invoice, setInvoice] = useState<InvoicePayload | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  // Reuse the session's wallet when the link was opened from inside the app —
  // or when a Hub login on a mobile browser has just redirected back here.
  const [account, setAccount] = useState<WalletAccount | null>(getConnectedAccount)
  const [connecting, setConnecting] = useState(false)
  // A redirect login lands mid-flow: pick up at the confirm step, not at
  // "connect your wallet" the user has already been through.
  const [payState, setPayState] = useState<PayState>(() =>
    getConnectedAccount()?.nimiqAddress ? 'confirm' : 'idle'
  )
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() => {
    const failed = getHubRedirectError()
    return failed ? 'Connection failed: ' + failed : null
  })
  const [toast, setToast] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<SignedReceipt | null>(null)
  const [signing, setSigning] = useState(false)

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }

  useEffect(() => {
    const m = window.location.hash.match(/^#\/invoice\/([^?]+)/) // stop at query params
    if (!m) {
      setDecodeError('No payment request found in the link.')
      return
    }
    const decoded = decodeInvoice(m[1])
    if (!decoded) {
      setDecodeError('This payment request could not be read. The link may be corrupted.')
      return
    }
    setInvoice(decoded)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const status = useMemo(() => (invoice ? invoiceStatus(invoice) : 'pending'), [invoice])
  const isExpired = status === 'expired'

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const acc = isInNimiqPay() ? await connectWallet() : await connectHub()
      if (!acc.nimiqAddress) {
        setError('No Nimiq address available from this wallet.')
        return
      }
      setAccount(acc)
      setPayState('confirm')
    } catch (e) {
      setError('Connection failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setConnecting(false)
    }
  }, [])

  const pay = useCallback(async () => {
    if (!invoice || !account?.nimiqAddress) return
    setError(null)
    setPayState('sending')
    const memo = invoiceMemo(invoice.id)
    try {
      const result = await sendNim({
        recipient: invoice.payee,
        amountLuna: invoice.amountNim,
        memo,
        from: account.nimiqAddress,
      })
      clearTxCache() // the new payment must show up on the next History load
      let hash = result.hash
      if (!hash) {
        // Nimiq Pay hands back a serialized transaction — recover the hash from
        // the sender's history so the receipt and explorer links work.
        setPayState('locating')
        const found = await findSentTx(
          account.nimiqAddress,
          invoice.payee,
          invoice.amountNim,
          encodeMemo(memo)
        )
        hash = found?.hash ?? null
      }
      setTxHash(hash)
      setPayState('sent')
      const isPayee =
        account.nimiqAddress.replace(/\s+/g, '').toUpperCase() === invoice.payee.replace(/\s+/g, '').toUpperCase()
      upsertInvoice(account.nimiqAddress, {
        ...invoice,
        role: isPayee ? 'payee' : 'payer',
        paid: true,
        paidTxHash: hash ?? undefined,
        paidAt: Date.now(),
      })
    } catch (e) {
      setPayState('confirm')
      setError('Payment failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }, [invoice, account])

  const makeReceipt = useCallback(async () => {
    if (!invoice || !account?.nimiqAddress || !txHash) return
    setSigning(true)
    setError(null)
    try {
      // The verifier requires the signed timestamp to sit within 60s of the
      // block time (lib/receipt.ts), so a receipt signed off the local clock
      // is permanently unverifiable — worse than no receipt at all. Only the
      // on-chain record will do; a tx that has just been broadcast may need a
      // moment to reach the index, so give it one retry.
      let tx = await fetchTx(txHash)
      if (!tx?.timestamp) {
        await new Promise((r) => setTimeout(r, 3000))
        tx = await fetchTx(txHash)
      }
      if (!tx?.timestamp) {
        setError(
          "Couldn't confirm this payment on-chain yet. Sign it from History instead, once it appears there."
        )
        return
      }
      const timestamp = Math.floor(tx.timestamp / 1000)
      // Exactly what the chain carries, never the local guess: the verifier
      // rejects a receipt claiming a memo the transaction doesn't have.
      const data: string | undefined = tx.data
      const signed = await signReceipt(
        {
          app: 'nimbooks',
          v: 1,
          txHash,
          sender: account.nimiqAddress,
          recipient: invoice.payee,
          amount: invoice.amountNim,
          asset: 'NIM',
          timestamp,
          memo: data,
        },
        account.nimiqAddress
      )
      if (!signed) {
        setError('Signing cancelled. No signature returned.')
        return
      }
      setReceipt(signed)
      // Store it alongside receipts signed in the app, scoped to this account.
      try {
        const key = `nimbooks:receipts:${account.nimiqAddress}`
        const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
        const list = Array.isArray(existing) ? existing : []
        localStorage.setItem(
          key,
          JSON.stringify([signed, ...list.filter((r: SignedReceipt) => r?.txHash !== txHash)].slice(0, 50))
        )
      } catch {
        /* storage full — the receipt still exists in this session */
      }
      setToast('Receipt signed ✓')
    } catch (e) {
      setError('Signing failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSigning(false)
    }
  }, [invoice, account, txHash])

  const shareReceipt = useCallback(async () => {
    if (!receipt) return
    const url = siteLink(`#/verify/${encodeReceipt(receipt)}`)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NimBooks receipt', text: 'Verified payment receipt', url })
        return
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast('Verification link copied!')
    } catch {
      setError('Could not copy link. Long-press the URL in the address bar.')
    }
  }, [receipt])

  const header = (
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
      <a className="btn-ghost btn-link" href="#/" title="Back to NimBooks">
        ← Back
      </a>
    </header>
  )

  if (decodeError || !invoice) {
    return (
      <div className="verify">
        {header}
        <div className="card verify-card">
          <h1>⚠️ {decodeError ? 'Invalid link' : 'Loading…'}</h1>
          {decodeError && <p className="details">{decodeError}</p>}
        </div>
      </div>
    )
  }

  const amountNim = formatLunaExact(invoice.amountNim)
  const demo = account?.provider === 'demo'
  const statusLabel = { pending: 'Open', paid: 'Paid', expired: 'Expired' }[status]
  // Carry the route into Pay: without it, a shared invoice opened on a phone
  // lands on the connect screen instead of on the request the sender sent.
  // The custom scheme is what carries it — the https miniapps link loses the
  // fragment on the way into the Pay WebView.
  const payHref = window.location.hash ? payDeepLink(window.location.hash) : NIMIQ_PAY_APP_URL

  return (
    <div className="verify">
      {header}
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

      <div className="card verify-card invoice-card">
        <h1>💸 Payment request</h1>
        <div className="invoice-amount">
          {amountNim} <span className="invoice-unit">NIM</span>
        </div>
        <span className={`invoice-pill ${payState === 'sent' ? 'paid' : status}`}>
          {payState === 'sent' ? 'Paid' : statusLabel}
        </span>

        <div className="verify-grid">
          <div>
            <span className="label">Pay to</span>
            <span className="value mono">{invoice.payee}</span>
          </div>
          {invoice.memo && (
            <div>
              <span className="label">For</span>
              <span className="value">{invoice.memo}</span>
            </div>
          )}
          <div>
            <span className="label">Requested</span>
            <span className="value">{new Date(invoice.createdAt).toLocaleString()}</span>
          </div>
          {invoice.expiresAt && (
            <div>
              <span className="label">{isExpired ? 'Expired' : 'Expires'}</span>
              <span className="value">{new Date(invoice.expiresAt).toLocaleString()}</span>
            </div>
          )}
          <div>
            <span className="label">Reference</span>
            <span className="value mono">{invoiceMemo(invoice.id)}</span>
          </div>
        </div>

        {payState !== 'sent' && (
          <div className="invoice-qr">
            <QrCode value={invoiceUrl(invoice)} size={168} />
            <p className="hint small">Scan to open this request on another device.</p>
          </div>
        )}

        {isExpired && payState !== 'sent' && (
          <p className="hint small">
            This request has expired. You can still pay it. Check with the recipient first.
          </p>
        )}

        {/* --- Pay flow --- */}
        {payState === 'sent' ? (
          <div className="invoice-sent">
            <p className="ok">✓ Payment sent</p>
            {txHash ? (
              <>
                <p className="hint small">
                  Transaction{' '}
                  <a
                    className="tx-hash-link"
                    href={explorerTxUrl(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {txHash.slice(0, 16)}…
                  </a>
                </p>
                {receipt ? (
                  <button className="btn-secondary" onClick={shareReceipt}>
                    Share verification link
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={makeReceipt} disabled={signing}>
                    {signing ? 'Signing…' : 'Sign receipt for this payment'}
                  </button>
                )}
              </>
            ) : (
              <p className="hint small">
                The transaction was submitted. It will appear in History within a few seconds.
                Sign a receipt for it from there.
              </p>
            )}
            <p className="hint small">
              Payment is on-chain: the transaction hash shows up in your NimBooks History.
            </p>
          </div>
        ) : !account ? (
          <>
            {isInNimiqPay() ? (
              <button className="btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? 'Connecting…' : `Pay ${amountNim} NIM`}
              </button>
            ) : isMobileDevice() ? (
              <>
                <a className="btn-primary btn-link" href={payHref} target="_blank" rel="noopener noreferrer">
                  Open in Nimiq Pay →
                </a>
                {/* Second path for a phone without the app: the Hub login works
                    on mobile browsers via redirect (lib/wallet.connectHub). */}
                <button className="btn-secondary" onClick={connect} disabled={connecting}>
                  {connecting ? 'Opening Nimiq Hub…' : 'No app? Continue with Nimiq Hub'}
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
              </button>
            )}
            <p className="hint small">
              {isInNimiqPay() || !isMobileDevice()
                ? 'Connect your wallet to pay this request.'
                : 'Paying needs your Nimiq wallet. Open this request in Nimiq Pay, or sign in with the Nimiq Hub right here in the browser.'}
            </p>
          </>
        ) : demo || !canSend() ? (
          <>
            <button className="btn-primary" disabled>
              Pay {amountNim} NIM
            </button>
            <p className="hint small">
              {demo
                ? 'Demo mode is read-only. Connect your wallet to pay.'
                : 'This wallet cannot send transactions here.'}
            </p>
          </>
        ) : (
          <>
            <div className="invoice-confirm">
              <div className="row">
                <span>Amount</span>
                <span>{amountNim} NIM</span>
              </div>
              <div className="row">
                <span>To</span>
                <span className="mono">{invoice.payee.slice(0, 14)}…</span>
              </div>
              <div className="row">
                <span>From</span>
                <span className="mono">{account.nimiqAddress?.slice(0, 14)}…</span>
              </div>
              <div className="row">
                <span>Network fee</span>
                <span>0 NIM</span>
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={pay}
              disabled={payState === 'sending' || payState === 'locating'}
            >
              {payState === 'sending'
                ? 'Confirm in your wallet…'
                : payState === 'locating'
                  ? 'Confirming on-chain…'
                  : isExpired
                    ? `Pay anyway (${amountNim} NIM)`
                    : `Pay ${amountNim} NIM`}
            </button>
            <p className="hint small">
              The payment carries the request reference, so the recipient's books mark it paid
              automatically.
            </p>
          </>
        )}

        <p className="hint small">Powered by NimBooks: the books for your Nimiq wallet.</p>
      </div>
    </div>
  )
}

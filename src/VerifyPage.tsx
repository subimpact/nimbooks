import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { decodeReceipt, verifyReceiptFull, type SignedReceipt } from './lib/receipt'
import { formatLuna, decodeMemo, explorerTxUrl } from './lib/chain'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'

// 'prompt' is the empty `#/verify` route: nothing to check yet, so the page
// asks for something to check instead of accusing the link of being broken.
type PageState = 'prompt' | 'checking' | 'valid' | 'invalid' | 'inconclusive' | 'error'

const ROUTE_RE = /^#\/verify\/([^?]+)/ // stop at query params
const TX_HASH_RE = /^[0-9a-f]{64}$/i
// What encodeReceipt produces: URL-safe base64, unpadded.
const PAYLOAD_RE = /^[A-Za-z0-9_-]+$/

/**
 * The receipt payload inside whatever the user pasted: a full NimBooks verify
 * URL, or the bare payload on its own. `null` for anything else — including a
 * transaction hash, which is handled separately (it is not a receipt).
 */
function extractPayload(input: string): string | null {
  const s = input.trim()
  if (!s || TX_HASH_RE.test(s)) return null
  const inUrl = s.match(/#\/verify\/([^?\s]+)/)
  if (inUrl) return inUrl[1]
  return PAYLOAD_RE.test(s) ? s : null
}

export default function VerifyPage() {
  const [routePayload] = useState<string | null>(() => window.location.hash.match(ROUTE_RE)?.[1] ?? null)
  const [receipt, setReceipt] = useState<SignedReceipt | null>(null)
  const [status, setStatus] = useState<PageState>(routePayload ? 'checking' : 'prompt')
  const [details, setDetails] = useState('')
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  // Interactive verifier (empty `#/verify`)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [lookupHash, setLookupHash] = useState<string | null>(null)

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }

  useEffect(() => {
    if (!routePayload) return
    const r = decodeReceipt(routePayload)
    if (!r) {
      setStatus('error')
      setDetails('Receipt could not be decoded. The link may be corrupted.')
      return
    }
    setReceipt(r)
    verifyReceiptFull(r).then((res) => {
      setStatus(res.status)
      setDetails(res.details)
    })
  }, [routePayload])

  // Routing the payload into the hash (rather than verifying in place) keeps
  // one code path for every receipt: the router remounts this page on the new
  // hash and the effect above runs exactly as it does for a shared link.
  const submitInput = (e: FormEvent) => {
    e.preventDefault()
    const s = input.trim()
    if (TX_HASH_RE.test(s)) {
      setLookupHash(s.toLowerCase())
      setInputError(null)
      return
    }
    const payload = extractPayload(s)
    if (!payload) {
      setInputError(
        'That is not a NimBooks receipt link, a receipt code, or a 64-character transaction hash.'
      )
      return
    }
    setInputError(null)
    window.location.hash = `#/verify/${payload}`
  }

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

  if (status === 'prompt') {
    return (
      <div className="verify">
        {header}
        <div className="card verify-card">
          <h1>🔎 Verify a receipt</h1>
          {lookupHash ? (
            <>
              {/* Honest limit: a hash proves a transfer happened, not who says
                  what about it. Only a signed receipt binds the two, so this
                  hands the user the explorer rather than a verdict. */}
              <p className="details">
                That is a transaction hash, not a receipt. NimBooks can't verify a payment from a
                hash alone. A receipt carries the sender's signature over the payment's details,
                and a hash carries none. Look the transaction up on the explorer, and ask whoever
                paid you for their receipt link.
              </p>
              <div className="verify-grid">
                <div>
                  <span className="label">Transaction</span>
                  <span className="value mono">{lookupHash}</span>
                </div>
              </div>
              <a
                className="btn-primary btn-link"
                href={explorerTxUrl(lookupHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open on the explorer ↗
              </a>
              <button
                className="btn-secondary"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setLookupHash(null)
                  setInput('')
                }}
              >
                Check something else
              </button>
            </>
          ) : (
            <>
              <p className="details">
                Paste a NimBooks receipt link, or the receipt code from one, and this page checks
                its signature against the Nimiq blockchain. Nothing is uploaded: the whole receipt
                travels in the link and is verified here in your browser.
              </p>
              <form className="invoice-form" onSubmit={submitInput}>
                <label className="label" htmlFor="verify-input">
                  Receipt link, receipt code, or transaction hash
                </label>
                <input
                  id="verify-input"
                  className="input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://nimbooks.subimpact.net/#/verify/…"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {inputError && <p className="hint small warn">{inputError}</p>}
                <button className="btn-primary" type="submit" disabled={!input.trim()}>
                  Verify receipt
                </button>
              </form>
            </>
          )}
          <p className="hint small">Powered by NimBooks: the books for your Nimiq wallet.</p>
        </div>
      </div>
    )
  }

  if (status === 'checking') {
    return (
      <div className="verify">
        {header}
        <div className="card verify-card">
          <h1>Verifying receipt…</h1>
        </div>
      </div>
    )
  }

  if (status === 'error' || !receipt) {
    return (
      <div className="verify">
        {header}
        <div className="card verify-card">
          <h1>⚠️ Invalid link</h1>
          <p>{details}</p>
          <button
            className="btn-secondary"
            onClick={() => {
              window.location.hash = '#/verify'
            }}
          >
            Verify a different receipt
          </button>
        </div>
      </div>
    )
  }

  const statusMeta = {
    valid: { icon: '✅', title: 'Verified receipt', cls: 'valid' },
    invalid: { icon: '❌', title: 'Receipt not verified', cls: 'invalid' },
    inconclusive: { icon: '⏳', title: 'Verification inconclusive', cls: 'inconclusive' },
  }[status]

  return (
    <div className="verify">
      {header}
      <div className={`card verify-card ${statusMeta.cls}`}>
        <h1>
          {statusMeta.icon} {statusMeta.title}
        </h1>
        <p className="details">{details}</p>

        <div className="verify-grid">
          <div>
            <span className="label">Amount</span>
            <span className="value">
              {formatLuna(receipt.amount)} {receipt.asset}
            </span>
          </div>
          <div>
            <span className="label">Date</span>
            <span className="value">{new Date(receipt.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div>
            <span className="label">Sender</span>
            <span className="value mono">{receipt.sender}</span>
          </div>
          <div>
            <span className="label">Recipient</span>
            <span className="value mono">{receipt.recipient}</span>
          </div>
          <div>
            <span className="label">Transaction</span>
            <span className="value mono">{receipt.txHash}</span>
            <a
              className="hint small"
              href={explorerTxUrl(receipt.txHash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Nimiq Watch ↗
            </a>
          </div>
          {receipt.memo && (
            <div>
              <span className="label">Memo</span>
              <span className="value">{decodeMemo(receipt.memo)}</span>
            </div>
          )}
        </div>

        <p className="hint small">
          Signed with Ed25519 · signer public key {receipt.publicKey.slice(0, 16)}…
          <br />
          Powered by NimBooks: the books for your Nimiq wallet.
        </p>
        <button className="btn-secondary" onClick={() => window.print()} style={{ marginTop: 12 }}>
          🖨 Print / Save as PDF
        </button>
      </div>
    </div>
  )
}

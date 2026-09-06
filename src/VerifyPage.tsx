import { useEffect, useState } from 'react'
import './App.css'
import { decodeReceipt, verifyReceiptFull, type SignedReceipt } from './lib/receipt'
import { formatLuna } from './lib/chain'

type PageState = 'checking' | 'valid' | 'invalid' | 'inconclusive' | 'error'

export default function VerifyPage() {
  const [receipt, setReceipt] = useState<SignedReceipt | null>(null)
  const [status, setStatus] = useState<PageState>('checking')
  const [details, setDetails] = useState('')

  useEffect(() => {
    const hash = window.location.hash
    const m = hash.match(/^#\/verify\/([^?]+)/) // stop at query params
    if (!m) {
      setStatus('error')
      setDetails('No receipt found in the link.')
      return
    }
    const r = decodeReceipt(m[1])
    if (!r) {
      setStatus('error')
      setDetails('Receipt could not be decoded — the link may be corrupted.')
      return
    }
    setReceipt(r)
    verifyReceiptFull(r).then((res) => {
      setStatus(res.status)
      setDetails(res.details)
    })
  }, [])

  if (status === 'checking') {
    return (
      <div className="verify">
        <div className="card verify-card">
          <h1>Verifying receipt…</h1>
        </div>
      </div>
    )
  }

  if (status === 'error' || !receipt) {
    return (
      <div className="verify">
        <div className="card verify-card">
          <h1>⚠️ Invalid link</h1>
          <p>{details}</p>
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
      <header className="topbar">
        <div className="logo small">📒</div>
        <h1>NimBooks</h1>
        <a className="btn-ghost btn-link" href="/" title="Back to NimBooks">
          ← Back
        </a>
      </header>
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
              href={`https://explorer.nimiq.com/transactions/${receipt.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Nimiq Explorer ↗
            </a>
          </div>
          {receipt.memo && (
            <div>
              <span className="label">Memo</span>
              <span className="value">{receipt.memo}</span>
            </div>
          )}
        </div>

        <p className="hint small">
          Signed with Ed25519 · signer public key {receipt.publicKey.slice(0, 16)}…
          <br />
          Powered by NimBooks — the books for your Nimiq wallet.
        </p>
      </div>
    </div>
  )
}

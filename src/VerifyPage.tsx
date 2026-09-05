import { useEffect, useState } from 'react'
import './App.css'
import { decodeReceipt, verifyReceiptFull, type SignedReceipt } from './lib/receipt'
import { formatLuna } from './lib/chain'

export default function VerifyPage() {
  const [receipt, setReceipt] = useState<SignedReceipt | null>(null)
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid' | 'error'>('checking')
  const [details, setDetails] = useState('')

  useEffect(() => {
    const hash = window.location.hash
    const m = hash.match(/^#\/verify\/(.+)$/)
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
      setStatus(res.signatureValid && res.onChainValid ? 'valid' : res.signatureValid ? 'invalid' : 'invalid')
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

  return (
    <div className="verify">
      <div className={`card verify-card ${status === 'valid' ? 'valid' : 'invalid'}`}>
        <h1>{status === 'valid' ? '✅ Verified receipt' : '❌ Receipt not verified'}</h1>
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
          </div>
          {receipt.memo && (
            <div>
              <span className="label">Memo</span>
              <span className="value">{receipt.memo}</span>
            </div>
          )}
        </div>

        <p className="hint small">
          Signed with Ed25519 · public key {receipt.publicKey.slice(0, 16)}…
          <br />
          Powered by NimBooks — the books for your Nimiq wallet.
        </p>
      </div>
    </div>
  )
}

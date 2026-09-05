// Receipt verification — self-contained signed receipts.
// A receipt is a signed JSON payload; verification = Ed25519 signature
// check + on-chain tx cross-check via Nimiq RPC.

import { getNimiqTransactions } from './chain'

export interface ReceiptPayload {
  app: 'nimbooks'
  v: 1
  txHash: string
  sender: string
  recipient: string
  amount: string // Luna
  asset: 'NIM' | 'USDT' | string
  timestamp: number
  memo?: string
}

export interface SignedReceipt extends ReceiptPayload {
  publicKey: string
  signature: string
}

export function encodeReceipt(receipt: SignedReceipt): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(receipt))))
  // URL-safe base64: + → -, / → _, strip padding (safe for chat apps & hashes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeReceipt(encoded: string): SignedReceipt | null {
  try {
    // Restore standard base64
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const json = decodeURIComponent(escape(atob(b64)))
    const r = JSON.parse(json)
    if (r.app !== 'nimbooks' || !r.txHash || !r.signature || !r.publicKey) return null
    return r as SignedReceipt
  } catch {
    return null
  }
}

export function canonicalPayload(r: Omit<SignedReceipt, 'publicKey' | 'signature'>): string {
  return JSON.stringify({
    app: r.app,
    v: r.v,
    txHash: r.txHash,
    sender: r.sender,
    recipient: r.recipient,
    amount: r.amount,
    asset: r.asset,
    timestamp: r.timestamp,
    memo: r.memo ?? '',
  })
}

// Ed25519 verification (Nimiq uses Ed25519 for account signing).
// Uses WebCrypto — no extra dependency.
export async function verifyEd25519(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const keyBytes = hexToBytes(publicKeyHex)
    const sigBytes = hexToBytes(signatureHex)
    const msgBytes = new TextEncoder().encode(message)

    const key = await crypto.subtle.importKey(
      'raw',
      toBufferSource(keyBytes),
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    return await crypto.subtle.verify('Ed25519', key, toBufferSource(sigBytes), toBufferSource(msgBytes))
  } catch (e) {
    console.warn('Ed25519 verify failed:', e)
    return false
  }
}

export async function verifyReceiptFull(receipt: SignedReceipt): Promise<{
  signatureValid: boolean
  onChainValid: boolean
  details: string
}> {
  // 1. Signature check
  const payload = canonicalPayload(receipt)
  const signatureValid = await verifyEd25519(receipt.publicKey, payload, receipt.signature)

  // 2. On-chain cross-check: does this tx exist with matching sender/recipient/amount?
  let onChainValid = false
  let details = 'Signature invalid — receipt is not authentic.'
  if (signatureValid) {
    try {
      const txs = await getNimiqTransactions(receipt.sender, 20)
      const match = txs.find(
        (t) =>
          t.hash === receipt.txHash &&
          t.recipient === receipt.recipient &&
          t.value === receipt.amount
      )
      onChainValid = !!match
      details = onChainValid
        ? 'Signature valid AND transaction confirmed on the Nimiq blockchain.'
        : 'Signature valid, but transaction not found on-chain (or params mismatch).'
    } catch {
      details = 'Signature valid, but on-chain check failed (RPC unavailable).'
    }
  }

  return { signatureValid, onChainValid, details }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return bytes
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

// Receipt verification — self-contained signed receipts.
// A receipt is a signed JSON payload; verification = Ed25519 signature
// check + public-key→address binding + on-chain tx cross-check via Nimiq RPC.

import blake2b from 'blakejs'
import { getNimiqTransactionByHash } from './chain'

export interface ReceiptPayload {
  app: 'nimbooks'
  v: 1
  txHash: string
  sender: string
  recipient: string
  amount: string // Luna
  asset: 'NIM' | 'USDT' | string
  timestamp: number // seconds
  memo?: string
}

export interface SignedReceipt extends ReceiptPayload {
  publicKey: string
  signature: string
}

// --- Nimiq address derivation (from public key) ---
// Address = "NQ" + IBAN checksum(2) + base32(blake2b-256(pubkey)[0:20]) padded to 32
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

export function deriveNimiqAddress(publicKeyHex: string): string | null {
  try {
    const pubBytes = hexToBytes(publicKeyHex)
    if (pubBytes.length !== 32) return null
    const hash = blake2b.blake2b(pubBytes, undefined, 32) // 32-byte Blake2b-256
    const addrBytes = hash.slice(0, 20)

    // Convert 20 bytes to custom base32 (big-endian)
    let num = BigInt('0x' + bytesToHex(addrBytes))
    let base32 = ''
    while (num > 0n) {
      base32 = NIMIQ_ALPHABET[Number(num % 32n)] + base32
      num = num / 32n
    }
    const padded = base32.padStart(32, NIMIQ_ALPHABET[0])

    // IBAN MOD-97-10 checksum
    const raw = padded + 'NQ00'
    let numeric = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i)
      numeric += c >= 48 && c <= 57 ? raw[i] : String(c - 55)
    }
    let remainder = 0
    for (let i = 0; i < numeric.length; i++) {
      remainder = (remainder * 10 + parseInt(numeric[i], 10)) % 97
    }
    const checksum = String(98 - remainder).padStart(2, '0')

    return 'NQ' + checksum + padded
  } catch {
    return null
  }
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
// The Nimiq keyguard/Hub signs with the "Nimiq Signed Message" scheme:
//   sign(sha256('\x16Nimiq Signed Message:\n' + message.length + message))
// while the Mini App SDK sign() may return raw Ed25519 over the payload.
// Support BOTH schemes so receipts verify regardless of which provider signed.
const NIMIQ_MSG_PREFIX = '\x16Nimiq Signed Message:\n'

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

// Nimiq keyguard / Hub scheme: sha256(prefix + message.length + message), then Ed25519 over the digest.
export async function verifyNimiqSignedMessage(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const data = `${NIMIQ_MSG_PREFIX}${message.length}${message}`
    const dataBytes = new TextEncoder().encode(data)
    const hash = await crypto.subtle.digest('SHA-256', dataBytes)
    const key = await crypto.subtle.importKey(
      'raw',
      toBufferSource(hexToBytes(publicKeyHex)),
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    return await crypto.subtle.verify('Ed25519', key, toBufferSource(hexToBytes(signatureHex)), hash)
  } catch (e) {
    console.warn('NimiqSignedMessage verify failed:', e)
    return false
  }
}

// Try raw Ed25519 first, then the Nimiq Signed Message scheme.
export async function verifyEitherScheme(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): Promise<boolean> {
  return (
    (await verifyEd25519(publicKeyHex, message, signatureHex)) ||
    (await verifyNimiqSignedMessage(publicKeyHex, message, signatureHex))
  )
}

export type VerifyStatus = 'valid' | 'invalid' | 'inconclusive'

export async function verifyReceiptFull(receipt: SignedReceipt): Promise<{
  status: VerifyStatus
  signatureValid: boolean
  onChainValid: boolean
  signerBound: boolean
  details: string
}> {
  // 1. Signature check — accepts raw Ed25519 OR the Nimiq Signed Message scheme
  const payload = canonicalPayload(receipt)
  const signatureValid = await verifyEitherScheme(receipt.publicKey, payload, receipt.signature)
  if (!signatureValid) {
    return {
      status: 'invalid',
      signatureValid: false,
      onChainValid: false,
      signerBound: false,
      details: 'Signature invalid — receipt is not authentic.',
    }
  }

  // 2. Public key → address binding: the signer must be the sender or recipient
  const derived = deriveNimiqAddress(receipt.publicKey)
  const normSender = receipt.sender.replace(/\s+/g, '').toUpperCase()
  const normRecipient = receipt.recipient.replace(/\s+/g, '').toUpperCase()
  const signerBound = derived !== null && (derived === normSender || derived === normRecipient)
  if (!signerBound) {
    return {
      status: 'invalid',
      signatureValid: true,
      onChainValid: false,
      signerBound: false,
      details: 'Signature valid, but the signer is not the sender or recipient of this transaction.',
    }
  }

  // 3. On-chain cross-check: fetch the exact transaction by hash
  try {
    const tx = await getNimiqTransactionByHash(receipt.txHash)
    if (!tx) {
      return {
        status: 'inconclusive',
        signatureValid: true,
        onChainValid: false,
        signerBound: true,
        details: 'Signature valid and signer bound, but the transaction was not found on-chain.',
      }
    }
    const senderMatch = tx.sender.replace(/\s+/g, '').toUpperCase() === normSender
    const recipientMatch = tx.recipient.replace(/\s+/g, '').toUpperCase() === normRecipient
    const amountMatch = String(tx.value) === String(receipt.amount)
    const memoMatch = !receipt.memo || !tx.data || receipt.memo === tx.data

    if (senderMatch && recipientMatch && amountMatch && memoMatch) {
      return {
        status: 'valid',
        signatureValid: true,
        onChainValid: true,
        signerBound: true,
        details: 'Signature valid, signer bound, and transaction confirmed on the Nimiq blockchain.',
      }
    }
    return {
      status: 'invalid',
      signatureValid: true,
      onChainValid: false,
      signerBound: true,
      details: 'Signature valid, but transaction parameters (sender, recipient, amount, or memo) mismatch.',
    }
  } catch {
    return {
      status: 'inconclusive',
      signatureValid: true,
      onChainValid: false,
      signerBound: true,
      details: 'Signature valid, but the on-chain check could not be completed (RPC unavailable).',
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

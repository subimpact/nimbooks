// Nimiq chain reads — the Node-safe subset of the app's `src/lib/chain.ts`.
//
// Same endpoint, same RPC methods, same classification rules, same memo
// decoding. What is deliberately absent: the browser caches (localStorage),
// the EVM side, the fiat/validator registries, and anything that builds or
// signs a transaction. This module reads. It has no way to spend.

const RPC_URL = 'https://rpc.nimiqwatch.com'

const FETCH_TIMEOUT_MS = 15000
// One retry, and only for the transport: a JSON-RPC *error* is an answer
// ("No staker with address: …" is the normal not-a-staker path), so retrying
// one just spends another call to be told the same thing.
const RETRIES = 1

export interface NimiqTx {
  hash: string
  sender: string
  recipient: string
  value: string // Luna
  fee: string
  timestamp?: number // milliseconds
  data?: string
  blockNumber?: number
  executionResult?: boolean
  // Recipient account type: 0 = basic, 1 = vesting contract, 2 = HTLC
  // (Nimiq Pay swaps), 3 = the staking contract.
  toType?: number
}

export function cleanAddress(address: string): string {
  return address.replace(/\s+/g, '')
}

/** The canonical spaced form the app shows — "NQ43 Y1RH P1K7 …". */
export function spacedAddress(address: string): string {
  const clean = cleanAddress(address).toUpperCase()
  return clean.match(/.{1,4}/g)?.join(' ') ?? address
}

// --- Address input (user-friendly NQ, spaced or flat, or 20-byte hex) ---

// Nimiq's base32 alphabet, as in the app's `src/lib/receipt.ts`.
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

/**
 * IBAN MOD-97-10 over an NQ address, character for character with the app's
 * `isValidNimiqAddress` (App.tsx): a single mistyped character fails it.
 */
function checksumOk(flat: string): boolean {
  const raw = flat.slice(4) + flat.slice(0, 4)
  let remainder = 0
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    const digits = code >= 48 && code <= 57 ? ch : String(code - 55)
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** 20 address bytes → user-friendly NQ address (app's `deriveNimiqAddress` tail). */
function bytesToNimiqAddress(hex: string): string {
  let num = BigInt('0x' + hex)
  let base32 = ''
  while (num > 0n) {
    base32 = NIMIQ_ALPHABET[Number(num % 32n)] + base32
    num = num / 32n
  }
  const padded = base32.padStart(32, NIMIQ_ALPHABET[0])
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
  return 'NQ' + String(98 - remainder).padStart(2, '0') + padded
}

/**
 * Accept an address the way a person would type or paste one — "NQ43 Y1RH …",
 * "NQ43Y1RH…", or the 40-character hex the RPC and explorers hand back — and
 * return the flat, upper-case NQ form every call below uses.
 *
 * Throws `ToolError` with something the user can act on, because a silently
 * normalised typo would read back as "this address has no transactions".
 */
export function normalizeAddress(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new ToolError('No address given. Pass a Nimiq address like "NQ43 Y1RH P1K7 …".')
  const flat = cleanAddress(raw).toUpperCase()

  if (/^(0X)?[0-9A-F]{40}$/.test(flat)) {
    return bytesToNimiqAddress(flat.replace(/^0X/, '').toLowerCase())
  }
  if (!/^NQ[0-9A-Z]{34}$/.test(flat)) {
    throw new ToolError(
      `"${raw}" is not a Nimiq address. Expected "NQ" followed by 34 characters ` +
        `(spaces optional), or 40 hex characters.`
    )
  }
  // Letters outside the base32 alphabet (I, O, W, Z) never appear in a real
  // address; the checksum catches them, but naming them is more useful.
  const body = flat.slice(4)
  const bad = [...new Set([...body].filter((c) => !NIMIQ_ALPHABET.includes(c)))]
  if (bad.length) {
    throw new ToolError(
      `"${raw}" contains ${bad.join(', ')}, which Nimiq addresses never use ` +
        `(no I, O, W or Z). Check the address and try again.`
    )
  }
  if (!checksumOk(flat)) {
    throw new ToolError(
      `"${raw}" fails its checksum — one or more characters are wrong. ` +
        `Nimiq addresses are self-checking, so this is a typo, not a missing account.`
    )
  }
  return flat
}

/**
 * An error whose message is meant for the user. Every tool catches these and
 * returns them as a tool result: the server must stay up.
 */
export class ToolError extends Error {}

// --- RPC ---

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
      const json: any = await res.json()
      if (json.error) {
        // "Transaction not found: <hash>" and "No staker with address: …" live
        // in error.data, not error.message ("Internal error") — callers match
        // on them, so the detail has to survive.
        const detail = json.error.data ? `: ${json.error.data}` : ''
        // A JSON-RPC error is a real answer. Don't spend the retry on it.
        throw new RpcAnswerError(`${json.error.message || 'RPC error'}${detail}`)
      }
      return json.result?.data ?? json.result
    } catch (e) {
      if (e instanceof RpcAnswerError) throw e
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new ToolError(
    `Could not reach the Nimiq RPC at ${RPC_URL} (${msg}). ` +
      `Check your connection — this server reads the public chain and nothing else.`
  )
}

/** A JSON-RPC error response (as opposed to a transport failure). */
class RpcAnswerError extends Error {}

export async function getBalance(address: string): Promise<string> {
  const data = await rpcCall('getAccountByAddress', [cleanAddress(address)])
  return String(data?.balance ?? '0')
}

export interface StakingHolding {
  active: string // Luna
  inactive: string // Luna
  retired: string // Luna
  delegation: string // validator address, '' when unknown
}

/**
 * The address's staker record, or null when it has never staked — the RPC
 * answers that with an error rather than an empty result, which is the common
 * case and not a fault (same handling as the app's `getStakingHolding`).
 */
export async function getStaking(address: string): Promise<StakingHolding | null> {
  try {
    const data = await rpcCall('getStakerByAddress', [cleanAddress(address)])
    if (typeof data?.balance !== 'number') return null
    return {
      active: String(data.balance),
      inactive: String(data.inactiveBalance ?? 0),
      retired: String(data.retiredBalance ?? 0),
      delegation: data.delegation ?? '',
    }
  } catch {
    return null
  }
}

export async function getTransactions(
  address: string,
  max = 50,
  startAt: string | null = null
): Promise<NimiqTx[]> {
  // Third param must be null (no startAt cursor) — '' fails deserialization
  const txs = await rpcCall('getTransactionsByAddress', [cleanAddress(address), max, startAt])
  if (!Array.isArray(txs)) return []
  return txs.map((t: any) => ({
    hash: t.hash ?? '',
    sender: t.from ?? t.fromAddress ?? '',
    recipient: t.to ?? t.toAddress ?? '',
    value: String(t.value ?? '0'),
    fee: String(t.fee ?? '0'),
    timestamp: t.timestamp ? Number(t.timestamp) : undefined,
    data: t.recipientData || t.senderData || undefined,
    blockNumber: t.blockNumber ?? t.blockHeight,
    executionResult: t.executionResult,
    toType: t.toType ?? 0,
  }))
}

/**
 * Walk the whole history by cursor, newest first, capped at `maxTotal`. Paced
 * like the app's version — nimiqwatch 429s on unpaced bursts — and a failure
 * part-way through returns what it already has rather than nothing.
 */
export async function getTransactionHistory(address: string, maxTotal = 1000): Promise<NimiqTx[]> {
  const all: NimiqTx[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    let page: NimiqTx[]
    try {
      page = await getTransactions(address, 50, cursor)
    } catch (e) {
      if (all.length === 0) throw e
      // Partial history beats no history — the caller is told how much it got.
      break
    }
    if (!page.length) break
    all.push(...page)
    if (all.length >= maxTotal) break
    const oldest = page[page.length - 1]
    if (!oldest?.hash || oldest.hash === cursor) break
    cursor = oldest.hash
    if (i < 19) await new Promise((r) => setTimeout(r, 250))
  }
  return all
}

// --- Transaction classification (verbatim rules from the app) ---

// Nimiq staking contract address (Albatross)
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
// Validator reward sender prefix (NQ81 C01N BASE…)
const VALIDATOR_REWARD_PREFIX = 'NQ81 C01N BASE'

export type TxKind = 'payment' | 'stake' | 'unstake' | 'reward' | 'fee' | 'unknown'

export function classifyTx(tx: NimiqTx, ownAddress: string): TxKind {
  const own = cleanAddress(ownAddress).toUpperCase()
  const sender = cleanAddress(tx.sender).toUpperCase()
  const recipient = cleanAddress(tx.recipient).toUpperCase()
  const staking = cleanAddress(STAKING_CONTRACT).toUpperCase()

  if (recipient === staking) return 'stake'
  if (sender === staking) return 'unstake'
  if (sender.startsWith(cleanAddress(VALIDATOR_REWARD_PREFIX).toUpperCase())) return 'reward'
  if (sender === own || recipient === own) return 'payment'
  return 'unknown'
}

// `classifyTx` only sees addresses, so a contract-funding tx reads as a plain
// payment to it. The recipient account type settles those cases.
export type TxLabel = TxKind | 'swap' | 'vesting' | 'htlc'

/** Human-readable transaction type — the app's `txLabel`, minus `remote` rows
 *  (the wallet's HTLC relay address is a Nimiq Pay concept this server never
 *  sees: it reads one address, the one it was asked about). */
export function txLabel(tx: NimiqTx, ownAddress: string): TxLabel {
  if (tx.toType === 3) return classifyTx(tx, ownAddress) === 'unstake' ? 'unstake' : 'stake'
  if (tx.toType === 2) return 'swap'
  if (tx.toType === 1) return 'vesting'
  return classifyTx(tx, ownAddress)
}

// --- Cashlink tags (from the app's `src/lib/cashlink.ts` — the tags only) ---

// The same bytes hub.nimiq.com attaches to funding and claiming transactions
// ('CASH' and 'LINK' in Nimiq's compact extra-data encoding), as they come
// back from the chain: not text, so `decodeMemo` hands them back as raw hex.
// Only the tags are ported — recognising a cashlink needs no key material and
// none of the app's cashlink signing code came with them.
const FUNDING_DATA = new Uint8Array([0, 130, 128, 146, 135])
const CLAIMING_DATA = new Uint8Array([0, 139, 136, 141, 138])
const CASHLINK_TAGS = [FUNDING_DATA, CLAIMING_DATA].map((bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
)
// Nimiq Pay's rail takes a string rather than bytes, so a funding sent from
// there carries the word instead.
const PAY_FUNDING_MEMO = 'Cashlink'

/**
 * Is this decoded memo one of the cashlink tags rather than a note someone
 * wrote? Protocol furniture, like a staking payload: rows say "Cashlink"
 * instead of printing the bytes, exactly as History and the CSV do.
 */
export function isCashlinkMemo(memo: string): boolean {
  if (memo === PAY_FUNDING_MEMO) return true
  return CASHLINK_TAGS.includes(memo.replace(/^0x/, '').toLowerCase())
}

// --- Memo decoding (verbatim from the app) ---

/** Decode Nimiq tx data: hex → UTF-8 when possible, else raw hex. */
export function decodeMemo(data?: string): string {
  if (!data) return ''
  const hex = data.startsWith('0x') ? data.slice(2) : data
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return data
  try {
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Only accept printable text — reject binary garbage, but keep emojis and
    // non-Latin scripts. Control chars are the signal of binary payloads.
    if (/[\x00-\x08\x0E-\x1F\x7F]/.test(text)) return data
    // Older NimBooks builds pre-encoded the memo before handing it to Nimiq
    // Pay, which hex-encodes again — so some live payments carry hex-of-hex.
    const hex2 = text.trim()
    if (/^[0-9a-fA-F]+$/.test(hex2) && hex2.length % 2 === 0) {
      try {
        const bytes2 = new Uint8Array(hex2.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
        const text2 = new TextDecoder('utf-8', { fatal: true }).decode(bytes2)
        if (/^[\x20-\x7E]*$/.test(text2)) return text2
      } catch {
        /* keep the first-level text */
      }
    }
    return text
  } catch {
    return data
  }
}

/** The memo as a row should show it: a cashlink tag is named, not printed. */
export function memoForRow(tx: NimiqTx, label: TxLabel): string {
  const memo = decodeMemo(tx.data) ?? ''
  if (!memo) return ''
  // A staking transaction's data field is a signalling payload, not a note —
  // the kind column already says what it is (same rule as the app's CSV).
  if (label === 'stake' || label === 'unstake') return ''
  return isCashlinkMemo(memo) ? 'Cashlink' : memo
}

export function explorerTxUrl(hash: string): string {
  return `https://nimiq.watch/#${hash}`
}

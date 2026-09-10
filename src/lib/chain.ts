// Nimiq blockchain data client (RPC)

const RPC_URL = 'https://rpc.nimiqwatch.com'

export interface NimiqTx {
  hash: string
  sender: string
  recipient: string
  value: string // Luna
  fee: string
  timestamp?: number // milliseconds
  data?: string
  blockNumber?: number
  proof?: string
  executionResult?: boolean
  // Recipient account type: 0 = basic, 1 = vesting contract, 2 = HTLC
  // (Nimiq Pay swaps), 3 = the staking contract.
  toType?: number
  // Set on rows built from something other than the tx index, and holding the
  // kind the row represents. Two sources:
  //   - reward rollups (lib/stakingEvents.ts), which have no on-chain hash at
  //     all — `hash` is a synthetic key there: never link it to the explorer
  //     and never sign it into a receipt;
  //   - staking actions (lib/stakingLog.ts), which are real mined txs the
  //     address index simply doesn't return, so their hash *is* linkable.
  // Either way the row is not a receipt candidate: the wallet can't prove a
  // payment it didn't make to a counterparty.
  synthetic?: TxKind | StakingActionKind
}

async function rpcCall(method: string, params: unknown[], timeoutMs = 10000): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
    const json = await res.json()
    if (json.error) {
      // Include the data payload — "Transaction not found: <hash>" lives in
      // error.data, not error.message ("Internal error"), and callers rely on it.
      const detail = json.error.data ? `: ${json.error.data}` : ''
      throw new Error(`${json.error.message || 'RPC error'}${detail}`)
    }
    return json.result?.data ?? json.result
  } finally {
    clearTimeout(timer)
  }
}

function cleanAddress(address: string): string {
  return address.replace(/\s+/g, '')
}

export async function getNimiqBalance(address: string): Promise<string> {
  const data = await rpcCall('getAccountByAddress', [cleanAddress(address)])
  return String(data?.balance ?? '0')
}

/**
 * Balance of the user's *remote account* — the HTLC Nimiq Pay stores their
 * funds in, handed over as the second address from `listAccounts()` (see
 * wallet.ts). One RPC call, no contract discovery: the wallet already told us
 * which contract holds the money, so there is nothing to scan for.
 *
 * This is the authoritative "held in HTLC" figure wherever the provider offers
 * a remote account. The history-scanning functions below stay as the fallback
 * for Hub and demo, which don't.
 */
export async function getRemoteAccountBalance(remoteAddress: string): Promise<string> {
  return getNimiqBalance(remoteAddress)
}

// --- HTLC holdings (funds stored in a contract, discovered by scanning) ---

// Nimiq Pay routes transfers through HTLC contracts: the wallet funds a
// contract, then the counterparty claims it (or it refunds). While the money
// sits in the contract the basic account reads 0 — `getNimiqBalance` on the
// basic address alone under-reports what the user actually holds.
//
// Everything below discovers those contracts from the user's own transaction
// history. Prefer `getRemoteAccountBalance` when the provider names the remote
// account outright; this scan is bounded (MAX_CONTRACT_LOOKUPS) and can only
// see contracts that appear in the fetched history.
export interface HtlcHolding {
  address: string
  balance: string // Luna
  timeout?: number // ms
  sender: string
  recipient: string
}

// One RPC call per contract, so bound the fan-out. Candidates are ordered
// newest-first: recent contracts are the ones plausibly still funded.
const MAX_CONTRACT_LOOKUPS = 10
const CONTRACT_LOOKUP_DELAY = 150 // ms — nimiqwatch 429s on unpaced bursts

// Distinct contract addresses the user has funded, newest-first, capped at the
// fan-out budget. `toType` selects the contract flavour (1 = vesting, 2 = HTLC).
// `fundedBy` narrows it to contracts this address actually paid into.
function contractCandidates(txs: NimiqTx[], toType: number, fundedBy?: string): string[] {
  const from = fundedBy ? cleanAddress(fundedBy).toUpperCase() : null
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const tx of [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))) {
    if (tx.toType !== toType || !tx.recipient) continue
    if (from && cleanAddress(tx.sender).toUpperCase() !== from) continue
    const key = cleanAddress(tx.recipient).toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(tx.recipient)
    if (candidates.length >= MAX_CONTRACT_LOOKUPS) break
  }
  return candidates
}

/**
 * Sum up the user's funds sitting in HTLC contracts, discovered from their own
 * transaction history (contract-creating txs carry `toType === 2`).
 *
 * Only contracts that are still *funded* are returned: a settled HTLC is
 * pruned from the accounts tree and reads back as a plain basic account with
 * balance 0, which is noise for a "locked funds" figure. Both the `type` check
 * and the balance check filter those out.
 */
export async function getHtlcHoldings(ownAddress: string, txs: NimiqTx[]): Promise<HtlcHolding[]> {
  const own = cleanAddress(ownAddress).toUpperCase()
  const candidates = contractCandidates(txs, 2)

  const holdings: HtlcHolding[] = []
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, CONTRACT_LOOKUP_DELAY))
    try {
      const data = await rpcCall('getAccountByAddress', [cleanAddress(candidates[i])])
      if (data?.type !== 'htlc') continue // already settled → pruned to 'basic'
      const isOurs =
        cleanAddress(data.sender ?? '').toUpperCase() === own ||
        cleanAddress(data.recipient ?? '').toUpperCase() === own
      if (!isOurs) continue
      const balance = String(data.balance ?? '0')
      if (!(Number(balance) > 0)) continue
      holdings.push({
        address: data.address ?? candidates[i],
        balance,
        timeout: data.timeout,
        sender: data.sender,
        recipient: data.recipient,
      })
    } catch (e) {
      // A rate limit or flaky lookup must not cost the user their balance view
      console.warn('HTLC lookup failed for', candidates[i], e)
    }
  }
  return holdings
}

/**
 * Total Luna still held by the HTLC contracts this address has funded.
 *
 * Fallback for providers that don't name a remote account (Hub, demo) — where
 * one exists, `getRemoteAccountBalance` answers the same question in a single
 * call and without the discovery guesswork.
 *
 * Nimiq Pay's basic address is effectively a *relay*: every transfer lands
 * there and is immediately forwarded into the user's HTLC, so the basic
 * balance reads 0 while the money is really stored in the contract.
 * `getNimiqBalance` on that address alone therefore reports an empty wallet.
 *
 * Deliberately looser than `getHtlcHoldings`, which answers "what is locked in
 * a pending swap" and so filters on the account still being an unsettled HTLC
 * whose sender/recipient is the user. This answers "how much of the user's
 * money is sitting in a contract", so it takes any positive balance left in a
 * contract the address funded — that balance *is* the user's, whatever the
 * settlement state of the swap around it. Best effort throughout: a failed
 * lookup counts as 0 rather than costing the user their whole balance view.
 */
export async function getHtlcInTransit(address: string, txs: NimiqTx[]): Promise<number> {
  const candidates = contractCandidates(txs, 2, address)
  let sum = 0
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, CONTRACT_LOOKUP_DELAY))
    try {
      const data = await rpcCall('getAccountByAddress', [cleanAddress(candidates[i])])
      const balance = Number(data?.balance)
      if (Number.isFinite(balance) && balance > 0) sum += balance
    } catch (e) {
      console.warn('HTLC in-transit lookup failed for', candidates[i], e)
    }
  }
  return sum
}

// --- Staking holdings (NIM delegated to a validator) ---

// Staked NIM leaves the basic account and lives in the staking contract, so
// `getNimiqBalance` reads it as spent. It is still the user's money — three
// buckets of it: `active` (earning), `inactive` (unstaking, cooling down) and
// `retired` (ready to withdraw).
export interface StakingHolding {
  address: string
  active: string // Luna
  inactive: string // Luna
  retired: string // Luna
  delegation: string // validator address, '' when unknown
  // Block height at which the deactivation takes effect. The retire tx is only
  // valid one full reporting epoch later (`inactiveFrom + blocksPerEpoch`);
  // sending it earlier is rejected and never mines. 0 when unknown/never.
  inactiveFrom: number
}

/**
 * Look up the user's staker record. Returns null when the address has never
 * staked — the RPC answers "No staker with address: …" as an error, not an
 * empty result, so a throw here is the normal not-a-staker path.
 */
export async function getStakingHolding(ownAddress: string): Promise<StakingHolding | null> {
  try {
    const data = await rpcCall('getStakerByAddress', [cleanAddress(ownAddress)])
    if (typeof data?.balance !== 'number') return null
    return {
      address: ownAddress,
      active: String(data.balance),
      inactive: String(data.inactiveBalance ?? 0),
      retired: String(data.retiredBalance ?? 0),
      delegation: data.delegation ?? '',
      inactiveFrom: Number(data.inactiveFrom ?? 0) || 0,
    }
  } catch (e) {
    // "No staker with address: …" is the answer for every user who has never
    // staked — the common case, not a fault. Only surface real failures.
    const msg = e instanceof Error ? e.message : String(e)
    if (!/no staker with address/i.test(msg)) console.warn('Staker lookup failed:', e)
    return null
  }
}

// --- Vesting holdings (time-locked funds released on a schedule) ---

export interface VestingHolding {
  address: string
  balance: string // Luna still held by the contract
  totalAmount: string // Luna the contract was created with
  owner: string
}

/**
 * Sum up funds parked in vesting contracts the user funded or owns, discovered
 * from their history (`toType === 1`). Same shape as `getHtlcHoldings`:
 * bounded fan-out, paced calls, best effort.
 */
export async function getVestingHoldings(
  ownAddress: string,
  txs: NimiqTx[]
): Promise<VestingHolding[]> {
  const own = cleanAddress(ownAddress).toUpperCase()
  const candidates = contractCandidates(txs, 1)

  const holdings: VestingHolding[] = []
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, CONTRACT_LOOKUP_DELAY))
    try {
      const data = await rpcCall('getAccountByAddress', [cleanAddress(candidates[i])])
      if (data?.type !== 'vesting') continue // fully released → pruned to 'basic'
      const isOurs =
        cleanAddress(data.owner ?? '').toUpperCase() === own ||
        cleanAddress(data.recipient ?? '').toUpperCase() === own
      if (!isOurs) continue
      holdings.push({
        address: data.address ?? candidates[i],
        balance: String(data.balance ?? '0'),
        totalAmount: String(data.vestingTotalAmount ?? data.balance ?? 0),
        owner: data.owner ?? '',
      })
    } catch (e) {
      console.warn('Vesting lookup failed for', candidates[i], e)
    }
  }
  return holdings
}

export async function getNimiqTransactions(
  address: string,
  max = 50,
  startAt: string | null = null
): Promise<NimiqTx[]> {
  try {
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
      proof: t.proof ?? undefined,
      executionResult: t.executionResult,
      toType: t.toType ?? 0,
    }))
  } catch (e) {
    console.warn('getNimiqTransactions failed:', e)
    throw e // propagate so callers can distinguish "no data" from "couldn't load"
  }
}

// Fetch the full transaction history by walking the startAt cursor until
// exhausted (cap at maxTotal to bound the request). Returns oldest→newest.
// A small delay between pages keeps us under the RPC rate limiter (bursts of
// 20 rapid calls trip 429s).
const TX_CACHE_KEY = 'nimbooks:txs'
const TX_CACHE_TTL = 2 * 60 * 1000 // 2 min — balances move, but not every second

interface TxCacheEntry {
  address: string
  at: number
  txs: NimiqTx[]
}

function readTxCache(address: string): NimiqTx[] | null {
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as TxCacheEntry
    if (entry.address !== address || Date.now() - entry.at > TX_CACHE_TTL) return null
    // Entries cached before HTLC support carry no `toType`; serving them would
    // hide swap labels and locked balances until the TTL expired.
    if (entry.txs.some((t) => t.toType === undefined)) return null
    return entry.txs
  } catch {
    return null
  }
}

function writeTxCache(address: string, txs: NimiqTx[]) {
  try {
    localStorage.setItem(TX_CACHE_KEY, JSON.stringify({ address, at: Date.now(), txs }))
  } catch {
    /* storage full — skip */
  }
}

// Drop the cached history — called after sending a transaction so the next
// refresh shows it instead of serving a 2-minute-old list.
export function clearTxCache() {
  try {
    localStorage.removeItem(TX_CACHE_KEY)
  } catch {
    /* storage unavailable */
  }
}

export async function getNimiqTransactionHistory(address: string, maxTotal = 1000): Promise<NimiqTx[]> {
  // Serve from cache when fresh — repeat visits cost zero RPC calls.
  const cached = readTxCache(address)
  if (cached) return cached

  const all: NimiqTx[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    let page: NimiqTx[]
    try {
      page = await getNimiqTransactions(address, 50, cursor)
    } catch (e) {
      // A mid-pagination failure (rate limit, flaky network) must not wipe the
      // whole history — return what we already have so the user sees txs.
      console.warn(`History pagination stopped at page ${i + 1}:`, e)
      break
    }
    if (!page.length) break
    all.push(...page)
    if (all.length >= maxTotal) break
    // The RPC returns newest→oldest; the oldest hash becomes the next cursor.
    const oldest = page[page.length - 1]
    if (!oldest?.hash || oldest.hash === cursor) break
    cursor = oldest.hash
    if (i < 19) await new Promise((r) => setTimeout(r, 250))
  }
  if (all.length) writeTxCache(address, all)
  return all
}

export async function getNimiqTransactionByHash(hash: string): Promise<NimiqTx | null> {
  try {
    const t = await rpcCall('getTransactionByHash', [hash])
    if (!t) return null
    return {
      hash: t.hash ?? hash,
      sender: t.from ?? t.fromAddress ?? '',
      recipient: t.to ?? t.toAddress ?? '',
      value: String(t.value ?? '0'),
      fee: String(t.fee ?? '0'),
      timestamp: t.timestamp ? Number(t.timestamp) : undefined,
      data: t.recipientData || t.senderData || undefined,
      blockNumber: t.blockNumber ?? t.blockHeight,
      proof: t.proof ?? undefined,
      executionResult: t.executionResult,
      toType: t.toType ?? 0,
    }
  } catch (e) {
    // RPC returns -32603 "Transaction not found: <hash>" for nonexistent hashes.
    // That is a definitive "no such tx", not an RPC outage.
    const msg = e instanceof Error ? e.message : String(e)
    if (/not found/i.test(msg)) return null
    console.warn('getNimiqTransactionByHash failed:', e)
    throw e
  }
}

/**
 * Poll the tx index until a submitted transaction shows up, or the budget runs
 * out. "Submitted" is not "mined": a Nimiq tx that misses its validity window
 * (~2h) is dropped from the mempool without a trace, so a flow that only shows
 * the hash leaves the user waiting on something that will never land.
 *
 * - 'confirmed' — the index returned the tx (`executionResult` carries success)
 * - 'expired'   — every lookup came back a definitive "not found"
 * - 'unknown'   — at least one lookup failed on the RPC itself, so absence
 *                 proves nothing; the caller must keep any pending state.
 *
 * `timeoutMs` is a polling budget, not the validity window: a caller that only
 * waits a minute gets 'expired' for the overwhelmingly common failure (never
 * broadcast / rejected outright), not proof the window has passed.
 */
export async function waitForTxMined(
  hash: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<'confirmed' | 'expired' | 'unknown'> {
  const intervalMs = opts.intervalMs ?? 15000
  const timeoutMs = opts.timeoutMs ?? 2 * 60 * 60 * 1000 // tx validity window
  const deadline = Date.now() + timeoutMs
  let rpcFailed = false
  let attempt = 0
  for (;;) {
    attempt++
    try {
      // Resolves null only for a definitive "Transaction not found".
      if (await getNimiqTransactionByHash(hash)) return 'confirmed'
    } catch (e) {
      // Network/rate-limit trouble — keep polling, but never report 'expired'
      // off a lookup that never actually answered.
      rpcFailed = true
      console.warn('waitForTxMined lookup failed:', e)
    }
    if (Date.now() + intervalMs >= deadline) break
    // Ramp: Nimiq mines in ~1s, so the first few checks come fast and the
    // celebration fires almost immediately; back off to the caller's cadence
    // once the fast window is past.
    const wait = attempt <= 5 ? Math.min(2000, intervalMs) : intervalMs
    await new Promise((r) => setTimeout(r, wait))
  }
  return rpcFailed ? 'unknown' : 'expired'
}

export async function getNimiqBlockNumber(): Promise<number> {
  const data = await rpcCall('getBlockNumber', [])
  return Number(data)
}

/**
 * Push an already-signed transaction to the network. Used as a belt-and-braces
 * step after Nimiq Hub checkout: re-broadcasting the identical serialized
 * transaction is a no-op (same hash, applied at most once), but it covers the
 * case where the signer only signed and left broadcasting to the app.
 */
export async function broadcastRawTransaction(serializedTx: string): Promise<string> {
  return String(await rpcCall('sendRawTransaction', [serializedTx]))
}

/**
 * Locate a just-sent transaction in the sender's history. Nimiq Pay returns a
 * serialized transaction rather than a hash, so the hash is recovered by
 * matching recipient + value + data against fresh (uncached) history pages.
 */
export async function findSentTx(
  from: string,
  recipient: string,
  valueLuna: string,
  dataHex?: string,
  attempts = 6,
  delayMs = 2500
): Promise<NimiqTx | null> {
  const wantRecipient = cleanAddress(recipient).toUpperCase()
  const wantData = (dataHex ?? '').toLowerCase()
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs))
    try {
      const txs = await getNimiqTransactions(from, 20, null)
      const match = txs.find(
        (t) =>
          cleanAddress(t.recipient).toUpperCase() === wantRecipient &&
          String(t.value) === String(valueLuna) &&
          (!wantData || (t.data ?? '').toLowerCase() === wantData)
      )
      if (match) return match
    } catch (e) {
      console.warn('findSentTx poll failed:', e)
    }
  }
  return null
}

// --- EVM side (per-chain public RPCs via viem — no window.ethereum chain-switching needed) ---

export interface EvmBalance {
  chainId: string
  chainName: string
  symbol: string
  decimals: number
  balance: string // raw units
  contractAddress?: string
}

/**
 * Native + USDT balances across the supported EVM chains.
 *
 * The implementation lives in `./evm` and is reached by dynamic import, so
 * viem is code-split out of the initial bundle and only fetched when a user
 * actually has EVM balances read.
 */
export async function getEvmBalances(address: string): Promise<EvmBalance[]> {
  const { readEvmBalances } = await import('./evm')
  return readEvmBalances(address)
}

// --- Fiat conversion ---

// Display currencies offered by the currency switcher. CoinGecko returns all
// of them in the one consolidated request, so an extra currency costs no extra
// API call (and no extra 429 risk).
// The same set as the Nimiq Wallet's currency picker (verified against
// wallet.nimiq.com settings), minus CRC/GMD/GTQ/XOF — CoinGecko does not
// publish those four, so they would always read 0.
export type CurrencyCode =
  | 'aed' | 'ars' | 'aud' | 'brl' | 'cad' | 'chf' | 'clp' | 'cny'
  | 'czk' | 'dkk' | 'eur' | 'gbp' | 'hkd' | 'huf' | 'idr' | 'ils'
  | 'inr' | 'jpy' | 'krw' | 'mxn' | 'myr' | 'ngn' | 'nok' | 'nzd'
  | 'php' | 'pkr' | 'pln' | 'rub' | 'sek' | 'sgd' | 'thb' | 'try'
  | 'twd' | 'uah' | 'usd' | 'vnd' | 'zar'

export const CURRENCIES: { code: CurrencyCode; label: string; symbol: string; flag: string }[] = [
  { code: 'aed', label: 'AED', symbol: 'AED ', flag: 'AE' },
  { code: 'ars', label: 'ARS', symbol: 'ARS ', flag: 'AR' },
  { code: 'aud', label: 'AUD', symbol: 'A$', flag: 'AU' },
  { code: 'brl', label: 'BRL', symbol: 'R$', flag: 'BR' },
  { code: 'cad', label: 'CAD', symbol: 'C$', flag: 'CA' },
  { code: 'chf', label: 'CHF', symbol: 'Fr ', flag: 'CH' },
  { code: 'clp', label: 'CLP', symbol: 'CLP ', flag: 'CL' },
  { code: 'cny', label: 'CNY', symbol: '¥', flag: 'CN' },
  { code: 'czk', label: 'CZK', symbol: 'Kč ', flag: 'CZ' },
  { code: 'dkk', label: 'DKK', symbol: 'kr ', flag: 'DK' },
  { code: 'eur', label: 'EUR', symbol: '€', flag: 'EU' },
  { code: 'gbp', label: 'GBP', symbol: '£', flag: 'GB' },
  { code: 'hkd', label: 'HKD', symbol: 'HK$', flag: 'HK' },
  { code: 'huf', label: 'HUF', symbol: 'Ft ', flag: 'HU' },
  { code: 'idr', label: 'IDR', symbol: 'Rp ', flag: 'ID' },
  { code: 'ils', label: 'ILS', symbol: '₪', flag: 'IL' },
  { code: 'inr', label: 'INR', symbol: '₹', flag: 'IN' },
  { code: 'jpy', label: 'JPY', symbol: '¥', flag: 'JP' },
  { code: 'krw', label: 'KRW', symbol: '₩', flag: 'KR' },
  { code: 'mxn', label: 'MXN', symbol: 'MX$', flag: 'MX' },
  { code: 'myr', label: 'MYR', symbol: 'RM', flag: 'MY' },
  { code: 'ngn', label: 'NGN', symbol: '₦', flag: 'NG' },
  { code: 'nok', label: 'NOK', symbol: 'kr ', flag: 'NO' },
  { code: 'nzd', label: 'NZD', symbol: 'NZ$', flag: 'NZ' },
  { code: 'php', label: 'PHP', symbol: '₱', flag: 'PH' },
  { code: 'pkr', label: 'PKR', symbol: '₨ ', flag: 'PK' },
  { code: 'pln', label: 'PLN', symbol: 'zł ', flag: 'PL' },
  { code: 'rub', label: 'RUB', symbol: '₽', flag: 'RU' },
  { code: 'sek', label: 'SEK', symbol: 'kr ', flag: 'SE' },
  { code: 'sgd', label: 'SGD', symbol: 'S$', flag: 'SG' },
  { code: 'thb', label: 'THB', symbol: '฿', flag: 'TH' },
  { code: 'try', label: 'TRY', symbol: '₺', flag: 'TR' },
  { code: 'twd', label: 'TWD', symbol: 'NT$', flag: 'TW' },
  { code: 'uah', label: 'UAH', symbol: '₴', flag: 'UA' },
  { code: 'usd', label: 'USD', symbol: '$', flag: 'US' },
  { code: 'vnd', label: 'VND', symbol: '₫', flag: 'VN' },
  { code: 'zar', label: 'ZAR', symbol: 'R ', flag: 'ZA' },
]

const VS_CURRENCIES = CURRENCIES.map((c) => c.code).join(',')

export interface FiatRates {
  [code: string]: number
}

const CURRENCY_KEY = 'nimbooks:currency'
// Written by App.tsx once the Nimiq Pay host hands over a device identifier.
const DEVICE_ID_KEY = 'nimbooks:deviceId'

// Null outside Nimiq Pay (no host API, so no device ID) — the callers then fall
// back to the single legacy key, which is the pre-device behaviour.
function deviceCurrencyKey(): string | null {
  try {
    const id = localStorage.getItem(DEVICE_ID_KEY)
    return id ? `nimbooks:d:${id}:currency` : null
  } catch {
    return null
  }
}

/** The user's display currency, remembered per device across sessions (default USD). */
export function loadCurrency(): CurrencyCode {
  try {
    const dk = deviceCurrencyKey()
    // Device-scoped wins; falls back to the pre-device legacy key.
    const saved = (dk && localStorage.getItem(dk)) ?? localStorage.getItem(CURRENCY_KEY)
    if (CURRENCIES.some((c) => c.code === saved)) return saved as CurrencyCode
  } catch {
    /* storage unavailable */
  }
  return 'usd'
}

export function saveCurrency(code: CurrencyCode): void {
  try {
    localStorage.setItem(CURRENCY_KEY, code) // legacy mirror — never lose a pref on the old key
    const dk = deviceCurrencyKey()
    if (dk) localStorage.setItem(dk, code)
  } catch {
    /* storage unavailable */
  }
}

export function currencySymbol(code: CurrencyCode): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '$'
}

// Currencies quoted without minor units — there is no such thing as 0.56 yen.
// Rendering "¥1,234.56" is not a rounding nicety, it is the wrong number of
// digits. Codes checked against the CURRENCIES list above.
const ZERO_DECIMAL = new Set<CurrencyCode>(['clp', 'idr', 'jpy', 'krw', 'vnd'])

/**
 * Money for display, grouped by the browser's locale so it lines up with the
 * NIM figures above it (formatLuna already groups). Sub-cent amounts get 4
 * decimals so a small NIM balance never reads as "$0.00"; pass `decimals` to
 * pin the precision instead.
 */
export function formatFiat(amount: number, code: CurrencyCode, decimals?: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  // Zero-decimal currencies ignore a pinned precision — a caller asking for 4
  // decimals wants "don't round this away", not "invent minor units for yen".
  // Below one whole unit they still get 2, since "¥0" for a real balance is
  // the very thing the sub-cent rule exists to prevent.
  const dp = ZERO_DECIMAL.has(code)
    ? n > 0 && n < 1
      ? 2
      : 0
    : (decimals ?? (n > 0 && n < 0.01 ? 4 : 2))
  return `${currencySymbol(code)}${n.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

const RATE_CACHE_KEY = 'nimbooks:rates'
const CACHE_TTL = 5 * 60 * 1000 // 5 min

function readRateCache(): Record<string, { rates: FiatRates; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(RATE_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeRateCache(cache: Record<string, { rates: FiatRates; at: number }>) {
  try {
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable */
  }
}

// Rates cached before a currency was added carry only the old keys; serving
// them would leave the new currency reading 0 until the TTL expired.
function hasAllCurrencies(rates: FiatRates | undefined): boolean {
  return !!rates && CURRENCIES.every((c) => typeof rates[c.code] === 'number')
}

// A live NIM price at or above this is a wrong-id response, not a rally: NIM
// has never traded near a cent, and sits around $0.0004 today. The 365-day
// statement uses a looser bound (lib/statement.ts) — it prices the past, where
// a genuine high must not be silently dropped.
const NIM_MAX_PLAUSIBLE_USD = 0.01

function pickRates(entry: any): FiatRates {
  const rates: FiatRates = {}
  for (const c of CURRENCIES) {
    const v = entry?.[c.code]
    rates[c.code] = typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  return rates
}

// Single consolidated CoinGecko request for all tracked assets — one call,
// one cache entry. Prevents 429 rate-limit storms from 4 parallel requests.
export async function getAllFiatRates(): Promise<Record<'nim' | 'usdt' | 'eth' | 'pol', FiatRates>> {
  const cache = readRateCache()
  const fresh = (a: string) => {
    const c = cache[a]
    return c && hasAllCurrencies(c.rates) && Date.now() - c.at < CACHE_TTL ? c.rates : null
  }
  const nim = fresh('nim')
  const usdt = fresh('usdt')
  const eth = fresh('eth')
  const pol = fresh('pol')
  if (nim && usdt && eth && pol) return { nim, usdt, eth, pol }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether,ethereum,matic-network&vs_currencies=${VS_CURRENCIES}`,
      { signal: controller.signal }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const json = await res.json()
    const now = Date.now()
    const out = {
      nim: pickRates(json['nimiq-2']),
      usdt: pickRates(json['tether']),
      eth: pickRates(json['ethereum']),
      pol: pickRates(json['matic-network']),
    }
    // Sanity clamp. CoinGecko's `nimiq` id (the retired NIM 1.0 listing) has
    // served ~$0.0282 — 72× the real rate — and one bad id would put a 72×
    // Total value in front of the user. NIM has never traded near a cent, so a
    // USD price at or above that is bad data, not a rally: zero it, which the
    // cache guard below reads as "no rates" and never stores.
    if (!(out.nim.usd > 0 && out.nim.usd < NIM_MAX_PLAUSIBLE_USD)) out.nim = pickRates(null)
    // Cache only if the response actually carried rates (avoid caching 429/empty)
    if (out.nim.usd > 0) {
      for (const k of ['nim', 'usdt', 'eth', 'pol'] as const) {
        cache[k] = { rates: out[k], at: now }
      }
      writeRateCache(cache)
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

// --- Validator registry (official Nimiq validators API) ---

// Delegating needs a validator address, and a raw address list is useless to a
// user: fee and reliability are what make one pool a better home for their NIM
// than another. `reliability: null` means the API has no score for the current
// epoch — the node is not producing blocks, so a stake there earns nothing.
export interface ValidatorInfo {
  id: number
  name: string
  address: string
  fee: number | null // 0.01 = 1%; null when the pool publishes no fee
  reliability: number | null // null = not producing (no score this epoch)
  payoutType?: string
  isListed: boolean
  balance: number // Luna staked with this validator (for network total)
  annualReward: number | null // net annual yield after fee, as a fraction (0.0831 = 8.31% p.a.)
  // Picker branding. In-memory only: the logos are inlined data URIs and the
  // 24-validator payload is ~1.4 MB, so they are stripped before caching (see
  // getValidators). A cache hit therefore renders name + metrics, no logo.
  logo?: string // data:image/… URI
  accentColor?: string // '#F39C12' — the pool's brand colour
}

const VALIDATORS_URL = 'https://validators-api-main.je-cf9.workers.dev/api/v1/validators/'
const VALIDATORS_CACHE_KEY = 'nimbooks:validators'
const VALIDATORS_TTL = 10 * 60 * 1000 // 10 min — pool scores move by the epoch

// --- Annual yield math, ported verbatim from the Nimiq wallet's
// AlbatrossMath.calculateStakingReward (wallet.nimiq.com source, verified
// against its displayed yields: within 0.02 % of Moon Pool 7.99 % etc.). ---
const TOTAL_SUPPLY = 21e14 // total NIM supply in Luna
const SUPPLY_DECAY = 0.9999999999960264 // supply decay per ms
const GENESIS_DATE = Date.UTC(2024, 10, 19, 16, 0, 0) // mainnet genesis
const GENESIS_SUPPLY = 12_893_109_654_06244

function supplyAtTime(ms: number): number {
  const t = ms - GENESIS_DATE
  return TOTAL_SUPPLY - (TOTAL_SUPPLY - GENESIS_SUPPLY) * Math.pow(SUPPLY_DECAY, t)
}

/** Net annual yield for a validator, in the wallet's convention (fraction). */
export function annualRewardFor(fee: number | null, networkStakeLuna: number): number | null {
  if (fee === null || !(networkStakeLuna > 0)) return null
  const now = Date.now()
  const emission = supplyAtTime(now + 365 * 86400000) - supplyAtTime(now)
  return (emission / networkStakeLuna) * (1 - fee)
}

interface ValidatorCacheEntry {
  at: number
  validators: ValidatorInfo[]
}

/**
 * Best home for a stake first: reliability descending, non-producing pools
 * (null score) last, ties broken by name so the order is stable between loads.
 */
export function sortValidators(list: ValidatorInfo[]): ValidatorInfo[] {
  return [...list].sort((a, b) => {
    const ar = a.reliability
    const br = b.reliability
    if (ar === null && br !== null) return 1
    if (br === null && ar !== null) return -1
    if (ar !== null && br !== null && ar !== br) return br - ar
    return a.name.localeCompare(b.name)
  })
}

export async function getValidators(): Promise<ValidatorInfo[]> {
  // A stale list still beats an empty picker if the API is down.
  let stale: ValidatorInfo[] | null = null
  try {
    const raw = localStorage.getItem(VALIDATORS_CACHE_KEY)
    if (raw) {
      const entry = JSON.parse(raw) as ValidatorCacheEntry
      if (Array.isArray(entry.validators) && entry.validators.length > 0) {
        if (Date.now() - entry.at < VALIDATORS_TTL) return sortValidators(entry.validators)
        stale = entry.validators
      }
    }
  } catch {
    /* unreadable cache — refetch */
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(VALIDATORS_URL, { signal: controller.signal })
    if (!res.ok) throw new Error(`Validators API HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json)) throw new Error('Validators API returned no list')
    // Keep only the fields the picker needs. The raw payload inlines logo
    // images (~1.4 MB for 24 validators): they are kept on the in-memory list
    // the picker renders, but stripped before the list is cached — 1.4 MB
    // would blow the storage quota.
    const raw: any[] = json.filter((v: any) => v?.address)
    // The yield formula divides by the network's TOTAL active stake (all
    // validators on chain), but the API only lists registered pools. Each
    // listed validator's `dominanceRatio` = its balance / network total, so
    // back out the network total from any validator with both fields.
    const inferred = raw
      .map((v: any) => ({
        bal: Number(v.balance) || 0,
        dom: Number(v.dominanceRatio) || 0,
      }))
      .filter((x) => x.bal > 0 && x.dom > 0)
      .map((x) => x.bal / x.dom)
    const networkStakeLuna =
      inferred.length > 0 ? inferred.reduce((a, b) => a + b, 0) / inferred.length : 0
    const validators: ValidatorInfo[] = raw.map((v) => {
      const fee = typeof v?.fee === 'number' ? v.fee : null
      const balance = Number(v.balance) || 0
      return {
        id: Number(v?.id),
        name: String(v?.name || v?.address || 'Unknown validator'),
        address: String(v?.address ?? ''),
        fee,
        reliability: typeof v?.score?.reliability === 'number' ? v.score.reliability : null,
        payoutType: typeof v?.payoutType === 'string' ? v.payoutType : undefined,
        isListed: v?.isListed !== false,
        balance,
        // Same convention as the Nimiq wallet's validator list: annual yield
        // on the network's total active stake, net of this pool's fee.
        annualReward: annualRewardFor(fee, networkStakeLuna),
        // Third-party content rendered into an <img src>: accept only inline
        // image data URIs, never a remote or javascript:/data:text/html URL.
        ...(typeof v?.logo === 'string' && v.logo.startsWith('data:image/') ? { logo: v.logo } : {}),
        ...(typeof v?.accentColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.accentColor)
          ? { accentColor: v.accentColor }
          : {}),
      }
    })
    if (validators.length === 0) throw new Error('Validators API returned no validators')
    try {
      // Logos are dropped here and only here: they are ~1.4 MB of base64 and
      // localStorage is a ~5 MB budget shared with history, receipts and
      // invoices. The returned list keeps them for this session's picker.
      const cacheable = validators.map(({ logo: _logo, ...v }) => v)
      localStorage.setItem(
        VALIDATORS_CACHE_KEY,
        JSON.stringify({ at: Date.now(), validators: cacheable } satisfies ValidatorCacheEntry)
      )
    } catch {
      /* storage full — the list just isn't cached */
    }
    return sortValidators(validators)
  } catch (e) {
    if (stale) {
      console.warn('Validators refresh failed, serving cached list:', e)
      return sortValidators(stale)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Pool fee as a percentage string ("1%", "3.33%"), or null when unpublished. */
export function formatValidatorFee(fee: number | null): string | null {
  if (fee === null || !Number.isFinite(fee)) return null
  const pct = fee * 100
  return `${Number(pct.toFixed(2))}%`
}

/** Net annual yield ("8.31% p.a."), matching the wallet's presentation. */
export function formatValidatorReward(annualReward: number | null): string | null {
  if (annualReward === null || !Number.isFinite(annualReward) || annualReward <= 0) return null
  return `${Number((annualReward * 100).toFixed(2))}% p.a.`
}

/**
 * Reliability as a percentage. The API can return marginally over 1.0
 * (a pool producing slightly above its expected share), so clamp at 100%.
 */
export function formatValidatorReliability(reliability: number | null): string | null {
  if (reliability === null || !Number.isFinite(reliability)) return null
  return `${Math.min(100, Math.max(0, reliability * 100)).toFixed(1)}%`
}

export function formatLuna(luna: string | number, locale = 'en'): string {
  const n = Number(luna) / 100000
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale, { maximumFractionDigits: 5 })
}

// --- Transaction classification (accounting correctness) ---

// Nimiq staking contract address (Albatross)
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
// Validator reward sender prefix (NQ81 C01N BASE…)
const VALIDATOR_REWARD_PREFIX = 'NQ81 C01N BASE'

export type TxKind = 'payment' | 'stake' | 'unstake' | 'reward' | 'fee' | 'unknown'

// The three legs of the unstake flow, recorded locally because the index never
// returns them (see lib/stakingLog.ts). Accounting-wise they are all one kind —
// stake on its way out — so `classifyTx` collapses them to 'unstake'; only the
// History chip distinguishes the leg.
export type StakingActionKind = 'deactivate' | 'retire' | 'withdraw' | 'stake'

// Kinds that read as an *unstake* in the UI. `stake` is deliberately not here:
// a synthetic stake row must classify as 'stake', not 'unstake'.
const STAKING_ACTION_KINDS: readonly string[] = ['deactivate', 'retire', 'withdraw']

export function classifyTx(tx: NimiqTx, ownAddress: string): TxKind {
  // Synthesized rows carry their kind: a restaked reward is paid by the
  // validator's own address, which no address rule can tell from a payment.
  if (tx.synthetic) {
    return STAKING_ACTION_KINDS.includes(tx.synthetic) ? 'unstake' : (tx.synthetic as TxKind)
  }
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
export type TxLabel = TxKind | 'swap' | 'vesting'

/**
 * Human-readable transaction type, shared by the history chips and the CSV
 * `kind` column so the two can never disagree.
 */
export function txLabel(tx: NimiqTx, ownAddress: string): TxLabel {
  // Staking: `toType` marks the deposit leg; the withdrawal leg is an ordinary
  // tx *from* the staking contract, which classifyTx recognises by sender.
  if (tx.toType === 3) return classifyTx(tx, ownAddress) === 'unstake' ? 'unstake' : 'stake'
  if (tx.toType === 2) return 'swap'
  if (tx.toType === 1) return 'vesting'
  return classifyTx(tx, ownAddress)
}

// Types worth calling out in the UI — a plain payment needs no chip.
export function isLabelledTxKind(label: TxLabel): boolean {
  return label !== 'payment' && label !== 'unknown' && label !== 'fee'
}

// Decode Nimiq tx data: hex → UTF-8 when possible, else raw hex
export function decodeMemo(data?: string): string {
  if (!data) return ''
  const hex = data.startsWith('0x') ? data.slice(2) : data
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return data
  try {
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Only accept printable text — reject binary garbage, but keep emojis and
    // non-Latin scripts (a memo like "Coffee ☕" is legit and must not fall
    // back to raw hex). Control chars are the signal of binary payloads.
    if (/[\x00-\x08\x0E-\x1F\x7F]/.test(text)) return data
    // Older NimBooks builds pre-encoded the memo before handing it to Nimiq
    // Pay, which hex-encodes again — so some live payments carry hex-of-hex.
    // When the first decode is itself valid hex, decode once more — but only
    // accept a pure-ASCII result, so a memo that merely *looks* like hex
    // (e.g. "deadbeef") is never mangled into high-byte garbage.
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

// Inverse of decodeMemo: UTF-8 text → hex, the form Nimiq tx data takes.
export function encodeMemo(text: string): string {
  return Array.from(new TextEncoder().encode(text))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function explorerTxUrl(hash: string): string {
  return `https://nimiq.watch/#${hash}`
}

export function formatUnits(raw: string | number, decimals: number, locale = 'en'): string {
  const n = Number(raw) / 10 ** decimals
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale, { maximumFractionDigits: decimals > 6 ? 4 : 2 })
}

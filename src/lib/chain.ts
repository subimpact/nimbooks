// Nimiq blockchain data client (RPC)

import { createPublicClient, http } from 'viem'
import { polygon, base, arbitrum, optimism, mainnet } from 'viem/chains'

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

// --- HTLC holdings (funds parked in a pending swap) ---

// Nimiq Pay routes transfers through HTLC contracts: the wallet funds a
// contract, then the counterparty claims it (or it refunds). While a swap is
// in flight the money lives in the contract, so the basic account reads 0 —
// `getNimiqBalance` alone under-reports what the user actually holds.
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
function contractCandidates(txs: NimiqTx[], toType: number): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const tx of [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))) {
    if (tx.toType !== toType || !tx.recipient) continue
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

const EVM_CHAINS = [
  { chain: polygon, symbol: 'POL', usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as const },
  { chain: base, symbol: 'ETH', usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as const },
  { chain: arbitrum, symbol: 'ETH', usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as const },
  { chain: optimism, symbol: 'ETH', usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' as const },
  { chain: mainnet, symbol: 'ETH', usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const },
]

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export async function getEvmBalances(address: string): Promise<EvmBalance[]> {
  const results = await Promise.allSettled(
    EVM_CHAINS.map(async ({ chain, symbol, usdt }) => {
      const client = createPublicClient({ chain, transport: http(undefined, { timeout: 8000 }) })
      const addr = address as `0x${string}`
      const nativeBal = await client.getBalance({ address: addr })
      const balances: EvmBalance[] = [
        {
          chainId: `0x${chain.id.toString(16)}`,
          chainName: chain.name,
          symbol,
          decimals: 18,
          balance: nativeBal.toString(),
        },
      ]
      if (usdt) {
        try {
          const usdtBal = await client.readContract({
            address: usdt,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [addr],
          })
          balances.push({
            chainId: `0x${chain.id.toString(16)}`,
            chainName: chain.name,
            symbol: 'USDT',
            decimals: 6,
            balance: usdtBal.toString(),
            contractAddress: usdt,
          })
        } catch {
          // USDT not deployed / read failed — skip silently
        }
      }
      return balances
    })
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// --- Fiat conversion ---

export interface FiatRates {
  usd: number
  myr: number
  [key: string]: number
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

export async function getFiatRates(asset: 'nim' | 'usdt' | 'usdc' | 'eth' | 'pol'): Promise<FiatRates> {
  const cache = readRateCache()
  const cached = cache[asset]
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.rates

  const id =
    asset === 'nim'
      ? 'nimiq-2'
      : asset === 'usdt'
        ? 'tether'
        : asset === 'usdc'
          ? 'usd-coin'
          : asset === 'eth'
            ? 'ethereum'
            : 'matic-network'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,myr`,
      { signal: controller.signal }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const json = await res.json()
    const rates: FiatRates = { usd: json[id]?.usd ?? 0, myr: json[id]?.myr ?? 0 }
    if (rates.usd > 0) {
      cache[asset] = { rates, at: Date.now() }
      writeRateCache(cache)
    }
    return rates
  } finally {
    clearTimeout(timer)
  }
}

// Single consolidated CoinGecko request for all tracked assets — one call,
// one cache entry. Prevents 429 rate-limit storms from 4 parallel requests.
export async function getAllFiatRates(): Promise<Record<'nim' | 'usdt' | 'eth' | 'pol', FiatRates>> {
  const cache = readRateCache()
  const fresh = (a: string) => {
    const c = cache[a]
    return c && Date.now() - c.at < CACHE_TTL ? c.rates : null
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
      'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether,ethereum,matic-network&vs_currencies=usd,myr',
      { signal: controller.signal }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const json = await res.json()
    const now = Date.now()
    const out = {
      nim: { usd: json['nimiq-2']?.usd ?? 0, myr: json['nimiq-2']?.myr ?? 0 },
      usdt: { usd: json['tether']?.usd ?? 0, myr: json['tether']?.myr ?? 0 },
      eth: { usd: json['ethereum']?.usd ?? 0, myr: json['ethereum']?.myr ?? 0 },
      pol: { usd: json['matic-network']?.usd ?? 0, myr: json['matic-network']?.myr ?? 0 },
    }
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
    // Only accept printable text — reject binary garbage
    return /^[\x20-\x7E\xA0-\xFF]*$/.test(text) ? text : data
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

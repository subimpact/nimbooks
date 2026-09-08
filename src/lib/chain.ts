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

export async function getNimiqTransactionHistory(address: string, maxTotal = 1000): Promise<NimiqTx[]> {
  // Serve from cache when fresh — repeat visits cost zero RPC calls.
  const cached = readTxCache(address)
  if (cached) return cached

  const all: NimiqTx[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const page = await getNimiqTransactions(address, 50, cursor)
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

export function explorerTxUrl(hash: string): string {
  return `https://nimiq.watch/#${hash}`
}

export function formatUnits(raw: string | number, decimals: number, locale = 'en'): string {
  const n = Number(raw) / 10 ** decimals
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale, { maximumFractionDigits: decimals > 6 ? 4 : 2 })
}

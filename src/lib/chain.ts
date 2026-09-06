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
    if (json.error) throw new Error(json.error.message || 'RPC error')
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

export async function getNimiqTransactions(address: string, max = 50): Promise<NimiqTx[]> {
  try {
    // Third param must be null (no startAt cursor) — '' fails deserialization
    const txs = await rpcCall('getTransactionsByAddress', [cleanAddress(address), max, null])
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
  { chain: base, symbol: 'ETH', usdt: undefined },
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

export function formatUnits(raw: string | number, decimals: number, locale = 'en'): string {
  const n = Number(raw) / 10 ** decimals
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale, { maximumFractionDigits: decimals > 6 ? 4 : 2 })
}

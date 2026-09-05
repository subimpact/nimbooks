// Nimiq blockchain data client (RPC)

const RPC_URL = 'https://rpc.nimiqwatch.com'

export interface NimiqTx {
  hash: string
  sender: string
  recipient: string
  value: string // Luna
  fee: string
  timestamp?: number
  data?: string
  blockNumber?: number
}

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'RPC error')
  return json.result?.data ?? json.result
}

export async function getNimiqBalance(address: string): Promise<string> {
  const data = await rpcCall('getAccountByAddress', [address])
  return data?.balance ?? '0'
}

export async function getNimiqTransactions(address: string, max = 50): Promise<NimiqTx[]> {
  try {
    const txs = await rpcCall('getTransactionsByAddress', [address, max, ''])
    if (!Array.isArray(txs)) return []
    return txs.map((t: any) => ({
      hash: t.hash ?? '',
      sender: t.from ?? t.fromAddress ?? '',
      recipient: t.to ?? t.toAddress ?? '',
      value: t.value ?? '0',
      fee: t.fee ?? '0',
      timestamp: t.timestamp ? Number(t.timestamp) : undefined,
      data: t.senderData ?? t.data ?? undefined,
      blockNumber: t.blockNumber ?? t.blockHeight,
    }))
  } catch (e) {
    console.warn('getNimiqTransactions failed:', e)
    return []
  }
}

export async function getNimiqBlockNumber(): Promise<number> {
  const data = await rpcCall('getBlockNumber', [])
  return Number(data)
}

// --- EVM side ---

export interface EvmBalance {
  chainId: string
  chainName: string
  symbol: string
  decimals: number
  balance: string // raw units
  contractAddress?: string
}

export const SUPPORTED_CHAINS = [
  { chainId: '0x89', name: 'Polygon', symbol: 'POL', native: true },
  { chainId: '0x2105', name: 'Base', symbol: 'ETH', native: true },
  { chainId: '0xa4b1', name: 'Arbitrum', symbol: 'ETH', native: true },
  { chainId: '0xa', name: 'Optimism', symbol: 'ETH', native: true },
  { chainId: '0x1', name: 'Ethereum', symbol: 'ETH', native: true },
]

export const USDT_ADDRESSES: Record<string, string> = {
  '0x89': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
  '0x1': '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
  '0xa4b1': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
  '0xa': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // Optimism
}

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
void ERC20_BALANCE_ABI

export async function getEvmBalances(address: string): Promise<EvmBalance[]> {
  const results: EvmBalance[] = []
  for (const chain of SUPPORTED_CHAINS) {
    try {
      // Native balance
      const eth = window.ethereum
      if (!eth) continue
      const native = await eth.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })
      results.push({
        chainId: chain.chainId,
        chainName: chain.name,
        symbol: chain.symbol,
        decimals: 18,
        balance: native ?? '0',
        native: true,
      } as EvmBalance)

      // USDT balance
      const usdtAddress = USDT_ADDRESSES[chain.chainId]
      if (usdtAddress) {
        const data = encodeBalanceOf(address)
        const raw = await eth.request({
          method: 'eth_call',
          params: [{ to: usdtAddress, data }, 'latest'],
        })
        results.push({
          chainId: chain.chainId,
          chainName: chain.name,
          symbol: 'USDT',
          decimals: 6,
          balance: raw ?? '0',
          contractAddress: usdtAddress,
        } as EvmBalance)
      }
    } catch (e) {
      console.warn(`EVM balance failed on ${chain.name}:`, e)
    }
  }
  return results
}

function encodeBalanceOf(account: string): string {
  // balanceOf(address) — 0x70a08231 + 32-byte padded address
  const selector = '0x70a08231'
  const padded = account.toLowerCase().replace('0x', '').padStart(64, '0')
  return selector + padded
}

// --- Fiat conversion ---

export interface FiatRates {
  usd: number
  myr: number
  [key: string]: number
}

const RATE_CACHE: Record<string, { rates: FiatRates; at: number }> = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 min

export async function getFiatRates(asset: 'nim' | 'usdt' | 'usdc' | 'eth' | 'pol'): Promise<FiatRates> {
  const cached = RATE_CACHE[asset]
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.rates

  const id = asset === 'nim' ? 'nimiq-2' : asset === 'usdt' ? 'tether' : asset === 'usdc' ? 'usd-coin' : asset === 'eth' ? 'ethereum' : 'matic-network'
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,myr`
  )
  const json = await res.json()
  const rates: FiatRates = { usd: json[id]?.usd ?? 0, myr: json[id]?.myr ?? 0 }
  RATE_CACHE[asset] = { rates, at: Date.now() }
  return rates
}

export function formatLuna(luna: string | number): string {
  const n = Number(luna) / 100000
  return n.toLocaleString(undefined, { maximumFractionDigits: 5 })
}

export function formatUnits(raw: string | number, decimals: number): string {
  const n = Number(raw) / 10 ** decimals
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 4 : 2 })
}

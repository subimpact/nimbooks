// EVM balance reads (viem). Split out from chain.ts so the whole viem
// dependency lands in its own lazy chunk: `chain.ts` reaches this module by
// dynamic import, and nothing else imports it at runtime.
//
// The imports below have to be *static* here. `viem/chains` is a barrel of
// ~500 chain definitions; a static import lets the bundler tree-shake it to
// the five we name, while `await import('viem/chains')` from chain.ts would
// retain the whole barrel (511 kB) because a namespace object is opaque.

import { createPublicClient, http } from 'viem'
import { polygon, base, arbitrum, optimism, mainnet } from 'viem/chains'
import type { EvmBalance } from './chain'

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

export async function readEvmBalances(address: string): Promise<EvmBalance[]> {
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

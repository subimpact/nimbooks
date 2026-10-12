import { fetchStakingHolding, getNimiqBalance } from './chain'

export const PORTFOLIO_STORAGE_KEY = 'nimbooks:portfolio:addresses'
export const PORTFOLIO_MAX_ADDRESSES = 10

export interface PortfolioAddress {
  address: string // spaced canonical form "NQ.. .... "
  label: string
}

export interface AddressHolding {
  address: string
  liquidLuna: number
  stakedLuna: number
  delegation: string
  error: boolean
}

export interface PortfolioTotals {
  liquidLuna: number
  stakedLuna: number
  totalLuna: number
  totalFiat: number
}

function cleanAddr(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Validates a Nimiq address using the MOD-97-10 checksum algorithm (IBAN-shaped).
 * Behavior is byte-identical to the original App.tsx implementation.
 */
export function isValidNimiqAddress(address: string): boolean {
  const addr = cleanAddr(address)
  if (!/^NQ[0-9A-Z]{34}$/.test(addr)) return false
  // IBAN validation: move the first four characters to the end, map letters to
  // their two-digit values (A=10 ... Z=35), and the whole number must be = 1.
  const raw = addr.slice(4) + addr.slice(0, 4)
  let remainder = 0
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    const digits = code >= 48 && code <= 57 ? ch : String(code - 55)
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/**
 * Formats an address into canonical uppercase groups of 4 characters separated by spaces.
 */
export function formatAddress(addr: string): string {
  const clean = cleanAddr(addr)
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}

/**
 * Loads extra portfolio addresses from localStorage. Never throws; drops malformed items.
 */
export function loadPortfolioAddresses(): PortfolioAddress[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const results: PortfolioAddress[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.address === 'string' &&
        isValidNimiqAddress(item.address)
      ) {
        const canonical = formatAddress(item.address)
        const key = cleanAddr(canonical)
        if (!seen.has(key)) {
          seen.add(key)
          results.push({
            address: canonical,
            label: typeof item.label === 'string' ? item.label.slice(0, 50) : '',
          })
          if (results.length >= PORTFOLIO_MAX_ADDRESSES) break
        }
      }
    }
    return results
  } catch {
    return []
  }
}

/**
 * Saves extra portfolio addresses to localStorage (max 10 entries). Never throws.
 */
export function savePortfolioAddresses(list: PortfolioAddress[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const cleanList: PortfolioAddress[] = []
    const seen = new Set<string>()
    for (const item of list) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.address === 'string' &&
        isValidNimiqAddress(item.address)
      ) {
        const canonical = formatAddress(item.address)
        const key = cleanAddr(canonical)
        if (!seen.has(key)) {
          seen.add(key)
          cleanList.push({
            address: canonical,
            label: typeof item.label === 'string' ? item.label.slice(0, 50) : '',
          })
          if (cleanList.length >= PORTFOLIO_MAX_ADDRESSES) break
        }
      }
    }
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(cleanList))
  } catch {
    // Ignore storage quota or access errors
  }
}

/**
 * Validates a candidate address against current portfolio entries and connected wallet.
 */
export function validateNewPortfolioAddress(
  candidate: string,
  existing: PortfolioAddress[],
  connectedAddress: string
): { valid: true; canonical: string } | { valid: false; error: string } {
  const trimmed = candidate.trim()
  if (!trimmed) {
    return { valid: false, error: 'Enter a Nimiq address.' }
  }
  if (!isValidNimiqAddress(trimmed)) {
    return { valid: false, error: 'Enter a valid Nimiq address.' }
  }
  const cleanCandidate = cleanAddr(trimmed)
  const cleanConnected = cleanAddr(connectedAddress)
  if (cleanConnected && cleanCandidate === cleanConnected) {
    return { valid: false, error: 'This is your connected wallet address.' }
  }
  if (existing.some((e) => cleanAddr(e.address) === cleanCandidate)) {
    return { valid: false, error: 'Address is already in your portfolio.' }
  }
  if (existing.length >= PORTFOLIO_MAX_ADDRESSES) {
    return { valid: false, error: 'Portfolio is limited to 10 extra addresses.' }
  }
  return { valid: true, canonical: formatAddress(trimmed) }
}

/**
 * Fetches liquid balance and staking holding for an address.
 * stakedLuna is active + inactive + retired.
 * Never throws; returns zeros with error: true on failure. A failed staking
 * lookup counts as a failure, not as zero staked, so the caller can keep the
 * last good figures instead of showing a wrong total.
 */
export async function fetchAddressHolding(address: string): Promise<AddressHolding> {
  const canonical = formatAddress(address)
  try {
    const [balanceStr, holding] = await Promise.all([
      getNimiqBalance(canonical),
      fetchStakingHolding(canonical),
    ])
    const liquid = Number(balanceStr)
    const liquidLuna = Number.isFinite(liquid) && liquid > 0 ? Math.floor(liquid) : 0
    const active = Number(holding?.active) || 0
    const inactive = Number(holding?.inactive) || 0
    const retired = Number(holding?.retired) || 0
    const staked = active + inactive + retired
    const stakedLuna = Number.isFinite(staked) && staked > 0 ? Math.floor(staked) : 0
    return {
      address: canonical,
      liquidLuna,
      stakedLuna,
      delegation: holding?.delegation ?? '',
      error: false,
    }
  } catch {
    return {
      address: canonical,
      liquidLuna: 0,
      stakedLuna: 0,
      delegation: '',
      error: true,
    }
  }
}

/**
 * Computes portfolio totals across liquid and staked Luna sums.
 * Non-finite inputs count as 0.
 */
export function portfolioTotals(
  rows: { liquidLuna: number; stakedLuna: number }[],
  nimPrice: number
): PortfolioTotals {
  let liquidLuna = 0
  let stakedLuna = 0
  for (const r of rows) {
    const l = Number.isFinite(r.liquidLuna) && r.liquidLuna > 0 ? Math.floor(r.liquidLuna) : 0
    const s = Number.isFinite(r.stakedLuna) && r.stakedLuna > 0 ? Math.floor(r.stakedLuna) : 0
    liquidLuna += l
    stakedLuna += s
  }
  const totalLuna = liquidLuna + stakedLuna
  const price = Number.isFinite(nimPrice) && nimPrice > 0 ? nimPrice : 0
  const totalFiat = (totalLuna / 100000) * price
  return {
    liquidLuna,
    stakedLuna,
    totalLuna,
    totalFiat,
  }
}

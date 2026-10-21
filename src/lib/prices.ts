// Price and FX chain: where the fiat numbers come from when CoinGecko would
// rather answer 429 than a price. Replaces the single CoinGecko call the app
// used before: two crypto price sources in front of it, two FX tables behind
// the Nimiq Wallet's own rate table, so the Total value tile survives a busy
// source by moving down the list instead of dropping to $0.00.
//
// Crypto USD tiers, tried in order (each must produce a sane NIM price):
//   1. prices.nim.sh - Nimiq's own price service (NIM, ETH, MATIC; USDT = 1)
//   2. DefiLlama - one consolidated call, all four assets
//   3. CoinGecko - USD only
//   4. last cached price, any age (the UI then shows "as of HH:MM")
//
// FX tiers (USD -> display currency), tried in order for anything missing:
//   1. Nimiq Wallet Firestore table
//   2. currency-api via jsDelivr (@fawazahmed0/currency-api)
//   3. ExchangeRate-API open access
//   4. last cached FX table, any age
//
// An unknown price is stored as NaN, never 0: 0 is a real (if worthless)
// rate, and $0.00 on screen for a non-zero balance is the one outcome this
// file must always prevent. See hasRate() in lib/chain.

import {
  CURRENCIES,
  RATE_CACHE_KEY,
  FX_CACHE_KEY,
  CACHE_TTL,
  NIM_MAX_PLAUSIBLE_USD,
  hasRate,
  type FiatRates,
} from './chain'

type RateAsset = 'nim' | 'usdt' | 'eth' | 'pol'

export interface PriceChainResult {
  nim: FiatRates
  usdt: FiatRates
  eth: FiatRates
  pol: FiatRates
  /** The raw USD -> display-currency table the asset prices were built from. */
  fx: FiatRates
  /** Time (ms) the NIM price used was observed at; null when none exists. */
  asOf: number | null
  /** Which crypto tier the NIM price came from. */
  priceSource: string
  /** Which FX tier the table came from. */
  fxSource: string
}

export const FX_CACHE_TTL = 60 * 60 * 1000 // 60 min

const NIM_SH_HOST = 'https://prices.nim.sh'
const LLAMA_URL =
  'https://coins.llama.fi/prices/current/coingecko:nimiq-2,coingecko:ethereum,coingecko:tether,coingecko:polygon-ecosystem-token'
const CG_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether,ethereum,matic-network&vs_currencies=usd'
const FIRESTORE_URL =
  'https://firestore.googleapis.com/v1/projects/checkout-service/databases/(default)/documents/exchangerates/rates'
const JSD_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'
const ER_API_URL = 'https://open.er-api.com/v6/latest/USD'

const FETCH_TIMEOUT = 4000

interface CryptoPrices {
  nim?: number
  usdt?: number
  eth?: number
  pol?: number
  /** When the NIM price was observed (ms). */
  at: number
}

/** One JSON GET, about 4 s, answered with null on anything but a usable body. */
async function fetchJson(url: string): Promise<any | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// --- Crypto tiers ---------------------------------------------------------

type AssetKey = keyof Omit<CryptoPrices, 'at'>

// Tier 1: Nimiq's own price service. Unsupported tickers answer 200 with an
// "error" field, so the body decides, never the status. Three tickers in
// parallel; USDT is definitionally $1 here (the endpoint answer for it too).
async function nimShTier(): Promise<CryptoPrices | null> {
  const defs: [AssetKey, string][] = [
    ['nim', 'NIM'],
    ['eth', 'ETH'],
    ['pol', 'MATIC'], // MATIC's value IS the POL price (same asset, renamed)
  ]
  const results = await Promise.all(
    defs.map(async ([key, ticker]) => {
      const json = await fetchJson(`${NIM_SH_HOST}/prices/${ticker}/now`)
      if (!json || typeof json === 'string' || json.error) return null
      const p = Number(json.price)
      if (!Number.isFinite(p)) return null
      return { key, p, timeSec: Number(json.time) }
    })
  )
  const out: CryptoPrices = { usdt: 1, at: Date.now() }
  let got = 0
  for (const r of results) {
    if (!r) continue
    out[r.key] = r.p
    // `time` is unix seconds of the tick the price was read at.
    if (Number.isFinite(r.timeSec) && r.timeSec > 0) out.at = Math.max(out.at, r.timeSec * 1000)
    got++
  }
  return got > 0 ? out : null
}

// Tier 2: DefiLlama, one call for all four assets.
const LLAMA_MAP: [AssetKey, string][] = [
  ['nim', 'coingecko:nimiq-2'],
  ['usdt', 'coingecko:tether'],
  ['eth', 'coingecko:ethereum'],
  ['pol', 'coingecko:polygon-ecosystem-token'],
]

async function llamaTier(): Promise<CryptoPrices | null> {
  const json = await fetchJson(LLAMA_URL)
  if (!json || !json.coins) return null
  const out: CryptoPrices = { at: Date.now() }
  let got = 0
  for (const [key, id] of LLAMA_MAP) {
    const p = Number(json.coins[id]?.price)
    if (Number.isFinite(p) && p > 0) {
      out[key] = p
      got++
    }
  }
  return got > 0 ? out : null
}

// Tier 3: CoinGecko, USD only - the FX side now comes from the dedicated
// ladder below, so the old 37-code vs_currencies query is gone (and with it
// most of the 429 surface).
const CG_MAP: [AssetKey, string][] = [
  ['nim', 'nimiq-2'],
  ['usdt', 'tether'],
  ['eth', 'ethereum'],
  ['pol', 'matic-network'],
]

async function coingeckoTier(): Promise<CryptoPrices | null> {
  const json = await fetchJson(CG_URL)
  if (!json) return null
  const out: CryptoPrices = { at: Date.now() }
  let got = 0
  for (const [key, id] of CG_MAP) {
    const p = Number(json[id]?.usd)
    if (Number.isFinite(p)) {
      out[key] = p
      got++
    }
  }
  return got > 0 ? out : null
}

// A live NIM price above this is a wrong-id response, not a rally: NIM has
// never traded near a cent, and sits around $0.0004 today. Applied to every
// tier, not just CoinGecko - the sanity rule moved with the chain.
function isPlausibleNim(p: number | undefined): p is number {
  return typeof p === 'number' && p > 0 && p < NIM_MAX_PLAUSIBLE_USD
}

// --- Crypto cache (shape written by this file, read by App.tsx preload) ----

interface CryptoCacheEntry {
  rates: FiatRates
  at: number
}

function readCryptoCache(): Record<string, CryptoCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(RATE_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeCryptoCache(cache: Record<string, CryptoCacheEntry>) {
  try {
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable */
  }
}

// Rates cached before a currency was added carry only the old keys; serving
// them whole would leave the new currency reading 0. The USD price cached
// under that key is still correct, so the tables are rebuilt from it instead.
function isFresh(entry: CryptoCacheEntry | undefined): boolean {
  return !!entry && Date.now() - entry.at < CACHE_TTL
}

/** Cached USD price of one asset, any age - the all-sources-down fallback. */
function cachedUsd(cache: Record<string, CryptoCacheEntry>, asset: RateAsset): { usd: number; at: number } | null {
  const entry = cache[asset]
  const usd = entry?.rates?.['usd']
  if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) return { usd, at: entry.at }
  return null
}

// --- FX tiers -------------------------------------------------------------

interface FxFetch {
  table: FiatRates // USD -> currency, units per 1 USD
  at: number
}

// Firestore wraps numbers as {"doubleValue": 0.89} or - for whole numbers -
// {"integerValue": "913"} with the digits in a STRING. Both forms exist side
// by side in the live table, so both are parsed or the table leaks NaN holes
// the later tiers then have to keep patching.
async function firestoreTier(): Promise<FxFetch | null> {
  const json = await fetchJson(FIRESTORE_URL)
  if (!json || !json.fields?.rates?.mapValue?.fields) return null
  const fields = json.fields.rates.mapValue.fields
  const table: FiatRates = {}
  let got = 0
  for (const c of CURRENCIES) {
    const f = fields[c.code.toUpperCase()]
    if (!f) continue
    const v = typeof f.doubleValue === 'number' ? f.doubleValue : Number.parseInt(f.integerValue, 10)
    if (Number.isFinite(v) && v > 0) {
      table[c.code] = v
      got++
    }
  }
  const at = Date.parse(json.updateTime) || Date.now()
  return got > 0 ? { table, at } : null
}

async function jsDelivrTier(): Promise<FxFetch | null> {
  const json = await fetchJson(JSD_URL)
  if (!json || !json.usd) return null
  const table: FiatRates = {}
  let got = 0
  for (const c of CURRENCIES) {
    const v = Number(json.usd[c.code])
    if (Number.isFinite(v) && v > 0) {
      table[c.code] = v
      got++
    }
  }
  return got > 0 ? { table, at: Date.now() } : null
}

async function erApiTier(): Promise<FxFetch | null> {
  const json = await fetchJson(ER_API_URL)
  if (!json || !json.rates) return null
  const table: FiatRates = {}
  let got = 0
  for (const c of CURRENCIES) {
    const v = Number(json.rates[c.code.toUpperCase()])
    if (Number.isFinite(v) && v > 0) {
      table[c.code] = v
      got++
    }
  }
  return got > 0 ? { table, at: Date.now() } : null
}

interface FxCache {
  table: FiatRates
  at: number
  source: string
}

function readFxCache(): FxCache | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed.table ? parsed : null
  } catch {
    return null
  }
}

function writeFxCache(fx: FxCache) {
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(fx))
  } catch {
    /* storage unavailable */
  }
}

/** The cached FX table, any age - used to seed the UI before the chain runs. */
export function readFxCached(): FxCache | null {
  return readFxCache()
}

// --- Assembly -------------------------------------------------------------

/** One asset's price table in every display currency, from its USD price. */
function tableFromUsd(usd: number | undefined, fx: FiatRates): FiatRates {
  if (!(typeof usd === 'number' && Number.isFinite(usd) && usd > 0)) return {}
  const out: FiatRates = { usd }
  for (const c of CURRENCIES) {
    if (c.code === 'usd') continue
    const r = fx[c.code]
    // An asset price exists but the currency's FX rate does not: that
    // currency behaves like "no price" for this asset, not like 0.
    out[c.code] = hasRate(r) ? (usd as number) * r : NaN
  }
  return out
}

function hasGaps(table: FiatRates): boolean {
  return CURRENCIES.some((c) => !hasRate(table[c.code]))
}

/**
 * Build the USD -> display-currency table, USD pinned at identity. Tiers are
 * consumed in order; a tier only counts as used when it covered the currency
 * on screen (tier 1 has to, per the chain contract), and every code a tier
 * left out is filled by the next tier that has it - or stays NaN unknown.
 * When all live tiers fail, the cached table (any age) is served instead.
 */
async function buildFx(selectedCurrency: string | undefined): Promise<{ table: FiatRates; source: string; at: number }> {
  const tiers: { source: string; fetch: () => Promise<FxFetch | null> }[] = [
    { source: 'nimiq', fetch: firestoreTier },
    { source: 'jsdelivr', fetch: jsDelivrTier },
    { source: 'er-api', fetch: erApiTier },
  ]
  const fs: (FxFetch | null)[] = [null, null, null]
  const table: FiatRates = { usd: 1 }
  // How far up the ladder we had to climb: stopped when the selected
  // currency is covered AND the table has no gaps left to patch.
  for (let i = 0; i < tiers.length; i++) {
    fs[i] = await tiers[i].fetch()
    const f = fs[i]
    if (f) {
      for (const c of CURRENCIES) {
        if (!hasRate(table[c.code]) && hasRate(f.table[c.code])) table[c.code] = f.table[c.code]
      }
      const selected = !selectedCurrency || hasRate(table[selectedCurrency])
      if (selected && !hasGaps(table)) break
    }
  }
  const usedCount = fs.filter((f) => f !== null).length
  if (usedCount > 0) {
    // The source label follows the FIRST tier that actually returned data -
    // later tiers only patch gaps, so they are not "the" source.
    const firstUsed = fs.findIndex((f) => f !== null)
    const at = Math.max(...fs.filter((f) => f).map((f) => (f as FxFetch).at))
    writeFxCache({ table, at, source: tiers[firstUsed].source })
    return { table, at, source: tiers[firstUsed].source }
  }
  // All live FX tiers down: cached table, any age.
  const cached = readFxCache()
  if (cached) return { table: cached.table, source: cached.source, at: cached.at }
  return { table: { usd: 1 }, source: 'none', at: Date.now() }
}

/**
 * The price chain. Never throws, never stores 0 for an unknown price, and
 * answers with the freshest thing it has: live tiers first, then any stale
 * cache, then NaN tables (the "Price unavailable" state) as a last resort.
 *
 * `selectedCurrency`, when given, must be covered by an FX tier for that
 * tier to count as having succeeded; the currency's asset prices still come
 * out as NaN when no tier can produce its rate.
 */
export async function getAllFiatRatesImpl(selectedCurrency?: string): Promise<PriceChainResult> {
  const cryptoCache = readCryptoCache()

  // A fresh cached FX table (60 min) answers without the network, like the
  // 5-minute crypto cache does for asset prices.
  const fxCache = readFxCache()
  const fx =
    fxCache && Date.now() - fxCache.at < FX_CACHE_TTL && !hasGaps(fxCache.table)
      ? { table: fxCache.table, source: fxCache.source, at: fxCache.at }
      : await buildFx(selectedCurrency)

  // Crypto: a fresh full cache answers without touching the network.
  const fresh = (a: RateAsset) => {
    const c = cryptoCache[a]
    return c && isFresh(c) && c.rates.usd > 0 && hasGaps(c.rates) === false ? c : null
  }
  const nimF = fresh('nim')
  const usdtF = fresh('usdt')
  const ethF = fresh('eth')
  const polF = fresh('pol')
  if (nimF && usdtF && ethF && polF) {
    return {
      nim: nimF.rates,
      usdt: usdtF.rates,
      eth: ethF.rates,
      pol: polF.rates,
      fx: fx.table,
      asOf: Math.max(nimF.at, usdtF.at, ethF.at, polF.at),
      priceSource: 'cache',
      fxSource: fx.source,
    }
  }

  // Live tiers, sequential, first tier with a plausible NIM price wins.
  const partials: (CryptoPrices | null)[] = []
  let winner: CryptoPrices | null = null
  for (const tier of [nimShTier, llamaTier, coingeckoTier]) {
    const res = await tier()
    // Every tier is clamped the same way: a NIM "price" at or above a cent
    // is a wrong-id response, not a rally (see isPlausibleNim).
    partials.push(res)
    if (res && isPlausibleNim(res.nim)) {
      winner = res
      break
    }
  }

  const usdPrices: Partial<Record<RateAsset, number>> = {}
  let at = 0
  for (const partial of partials) {
    if (!partial) continue
    at = Math.max(at, partial.at)
    for (const k of ['usdt', 'eth', 'pol'] as const) {
      const v = partial[k]
      // An asset a tier never produced is taken from the next tier that has
      // it; the NIM price itself comes from the winning tier only.
      if (Number.isFinite(v) && (v as number) > 0 && usdPrices[k] === undefined) usdPrices[k] = v as number
    }
  }

  let priceSource: string
  let asOf: number | null
  const newCache = readCryptoCache()
  if (winner) {
    usdPrices.nim = winner.nim
    at = Math.max(at, winner.at)
    priceSource = partials[0] === winner ? 'nim.sh' : partials[1] === winner ? 'llama' : 'coingecko'
    asOf = at
    // Per-asset cache entries, the shape the preload in App.tsx reads.
    newCache.nim = { rates: tableFromUsd(winner.nim, fx.table), at: winner.at }
    for (const k of ['usdt', 'eth', 'pol'] as const) {
      if (usdPrices[k] !== undefined) newCache[k] = { rates: tableFromUsd(usdPrices[k], fx.table), at }
    }
    writeCryptoCache(newCache)
  } else {
    // All live crypto tiers down: last cached USD price, any age. When that
    // is older than 30 minutes the tile shows "as of HH:MM"; when there is
    // none at all the tables stay NaN and the UI says Price unavailable.
    const nimCached = cachedUsd(cryptoCache, 'nim')
    if (nimCached) {
      usdPrices.nim = nimCached.usd
      for (const k of ['usdt', 'eth', 'pol'] as const) {
        const c = cachedUsd(cryptoCache, k)
        if (c) usdPrices[k] = c.usd
      }
      priceSource = 'cache'
      asOf = nimCached.at
    } else {
      priceSource = 'none'
      asOf = null
    }
  }

  return {
    nim: tableFromUsd(usdPrices.nim, fx.table),
    usdt: tableFromUsd(usdPrices.usdt, fx.table),
    eth: tableFromUsd(usdPrices.eth, fx.table),
    pol: tableFromUsd(usdPrices.pol, fx.table),
    fx: fx.table,
    asOf,
    priceSource,
    fxSource: fx.source,
  }
}
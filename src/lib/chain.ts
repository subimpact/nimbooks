// Nimiq blockchain data client (RPC)

import { CURRENCY_DATA } from './currencyData'
import {
  getLightBalance,
  getLightTransactions,
  hasLightFetcherForTests,
  historyRpcFirst,
  HISTORY_SOURCE_KEY,
  isLightReady,
  LIGHT_WALK_PAGE,
  setLightStatus,
} from './lightHistory'

// Oracles drive the light path through lightHistory's seam. Re-exported so a
// bundle of chain.ts can flip it without a second module instance. The status
// store rides along for the loading-progress oracle and the app's component.
export {
  getLightStatus,
  setHistoryRpcFirst,
  setLightFetcherForTests,
  setLightQueryTimeoutForTests,
  subscribeLightStatus,
  warmLightClient,
  type LightPhase,
  type LightStatus,
} from './lightHistory'

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
  // True for rows fetched from the wallet's *remote* address — the HTLC
  // contract Nimiq Pay stores funds in (see wallet.ts). The relay hops that
  // happen there are real transactions of the user's wallet but never appear
  // on the basic address list, so they are merged into History and classified
  // as HTLC flows instead of being hidden.
  remote?: boolean
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
  try {
    const data = await rpcCall('getAccountByAddress', [cleanAddress(address)])
    return String(data?.balance ?? '0')
  } catch (e) {
    // The public node is a single point of failure for the balance too, and
    // a wrong balance is worse than a slow one. The light client can read the
    // same account from the network; only when it cannot start either does
    // the original RPC error reach the caller.
    if (historyRpcFirst()) {
      // The sample wallet: a refusal is usually the node's per-IP allowance
      // (HTTP 429), which refills in seconds. One retry before starting a
      // 3.2 MB client, the same rule as its history walk.
      await new Promise((r) => setTimeout(r, sampleRpcRetryMs))
      try {
        const data = await rpcCall('getAccountByAddress', [cleanAddress(address)])
        return String(data?.balance ?? '0')
      } catch {
        /* still refused: the light client below */
      }
    }
    try {
      return String(await getLightBalance(address))
    } catch {
      throw e
    }
  }
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

/**
 * Just `{ type, balance }` of an account, for callers that only need to classify
 * it (see payContracts.syncContractArchive: settled HTLC contracts read back as
 * an empty basic account). `null` on anything unusable or any failure — callers
 * treat null as "unprocessed", never as "settled".
 */
export async function getContractAccount(address: string): Promise<{ type: string; balance: number } | null> {
  try {
    const data = await rpcCall('getAccountByAddress', [cleanAddress(address)])
    if (!data || typeof data.type !== 'string') return null
    const balance = Number(data.balance)
    return { type: data.type, balance: Number.isFinite(balance) ? balance : 0 }
  } catch {
    return null
  }
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
 * The staker record, read fresh. `null` means the address has never staked: the
 * RPC answers "No staker with address: …" as an error, not an empty result. A
 * throw means the lookup itself failed, so the answer is unknown. Callers that
 * already hold a record keep it on a throw (see refresh in App.tsx).
 */
export async function fetchStakingHolding(ownAddress: string): Promise<StakingHolding | null> {
  let data: any
  try {
    data = await rpcCall('getStakerByAddress', [cleanAddress(ownAddress)])
  } catch (e) {
    // "No staker with address: …" is the answer for every user who has never
    // staked — the common case, not a fault. Anything else is a real failure.
    const msg = e instanceof Error ? e.message : String(e)
    if (/no staker with address/i.test(msg)) return null
    throw e
  }
  if (typeof data?.balance !== 'number') return null
  return {
    address: ownAddress,
    active: String(data.balance),
    inactive: String(data.inactiveBalance ?? 0),
    retired: String(data.retiredBalance ?? 0),
    delegation: data.delegation ?? '',
    inactiveFrom: Number(data.inactiveFrom ?? 0) || 0,
  }
}

/**
 * fetchStakingHolding for callers that cannot hold a previous record: a failed
 * lookup reads as null, the same as a wallet that never staked.
 */
export async function getStakingHolding(ownAddress: string): Promise<StakingHolding | null> {
  try {
    return await fetchStakingHolding(ownAddress)
  } catch (e) {
    console.warn('Staker lookup failed:', e)
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

/**
 * Defensive conversion for a timestamp whose unit is not guaranteed: Nimiq 1.0
 * (PoW) RPC values are seconds, Nimiq 2.0 (PoS) values are milliseconds. Call
 * this at every `new Date(tx.timestamp)` site so a legacy seconds value
 * (< 100_000_000_000) renders the real historical year instead of 1970. Pure
 * passthrough for milliseconds and for 0/negative sentinels.
 */
export function timestampToMs(ts: number): number {
  return ts > 0 && ts < 100_000_000_000 ? ts * 1000 : ts
}

export function normalizeTimestamp(raw: any): number | undefined {
  if (raw == null) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  // Nimiq 1.0 (PoW) blocks stored Unix timestamps in seconds (10 digits, e.g. 1.6e9).
  // Nimiq 2.0 (PoS Albatross) blocks store Unix timestamps in milliseconds (13 digits, ~1.7e12).
  // When a timestamp is in seconds (< 100_000_000_000, i.e. < Sep 1973 in ms), multiply by 1000
  // so new Date(timestamp) renders the real historical year (e.g. 2020-2024) instead of 1970.
  return n < 100_000_000_000 ? Math.round(n * 1000) : Math.round(n)
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
      timestamp: normalizeTimestamp(t.timestamp),
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

// Full transaction history is walked by the startAt cursor until exhausted (cap
// at maxTotal to bound the request), newest→oldest, in TX_WALK_PAGE pages. A
// small delay between pages keeps us under the RPC rate limiter.
const TX_CACHE_PREFIX = 'nimbooks:txs'
const TX_CACHE_TTL = 2 * 60 * 1000 // 2 min — balances move, but not every second
// The heartbeat reads just the newest page (the RPC's own page size).
const TX_HEAD_PAGE = 50
// When a heartbeat finds nothing new it still re-stamps the slot, at most this
// often, so a manual refresh (2-minute TTL) keeps serving it. Rewriting up to
// 1000 rows on every tick would cost more than it buys.
const TX_HEAD_RESTAMP_MS = 60 * 1000

interface TxCacheEntry {
  address: string
  at: number
  txs: NimiqTx[]
  // Set when the walk that wrote the slot died partway (rate limit, network):
  // the heartbeat treats such a slot as unfinished and walks again.
  partial?: boolean
}

// One cache slot per address: the wallet's basic address and its remote HTLC
// relay are fetched independently and must never overwrite each other.
function txCacheKey(address: string): string {
  return `${TX_CACHE_PREFIX}:${cleanAddress(address)}`
}

// The slot as stored, whatever its age. `null` when there is no slot to use:
// none written, written for another address, dated in the future, or from
// before HTLC support (no `toType`).
function readTxCacheEntry(address: string): TxCacheEntry | null {
  try {
    const raw = localStorage.getItem(txCacheKey(address))
    if (!raw) return null
    const entry = JSON.parse(raw) as TxCacheEntry
    if (entry.address !== address) return null
    // A negative age means the entry claims to be from the future — a clock
    // that moved, or a hand-written entry that would otherwise never expire.
    // Either way it is not something to serve.
    if (Date.now() - entry.at < 0) return null
    // Entries cached before HTLC support carry no `toType`; serving them would
    // hide swap labels and locked balances until the TTL expired.
    if (entry.txs.some((t) => t.toType === undefined)) return null
    return {
      ...entry,
      txs: entry.txs.map((t) => ({
        ...t,
        timestamp: normalizeTimestamp(t.timestamp),
      })),
    }
  } catch {
    return null
  }
}

// The slot while it is within its TTL: what a manual refresh may serve.
function readTxCache(address: string): NimiqTx[] | null {
  const entry = readTxCacheEntry(address)
  if (!entry || Date.now() - entry.at > TX_CACHE_TTL) return null
  return entry.txs
}

function writeTxCache(address: string, txs: NimiqTx[], partial = false) {
  const key = txCacheKey(address)
  const payload = JSON.stringify({
    address,
    at: Date.now(),
    txs,
    ...(partial ? { partial: true } : {}),
  })
  try {
    localStorage.setItem(key, payload)
    return
  } catch {
    /* quota, most likely — make room once, below */
  }
  // The other history slots are the biggest things this app stores and the
  // cheapest to lose (they come back from the chain). Drop the largest one and
  // try again; if that still doesn't fit, the cache goes without, as before.
  try {
    let biggest: string | null = null
    let biggestLength = 0
    for (const k of Object.keys(localStorage)) {
      if (k === key || !k.startsWith(TX_CACHE_PREFIX)) continue
      const length = localStorage.getItem(k)?.length ?? 0
      if (length > biggestLength) {
        biggest = k
        biggestLength = length
      }
    }
    if (!biggest) return
    localStorage.removeItem(biggest)
    localStorage.setItem(key, payload)
  } catch {
    /* storage full — skip */
  }
}

// Drop the cached history — called after sending a transaction so the next
// refresh shows it instead of serving a 2-minute-old list. With no address it
// clears every slot (basic + remote), which is what a send needs: the new tx
// can land on either list.
export function clearTxCache(address?: string) {
  try {
    if (address) {
      localStorage.removeItem(txCacheKey(address))
      return
    }
    // Snapshot the key list first: removing while walking indices shifts every
    // key after the one that went, and a miscounted step would leave a slot
    // behind — exactly the stale list this call exists to get rid of.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(TX_CACHE_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    /* storage unavailable */
  }
}

// The full walk, cache ignored. Pages run newest→oldest on the cursor and stop
// at maxTotal, at the end of the history, or at the first page that fails.
// `complete` is false only when a page failed, so a caller can tell a short
// history from a walk that was cut short.
// Page size for the walk. nimiqwatch charges one rate-limit token per started
// 100 rows (20 tokens per 10 s per IP), so 50-row pages paid full price for half
// the rows: the old 20 x 50 walk spent a phone's whole allowance on one address,
// and a Nimiq Pay wallet walks two or more (its swap contracts too), which is
// what surfaced as "public node is busy". 500-row pages fetch the same 1000 rows
// for 10 tokens in 2 calls, and most wallets fit in the first call.
export const TX_WALK_PAGE = 500

// Where history rows come from. The light client reads the Nimiq network
// directly and is the default in the browser. The RPC answers what light
// clients cannot (rows before the PoS launch, and the tail of a busy address
// the client truncated to the current epoch) and takes over entirely when the
// light client cannot start. localStorage 'nimbooks:historySource' = 'rpc'
// pins the old path, and the test seam makes Node oracles take the light path
// without a window.
// The sample wallet's pause before its one RPC retry (see walkTransactionHistory).
const SAMPLE_RPC_RETRY_MS = 3000
let sampleRpcRetryMs = SAMPLE_RPC_RETRY_MS

/** Oracles shorten the sample wallet's RPC retry pause; null restores it. */
export function setSampleRpcRetryForTests(ms: number | null): void {
  sampleRpcRetryMs = ms ?? SAMPLE_RPC_RETRY_MS
}

function lightHistoryPreferred(): boolean {
  try {
    if (localStorage.getItem(HISTORY_SOURCE_KEY) === 'rpc') return false
  } catch {
    /* storage unavailable: use the default for this environment */
  }
  return typeof window !== 'undefined' || hasLightFetcherForTests()
}

// Merge the light pages with one RPC continuation: drop duplicates (a row can
// be in both), put the newest first and hold the cap.
function mergeHistoryRows(newer: NimiqTx[], older: NimiqTx[], maxTotal: number): NimiqTx[] {
  const seen = new Set<string>()
  const merged: NimiqTx[] = []
  for (const t of [...newer, ...older]) {
    if (t.hash) {
      if (seen.has(t.hash)) continue
      seen.add(t.hash)
    }
    merged.push(t)
  }
  merged.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  return merged.slice(0, maxTotal)
}

// Light pages newest to oldest, then exactly one RPC continuation. The
// continuation covers both gaps the light client leaves: pre-PoS rows (it only
// returns rows since the PoS launch) and the rest of a busy address the client
// truncated. When the RPC continuation fails the light rows still stand: they
// are correct, just not the whole history before the PoS launch.
//
// `null` means the light client could not even read its first page, and the
// caller should walk the RPC for the whole address as before. A failure on a
// later page falls back to that same RPC walk; the light rows gathered so far
// are kept only when that walk fails too.
async function walkLightHistory(
  address: string,
  maxTotal: number
): Promise<{ txs: NimiqTx[]; complete: boolean } | null> {
  const rows: NimiqTx[] = []
  let cursor: string | null = null
  let stopped = false
  const maxPages = Math.max(1, Math.ceil(maxTotal / LIGHT_WALK_PAGE))
  for (let i = 0; i < maxPages; i++) {
    let page: NimiqTx[]
    const want = Math.min(LIGHT_WALK_PAGE, maxTotal - rows.length)
    try {
      page = await getLightTransactions(address, want, cursor)
    } catch (e) {
      if (i === 0) {
        console.warn('Light history unavailable, using the public node:', e)
        return null
      }
      console.warn(`Light history stopped at page ${i + 1}:`, e)
      stopped = true
      break
    }
    if (!page.length) break
    rows.push(...page)
    // The progress line counts what the network has delivered so far, not the
    // merged list: the RPC continuation has its own step.
    setLightStatus('loading', rows.length)
    // A short page is the end of what the client has for this address.
    if (page.length < want || rows.length >= maxTotal) break
    // The client returns newest→oldest; the oldest hash becomes the cursor.
    const oldest = page[page.length - 1]
    if (!oldest?.hash || oldest.hash === cursor) break
    cursor = oldest.hash
  }
  const lightRows = rows.slice(0, maxTotal)
  if (stopped) {
    setLightStatus('fallback', lightRows.length)
    const fallback = await walkTransactionHistoryRpc(address, maxTotal)
    if (fallback.complete) {
      setLightStatus('done', fallback.txs.length)
      return fallback
    }
    // A later light page died and the RPC could not finish either. The light
    // rows already read are still correct, so keep them rather than show
    // nothing; only an empty result is a real failure.
    if (!lightRows.length) {
      setLightStatus('failed')
      return fallback
    }
    setLightStatus('done', lightRows.length)
    return { txs: lightRows, complete: false }
  }
  // One continuation only, even for a light walk that found nothing: an
  // address may hold pre-PoS history alone. startAt null asks for the newest
  // RPC rows, which is the same as "everything" for the 1000-row cap.
  if (lightRows.length < maxTotal) {
    setLightStatus('older', lightRows.length)
    const oldestLightHash = lightRows.length ? lightRows[lightRows.length - 1].hash : null
    try {
      const older = await getNimiqTransactions(address, maxTotal - lightRows.length, oldestLightHash)
      const merged = mergeHistoryRows(lightRows, older, maxTotal)
      setLightStatus('done', merged.length)
      return { txs: merged, complete: true }
    } catch (e) {
      console.warn('History continuation from the public node failed, keeping light rows:', e)
    }
  }
  setLightStatus('done', lightRows.length)
  return { txs: lightRows, complete: true }
}

async function walkTransactionHistory(
  address: string,
  maxTotal: number
): Promise<{ txs: NimiqTx[]; complete: boolean }> {
  if (lightHistoryPreferred() && historyRpcFirst()) {
    // The sample wallet: the public node first, the light client only when the
    // node fails or stops part way. Nothing reaches the progress line unless
    // the light client is actually used.
    let rpc = await walkTransactionHistoryRpc(address, maxTotal)
    if (rpc.complete) return rpc
    // Usually a busy node (HTTP 429: 20 tokens per 10 s per IP), not a dead
    // one. Its allowance refills within seconds, while a cold light client
    // needs 10 to 33 s, so give the node one more try first.
    await new Promise((r) => setTimeout(r, sampleRpcRetryMs))
    rpc = await walkTransactionHistoryRpc(address, maxTotal)
    if (rpc.complete) return rpc
    const light = await walkLightHistory(address, maxTotal)
    if (light && light.txs.length >= rpc.txs.length) return light
    if (!light) setLightStatus(rpc.txs.length ? 'done' : 'failed', rpc.txs.length)
    return rpc
  }
  if (lightHistoryPreferred()) {
    const light = await walkLightHistory(address, maxTotal)
    if (light) return light
    // The client could not read its first page at all: the public node takes
    // over the whole walk. The progress line says so, then reports how that
    // walk ended instead of leaving a stale "connecting".
    setLightStatus('fallback')
    const rpc = await walkTransactionHistoryRpc(address, maxTotal)
    if (!rpc.complete && rpc.txs.length === 0) setLightStatus('failed')
    else setLightStatus('done', rpc.txs.length)
    return rpc
  }
  // The RPC-only path reports nothing: the progress line belongs to the light
  // client, and the support switch must behave exactly as it did before it.
  return walkTransactionHistoryRpc(address, maxTotal)
}

async function walkTransactionHistoryRpc(
  address: string,
  maxTotal: number
): Promise<{ txs: NimiqTx[]; complete: boolean }> {
  const all: NimiqTx[] = []
  let cursor: string | null = null
  const maxPages = Math.max(1, Math.ceil(maxTotal / TX_WALK_PAGE))
  for (let i = 0; i < maxPages; i++) {
    let page: NimiqTx[]
    try {
      // Never ask for more than the cap still needs: the token bill follows the
      // rows requested, not the rows kept.
      page = await getNimiqTransactions(address, Math.min(TX_WALK_PAGE, maxTotal - all.length), cursor)
    } catch (e) {
      // A mid-pagination failure (rate limit, flaky network) must not wipe the
      // whole history — return what we already have so the user sees txs.
      console.warn(`History pagination stopped at page ${i + 1}:`, e)
      return { txs: all, complete: false }
    }
    if (!page.length) break
    all.push(...page)
    if (all.length >= maxTotal) break
    // The RPC returns newest→oldest; the oldest hash becomes the next cursor.
    const oldest = page[page.length - 1]
    if (!oldest?.hash || oldest.hash === cursor) break
    cursor = oldest.hash
    if (i < maxPages - 1) await new Promise((r) => setTimeout(r, 250))
  }
  return { txs: all.slice(0, maxTotal), complete: true }
}

// Fetch the full transaction history, newest→oldest. Served from the cache while
// it is within its TTL, so repeat visits cost zero RPC calls.
export async function getNimiqTransactionHistory(address: string, maxTotal = 1000): Promise<NimiqTx[]> {
  const cached = readTxCache(address)
  if (cached) return cached
  const { txs, complete } = await walkTransactionHistory(address, maxTotal)
  if (txs.length) writeTxCache(address, txs, !complete)
  return txs
}

// The heartbeat's read of a transaction list (the 10 s auto-refresh). Manual
// refreshes, the first load and the post-send flow keep using
// getNimiqTransactionHistory, so they keep their 2-minute TTL.
//
// With a usable slot the heartbeat asks for the newest page only and merges in
// what the slot does not hold yet, so a new payment shows within one tick. The
// slot's age does not matter here: these merges keep it current. Without a usable
// slot, or when the newest page holds nothing the slot knows (txs may have landed
// beyond what it holds), it walks the full history instead.
export async function refreshTransactionHead(address: string, maxTotal = 1000): Promise<NimiqTx[]> {
  const entry = readTxCacheEntry(address)
  if (!entry || entry.partial || entry.txs.length === 0) {
    return walkForHeartbeat(address, maxTotal, entry?.txs ?? [])
  }
  const held = entry.txs
  let head: NimiqTx[]
  try {
    head = await getNimiqTransactions(address, TX_HEAD_PAGE, null)
  } catch {
    // The RPC head is the cheap read, but it is also the one that goes away
    // with rpc.nimiqwatch.com. If a light client is already in consensus, the
    // same newest rows can come from the network instead.
    if (!isLightReady()) {
      // A failed head fetch never costs the cache: the rows on screen stay.
      return held
    }
    try {
      head = await getLightTransactions(address, TX_HEAD_PAGE, null)
    } catch {
      return held
    }
  }
  if (head.length === 0) return held
  const heldHashes = new Set(held.map((t) => t.hash))
  if (head.every((t) => !heldHashes.has(t.hash))) return walkForHeartbeat(address, maxTotal, held)
  const merged = mergeHeadRows(head, held).slice(0, maxTotal)
  if (!sameTxList(merged, held) || Date.now() - entry.at > TX_HEAD_RESTAMP_MS) {
    writeTxCache(address, merged)
  }
  return merged
}

// The walk the heartbeat falls back to. It never trades a slot that has rows for
// something worse: an empty walk, or a cut-short one no longer than the slot,
// leaves the slot as it was.
async function walkForHeartbeat(address: string, maxTotal: number, held: NimiqTx[]): Promise<NimiqTx[]> {
  const { txs, complete } = await walkTransactionHistory(address, maxTotal)
  if ((complete && txs.length === 0 && held.length > 0) || (!complete && held.length >= txs.length)) {
    return held
  }
  if (txs.length) writeTxCache(address, txs, !complete)
  return txs
}

// Newest page first, then the held rows the page did not reach. A row the slot
// already holds is reused, unless its result has moved (pending → confirmed, or
// reverted): then the page's copy takes its place.
function mergeHeadRows(head: NimiqTx[], held: NimiqTx[]): NimiqTx[] {
  const heldByHash = new Map<string, NimiqTx>()
  for (const t of held) if (!heldByHash.has(t.hash)) heldByHash.set(t.hash, t)
  const seen = new Set<string>()
  const merged: NimiqTx[] = []
  for (const row of head) {
    if (seen.has(row.hash)) continue
    seen.add(row.hash)
    const old = heldByHash.get(row.hash)
    merged.push(old && old.executionResult === row.executionResult ? old : row)
  }
  for (const t of held) {
    if (seen.has(t.hash)) continue
    seen.add(t.hash)
    merged.push(t)
  }
  return merged
}

/**
 * Same rows in the same order, with the same hash, result and value. Lets a
 * refresh that finds nothing new keep the list it already has, so nothing
 * derived from it recomputes.
 */
export function sameTxList(a: NimiqTx[], b: NimiqTx[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.hash !== y.hash || x.executionResult !== y.executionResult || x.value !== y.value) {
      return false
    }
  }
  return true
}

/** Same staker record, field by field (see sameTxList). */
export function sameStakingHolding(a: StakingHolding | null, b: StakingHolding | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.address === b.address &&
    a.active === b.active &&
    a.inactive === b.inactive &&
    a.retired === b.retired &&
    a.delegation === b.delegation &&
    a.inactiveFrom === b.inactiveFrom
  )
}

// --- Older-history loader (on-demand extension of the capped window) ---

// The 1000-tx history cap keeps the every-refresh walk cheap, but active
// wallets blow past it in a year, and the statement's year picker, tax FIFO
// and analytics then silently miss everything older. This loader walks further
// back on demand, one user-initiated call per session: 10,000-tx pages at a
// slow pace (the 250ms pacing above is only enough for 50-tx pages; bursts
// here measured 429s), a wall-clock budget and a tx ceiling so a 44k-tx pool
// wallet can't pin the tab, and a graceful partial return when the limiter
// wins anyway.

export interface ExtendedHistoryResult {
  txs: NimiqTx[]
  totalFetched: number
  partial: boolean
  earliestTsMs: number | null
  hitBudget: boolean
}

export interface ExtendedHistoryOptions {
  // Stop once the window reaches back past this timestamp (ms). Omitted, the
  // walk runs until the caps below say stop.
  oldestMs?: number
  // Ceiling on the merged, deduped list (default 50000).
  maxTotal?: number
  // Per-page progress: merged, deduped count so far.
  onProgress?: (fetched: number) => void
}

const EXTENDED_PAGE_SIZE = 10000
const EXTENDED_PAGE_PACE_MS = 2000
const EXTENDED_RATE_LIMIT_WAIT_MS = 20000
const EXTENDED_RATE_LIMIT_RETRIES = 3
const EXTENDED_DEFAULT_MAX_TOTAL = 50000
const EXTENDED_BUDGET_MS = 180000

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /rate limit|HTTP 429/i.test(msg)
}

// The plain history loader self-caps at 1000 txs; anything that long is
// almost certainly truncated, which is what makes the older-history button
// worth showing. Only chain rows count toward the cap: the synthesized reward
// rows ride in the same list in the hundreds, and a wallet with 700 real
// transactions is not capped.
export function historyHitCap(txs: NimiqTx[]): boolean {
  return txs.filter((t) => !t.synthetic).length >= 1000
}

export async function getNimiqExtendedTransactionHistory(
  address: string,
  opts: ExtendedHistoryOptions = {}
): Promise<ExtendedHistoryResult> {
  const maxTotal = opts.maxTotal ?? EXTENDED_DEFAULT_MAX_TOTAL
  const startedAt = Date.now()
  const pace = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  // The capped cache window is the base: it is already fetched, already
  // written, and its oldest hash is exactly where back-pagination starts. The
  // result is deliberately NOT written back here — a 44k-tx list would blow
  // the 5MB quota every other cache slot shares.
  const base = readTxCache(address) ?? []
  const seen = new Set<string>()
  const merged: NimiqTx[] = []
  let earliestTsMs: number | null = null
  let oldestBase: NimiqTx | null = null
  for (const t of base) {
    if (!t.hash || seen.has(t.hash)) continue
    seen.add(t.hash)
    merged.push(t)
    if (t.timestamp != null && (earliestTsMs === null || t.timestamp < earliestTsMs))
      earliestTsMs = t.timestamp
    if (oldestBase === null || (t.timestamp ?? 0) < (oldestBase.timestamp ?? 0)) oldestBase = t
  }
  // Cursor for the walk: the base window's oldest hash, or null to start from
  // the chain head when the cache came back expired/empty.
  let cursor: string | null = oldestBase?.hash ?? null

  let partial = false
  let hitBudget = false
  let retriesLeft = EXTENDED_RATE_LIMIT_RETRIES

  for (;;) {
    if (Date.now() - startedAt >= EXTENDED_BUDGET_MS) {
      hitBudget = true
      break
    }
    if (merged.length >= maxTotal) break

    let page: NimiqTx[]
    try {
      page = await getNimiqTransactions(address, EXTENDED_PAGE_SIZE, cursor)
    } catch (e) {
      // A limited page is retried on the same cursor after a long cool-off;
      // three of those, or any other mid-walk failure, ends the walk with
      // whatever was collected — a partial older window still beats none.
      if (isRateLimitError(e) && retriesLeft > 0) {
        retriesLeft--
        await pace(EXTENDED_RATE_LIMIT_WAIT_MS)
        continue
      }
      partial = true
      break
    }
    if (page.length === 0) break
    retriesLeft = EXTENDED_RATE_LIMIT_RETRIES

    // Pages arrive newest→oldest, but hashes can repeat across overlapping
    // walks (the base window especially); dedupe before counting anything.
    let pageOldestTs: number | null = null
    for (const t of page) {
      if (!t.hash || seen.has(t.hash)) continue
      seen.add(t.hash)
      merged.push(t)
      if (t.timestamp == null) continue
      if (earliestTsMs === null || t.timestamp < earliestTsMs) earliestTsMs = t.timestamp
      if (pageOldestTs === null || t.timestamp < pageOldestTs) pageOldestTs = t.timestamp
    }
    opts.onProgress?.(merged.length)

    if (pageOldestTs !== null && opts.oldestMs !== undefined && pageOldestTs < opts.oldestMs) break
    if (merged.length >= maxTotal) break
    const next = page[page.length - 1]?.hash ?? null
    if (!next || next === cursor) break
    cursor = next
    await pace(EXTENDED_PAGE_PACE_MS)
  }

  merged.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  return { txs: merged, totalFetched: merged.length, partial, earliestTsMs, hitBudget }
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
      timestamp: normalizeTimestamp(t.timestamp),
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
 * Locate a just-sent transaction. Nimiq Pay now resolves its send calls with
 * the transaction hash, so this lookup is only the fallback for older Pay
 * builds that returned a serialized transaction (the hash is recovered by
 * matching recipient + value + data against fresh (uncached) history pages).
 * It is also what a caller without any hash uses, e.g. when Pay rejected a
 * send with "outcome unknown" and kept no staged hash.
 *
 * The sender's history is checked first — most sends index there. But when
 * Nimiq Pay funds the payment from the wallet's HTLC remote account (the
 * relay-routed case that makes the basic balance read 0), the on-chain shape
 * is contract → recipient and the sender's own address never appears in the
 * transfer's `from`. The receiving side is always indexed though, so the
 * recipient's history is scanned as the fallback that catches those sends.
 * The match must be the *incoming* direction: the recipient's history lists
 * this transfer as a credit, never as a debit.
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
  const matchTx = (t: NimiqTx): boolean => {
    if (cleanAddress(t.recipient).toUpperCase() !== wantRecipient) return false
    if (String(t.value) !== String(valueLuna)) return false
    if (wantData && (t.data ?? '').toLowerCase() !== wantData) return false
    return true
  }
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs))
    try {
      // Sender-side history: a normal send indexes with the sender as `from`.
      // The sender is left unconstrained here on purpose — an HTLC-funded
      // send may read back with a contract address as `from`.
      const fromTxs = await getNimiqTransactions(from, 20, null)
      const fromMatch = fromTxs.find(matchTx)
      if (fromMatch) return fromMatch
      // HTLC-funded sends don't index on the sender (see docblock); the
      // recipient's history is the reliable place the hash shows up. Only a
      // *credit* counts there — an outgoing payment from the recipient with
      // identical value/data must not be mistaken for this send.
      const toTxs = await getNimiqTransactions(recipient, 20, null)
      const toMatch = toTxs.find(
        (t) =>
          matchTx(t) && cleanAddress(t.sender).toUpperCase() !== wantRecipient
      )
      if (toMatch) return toMatch
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

// Display currencies offered by the currency switcher: all 148 rows of the
// vetted list in currencyData.ts. The original 37 keep their exact label,
// symbol and flag; every later row gets the uppercase code as its label, the
// international symbol where it differs from the bare code ("AED " padding
// where it does not, same pattern as the original AED entry), and the flag of
// the country its code starts with (ISO 4217 codes begin with the ISO 3166
// country code), from the same Nimiq wallet flag set in public/flags/. The
// shared currencies (XAF, XCD, XCG, XOF, XPF) and the three the set has no
// flag for (GYD, SHP, SZL) keep the neutral code badge instead.
export type CurrencyCode = string

export interface CurrencyEntry {
  code: CurrencyCode
  label: string
  symbol: string
  flag?: string
  name: string
}

// The original 37, in their long-standing order. Frozen exactly as shipped:
// crypto prices were published for this set before the switch to the wider
// list, and the tax report still speaks these codes (see TAX_CURRENCIES).
const ORIGINAL_CURRENCIES: Omit<CurrencyEntry, 'name'>[] = [
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

/** Currencies tax reports can be computed in today (the original 37): the
 *  historical daily FX needed for the wider list does not exist yet. */
export const TAX_CURRENCIES: CurrencyCode[] = ORIGINAL_CURRENCIES.map((c) => c.code)

// The Nimiq Wallet's own picker set (the 37 plus CRC/GMD/GTQ/XOF), kept in
// its order: this is the "Popular" section of the currency picker.
const WALLET_EXTRA: CurrencyCode[] = ['crc', 'gmd', 'gtq', 'xof']
export const WALLET_CURRENCIES: CurrencyCode[] = [...TAX_CURRENCIES, ...WALLET_EXTRA]

const ORIG_BY_CODE = new Map(ORIGINAL_CURRENCIES.map((c) => [c.code, c]))

// No single-country flag exists for these (see the note above the type).
const FLAGLESS_CODES = new Set(['gyd', 'shp', 'szl', 'xaf', 'xcd', 'xcg', 'xof', 'xpf'])

export const CURRENCIES: CurrencyEntry[] = CURRENCY_DATA.map((meta) => {
  const orig = ORIG_BY_CODE.get(meta.code)
  if (orig) return { ...orig, name: meta.name }
  const up = meta.code.toUpperCase()
  return {
    code: meta.code,
    label: up,
    symbol: meta.intlSymbol !== up ? meta.intlSymbol : `${up} `,
    ...(FLAGLESS_CODES.has(meta.code) ? {} : { flag: up.slice(0, 2) }),
    name: meta.name,
  }
})

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
const ZERO_DECIMAL = new Set<string>([
  'clp', 'idr', 'jpy', 'krw', 'vnd',
  ...CURRENCY_DATA.filter((c) => c.decimals === 0).map((c) => c.code),
])

/**
 * Money for display, grouped by the browser's locale so it lines up with the
 * NIM figures above it (formatLuna already groups). Sub-cent amounts get 4
 * decimals so a small NIM balance never reads as "$0.00"; pass `decimals` to
 * pin the precision instead.
 */
export function formatFiat(amount: number, code: CurrencyCode, decimals?: number): string {
  // Unknown price (NaN from the rate chain) is never money: "$0.00" for a
  // non-zero balance lies, "…" under-informs - say what is missing instead.
  if (!Number.isFinite(amount)) return PRICE_UNAVAILABLE
  const n = amount
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

/** Text shown wherever a price is wanted but the chain could not produce one. */
export const PRICE_UNAVAILABLE = 'Price unavailable'

/** A usable rate: finite and positive. NaN or 0 marks "unknown" in the tables. */
export function hasRate(rate: number | undefined | null): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

export const RATE_CACHE_KEY = 'nimbooks:rates'
export const FX_CACHE_KEY = 'nimbooks:fx'
export const CACHE_TTL = 5 * 60 * 1000 // 5 min

// A live NIM price at or above this is a wrong-id response, not a rally: NIM
// has never traded near a cent, and sits around $0.0004 today. The 365-day
// statement uses a looser bound (lib/statement.ts) - it prices the past, where
// a genuine high must not be silently dropped.
export const NIM_MAX_PLAUSIBLE_USD = 0.01

// The cache keys' format is shared with src/lib/prices.ts, which owns the
// caches now (crypto per asset under 'nimbooks:rates', the FX table whole
// under 'nimbooks:fx'). Reading the crypto cache is still needed here so the
// UI can seed itself without a flash of $0.00.
export function readRateCache(): Record<string, { rates: FiatRates; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(RATE_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

// The price chain itself (crypto tiers + FX ladder, caches included) lives in
// src/lib/prices.ts. The name and the { nim, usdt, eth, pol } shape stay so
// every caller keeps working; the result gains asOf and source info.
export type { PriceChainResult } from './prices'
export function getAllFiatRates(selectedCurrency?: CurrencyCode) {
  return getAllFiatRatesImpl(selectedCurrency)
}
import { getAllFiatRatesImpl } from './prices'

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
  // Free text from the API ('Every 12 hours', '0 */6 * * *', a sentence, '').
  // Missing means an old cache from before this field existed: unknown.
  payoutSchedule?: string
  isListed: boolean
  balance: number // Luna staked with this validator (for network total)
  annualReward: number | null // net annual yield after fee, as a fraction (0.0831 = 8.31% p.a.)
  // Picker branding. Full logos are inlined data URIs and the payload is
  // ~1.4 MB, so only baked LOGO THUMBNAILS (a few KB each) are stored in the
  // cache; `logo` itself stays in-memory. A cache hit still renders real
  // icons, instantly and offline, from `logoSmall`.
  logo?: string // data:image/… URI (in-memory only)
  logoSmall?: string // small baked thumbnail, rides in the cache
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

/** Circulating NIM supply (Luna) at a moment, on the protocol's emission curve. */
export function supplyAtTime(ms: number): number {
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
 * Builder's-pool marker: ImpactZero, the validator run by the developer of
 * NimBooks. The list is sorted neutrally; nothing is pinned first any more,
 * but the picker still needs the address to label the pool as the builder's,
 * and the stake gate still needs to recognise it.
 */
export const PINNED_VALIDATOR_ADDRESS = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'

export function isPinnedValidator(address: string): boolean {
  return cleanAddress(address).toUpperCase() === cleanAddress(PINNED_VALIDATOR_ADDRESS).toUpperCase()
}

/**
 * The validator order, as one pure comparator so tests can pin it down.
 *
 * Producing pools (a reliability score this epoch) come first, ordered by net
 * annual yield descending with any pool that publishes no yield last, then by
 * reliability descending, then by name so the order is stable between loads.
 * Non-producing pools (null reliability, not earning anything) come last,
 * ordered the same inner way.
 */
export function compareValidators(a: ValidatorInfo, b: ValidatorInfo): number {
  const ar = a.reliability
  const br = b.reliability
  // Producing before non-producing, either way.
  if (ar === null && br !== null) return 1
  if (br === null && ar !== null) return -1
  const ay = a.annualReward
  const by = b.annualReward
  // Net yield descending within each group, no-yield pools last.
  if (ay === null && by !== null) return 1
  if (by === null && ay !== null) return -1
  if (ay !== null && by !== null && ay !== by) return by - ay
  // Reliability descending, for pools that share a yield.
  if (ar !== null && br !== null && ar !== br) return br - ar
  return a.name.localeCompare(b.name)
}

/**
 * Neutral order: nothing is pinned first and the builder's pool ranks exactly
 * like any other. See `compareValidators` for the precise order.
 */
export function sortValidators(list: ValidatorInfo[]): ValidatorInfo[] {
  return [...list].sort(compareValidators)
}

/**
 * Bake a small thumbnail from an inlined logo data URI.
 *
 * Logos arrive as PNG / WebP / SVG data URIs and together weigh ~1.4 MB, far
 * too much for localStorage. A 64 px raster is a few KB and is all the 28 px
 * picker rows ever need, so thumbnails are baked at fetch time and ride in
 * the cache. Best-effort: any decode/encode failure (or an oversized result)
 * returns null and the row falls back to the monogram chip.
 */
function bakeLogoThumb(dataUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null)
    let settled = false
    const done = (v: string | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    try {
      const img = new Image()
      const timer = setTimeout(() => done(null), 2500)
      img.onload = () => {
        clearTimeout(timer)
        try {
          const w = img.naturalWidth
          const h = img.naturalHeight
          if (!w || !h) return done(null)
          const render = (px: number) => {
            const scale = Math.min(px / w, px / h)
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(w * scale))
            canvas.height = Math.max(1, Math.round(h * scale))
            const ctx = canvas.getContext('2d')
            if (!ctx) return null
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            let out = canvas.toDataURL('image/webp', 0.8)
            if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png')
            return out.length <= 16_000 ? out : null
          }
          done(render(64) ?? render(40))
        } catch {
          done(null)
        }
      }
      img.onerror = () => {
        clearTimeout(timer)
        done(null)
      }
      img.src = dataUri
    } catch {
      done(null)
    }
  })
}

/** Bake thumbnails for a fresh validator list (parallel, best-effort per row). */
async function withLogoThumbs(validators: ValidatorInfo[]): Promise<ValidatorInfo[]> {
  return Promise.all(
    validators.map(async (v) => {
      if (!v.logo) return v
      const logoSmall = await bakeLogoThumb(v.logo)
      return logoSmall ? { ...v, logoSmall } : v
    })
  )
}

// A cold open can race the stake-panel load effect against the forced logo
// refresh; both would otherwise download the whole ~1.4 MB list. Share one
// in-flight request instead.
let validatorsInflight: Promise<ValidatorInfo[]> | null = null

/**
 * The cached validator list at any age, without a network call. Yields move
 * slowly, so an hour-old list is fine for the Overview's earning estimate; the
 * stake panel still refreshes through getValidators. Null when nothing is cached.
 */
export function peekCachedValidators(): ValidatorInfo[] | null {
  try {
    const raw = localStorage.getItem(VALIDATORS_CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as ValidatorCacheEntry
    return Array.isArray(entry.validators) && entry.validators.length > 0 ? sortValidators(entry.validators) : null
  } catch {
    return null
  }
}

export async function getValidators(opts?: { force?: boolean }): Promise<ValidatorInfo[]> {
  // A stale list still beats an empty picker if the API is down.
  let stale: ValidatorInfo[] | null = null
  try {
    const raw = localStorage.getItem(VALIDATORS_CACHE_KEY)
    if (raw) {
      const entry = JSON.parse(raw) as ValidatorCacheEntry
      if (Array.isArray(entry.validators) && entry.validators.length > 0) {
        if (!opts?.force && Date.now() - entry.at < VALIDATORS_TTL) return sortValidators(entry.validators)
        stale = entry.validators
      }
    }
  } catch {
    /* unreadable cache — refetch */
  }

  if (validatorsInflight) return validatorsInflight
  validatorsInflight = fetchValidatorsFresh(stale)
  try {
    return await validatorsInflight
  } finally {
    validatorsInflight = null
  }
}

async function fetchValidatorsFresh(stale: ValidatorInfo[] | null): Promise<ValidatorInfo[]> {
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
        payoutSchedule: typeof v?.payoutSchedule === 'string' ? v.payoutSchedule : undefined,
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
    // Bake cache-safe thumbnails so warm-cache and offline loads render real
    // icons without ever refetching the ~1.4 MB payload just for avatars.
    const withThumbs = await withLogoThumbs(validators)
    try {
      // Full logos are dropped here and only here: they are ~1.4 MB of base64
      // and localStorage is a ~5 MB budget shared with history, receipts and
      // invoices. The baked thumbnails are a few KB total and ride along.
      const cacheable = withThumbs.map(({ logo: _logo, ...v }) => v)
      localStorage.setItem(
        VALIDATORS_CACHE_KEY,
        JSON.stringify({ at: Date.now(), validators: cacheable } satisfies ValidatorCacheEntry)
      )
    } catch {
      /* storage full — the list just isn't cached */
    }
    return sortValidators(withThumbs)
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

  if (sender === staking) return 'unstake'
  if (recipient === staking || tx.toType === 3) return 'stake'
  if (sender.startsWith(cleanAddress(VALIDATOR_REWARD_PREFIX).toUpperCase())) return 'reward'
  if (sender === own || recipient === own) return 'payment'
  return 'unknown'
}

// `classifyTx` only sees addresses, so a contract-funding tx reads as a plain
// payment to it. The recipient account type settles those cases.
export type TxLabel = TxKind | 'swap' | 'vesting' | 'htlc'

/**
 * Human-readable transaction type, shared by the history chips and the CSV
 * `kind` column so the two can never disagree.
 */
export function txLabel(tx: NimiqTx, ownAddress: string): TxLabel {
  // Staking: `toType` marks the deposit leg; the withdrawal leg is an ordinary
  // tx *from* the staking contract, which classifyTx recognises by sender.
  if (tx.toType === 3) return classifyTx(tx, ownAddress) === 'unstake' ? 'unstake' : 'stake'
  // Remote rows are the HTLC relay hops of a Nimiq Pay wallet: contract
  // funding reads as `swap`, everything else involving the relay address is
  // still HTLC machinery and gets its own chip rather than a plain payment.
  if (tx.remote) return tx.toType === 2 ? 'swap' : 'htlc'
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

/** Inverse of decodeMemo: UTF-8 text → hex, the form Nimiq tx data takes. */
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

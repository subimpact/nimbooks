// Nimiq chain reads — the Node-safe subset of the app's `src/lib/chain.ts`.
//
// Same endpoint, same RPC methods, same classification rules, same memo
// decoding, plus the validator list the app's stake panel reads. What is
// deliberately absent: the browser caches (localStorage), the EVM side, the
// fiat registry, and anything that builds or signs a transaction. This module
// reads. It has no way to spend.

import { parseValidators, networkStakeLunaFrom, type ValidatorInfo } from './staking.ts'

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
  // Reward rows are synthesized from the v2 restake API (never mined into the
  // index): `synthetic: 'reward'` is how the classifier reads them back — the
  // same marker the app's History uses.
  synthetic?: 'reward'
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

/**
 * The app's `isValidNimiqAddress` (src/lib/portfolio.ts): an NQ address of the
 * right shape whose MOD-97 checksum closes. No exception, no normalisation
 * beyond cleaning, which is what the stake-link port needs to match byte for
 * byte.
 */
export function isValidNimiqAddress(address: string): boolean {
  const flat = cleanAddress(address).toUpperCase()
  if (!/^NQ[0-9A-Z]{34}$/.test(flat)) return false
  return checksumOk(flat)
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
  // Offline test gate, the chain-read sibling of the validators gate: makes
  // every RPC call fail the way an unreachable endpoint does, so tools whose
  // chain reads are optional can still be driven with no network.
  if (process.env.NIMBOOKS_MCP_NO_CHAIN === '1') {
    throw new ToolError('The chain read offline gate NIMBOOKS_MCP_NO_CHAIN=1 is set, so the Nimiq RPC was not called.')
  }
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
  // Block height at which the deactivation takes effect; the retire tx is
  // only valid one full reporting epoch later (inactiveFrom + 43200). 0 when unknown.
  inactiveFrom: number
}

/**
 * The address's staker record, or null when it has never staked: the RPC
 * answers "No staker with address: ..." as an error, so the message is matched
 * rather than swallowed, so the common case is not a fault, and any other
 * failure is a lookup that failed and must be reported, not read as "never
 * staked" (same distinction as the app's fetchStakingHolding).
 */
export async function getStaking(address: string): Promise<StakingHolding | null> {
  let data: any
  try {
    data = await rpcCall('getStakerByAddress', [cleanAddress(address)])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/no staker with address/i.test(msg)) return null
    if (e instanceof RpcAnswerError) {
      throw new ToolError(
        `The Nimiq RPC answered the staker lookup for this address with an error: "${msg}". ` +
          `The staked status is unknown, not zero.`
      )
    }
    throw new ToolError(
      `Could not look up the staker record for this address: the Nimiq RPC did not answer (${msg}). ` +
        `Try again in a moment.`
    )
  }
  if (typeof data?.balance !== 'number') return null
  return {
    active: String(data.balance),
    inactive: String(data.inactiveBalance ?? 0),
    retired: String(data.retiredBalance ?? 0),
    delegation: data.delegation ?? '',
    inactiveFrom: Number(data.inactiveFrom ?? 0) || 0,
  }
}

/** The current block height (RPC getBlockNumber), for unstake clocks. */
export async function getBlockHeight(): Promise<number> {
  const data = await rpcCall('getBlockNumber', [])
  const n = Number(data)
  if (!Number.isFinite(n) || n <= 0) {
    throw new ToolError(`The Nimiq RPC returned an unreadable block height (${String(data)}).`)
  }
  return n
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
 * Walk the whole history by cursor, newest first, capped at `maxTotal`.
 * Paced and bounded like the app's version — nimiqwatch rate-limits unpaced
 * bursts — but honest about what it could not read:
 *
 *  - a rate-limit / transport failure part-way through RETURNS the pages it
 *    has, and reports `overrun` so callers can say "the rest was not read"
 *    instead of silently presenting a partial ledger;
 *  - `maxPageSize` lets callers trade one big page against many paced ones.
 *
 * @returns the transactions read; `overrun: true` when a page failed *after*
 * at least one page was read and the walk stopped because of it.
 */
export interface HistoryWalk {
  txs: NimiqTx[]
  overrun: boolean
}

export async function getTransactionHistory(
  address: string,
  maxTotal = 1000,
  maxPageSize = 50
): Promise<HistoryWalk> {
  const all: NimiqTx[] = []
  let cursor: string | null = null
  let overrun = false
  const pageSize = Math.max(1, Math.min(maxPageSize, 200))
  for (let i = 0; i < 20; i++) {
    let page: NimiqTx[]
    try {
      page = await getTransactions(address, pageSize, cursor)
    } catch (e) {
      overrun = all.length > 0
      break // partial history beats no history — but the caller is told
    }
    if (!page.length) break
    all.push(...page)
    if (all.length >= maxTotal) break
    const oldest = page[page.length - 1]
    if (!oldest?.hash || oldest.hash === cursor) break
    cursor = oldest.hash
    if (i < 19) await new Promise((r) => setTimeout(r, 250))
  }
  return { txs: all, overrun }
}

// --- Transaction classification (verbatim rules from the app) ---

// Nimiq staking contract address (Albatross)
export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
// Validator reward sender prefix (NQ81 C01N BASE…)
const VALIDATOR_REWARD_PREFIX = 'NQ81 C01N BASE'

// The v2 analytics API (nimiqwatch's second host) is the only place restaking
// rewards exist: the transfer index has no staking activity at all. The app
// reads exactly this endpoint (src/lib/stakingEvents.ts) and synthesizes one
// History row per UTC day per validator.
const V2_API = 'https://v2.nimiqwatch.com/api/v2'

/**
 * The ONE call site for the v2 host (restake feed and validator records), so
 * the fence keeps one `fetch(` per host.
 */
function v2Get(path: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${V2_API}${path}`, { signal })
}

/** One 15-minute restaking window, exactly as the v2 API returns it. */
export interface RestakeGroup {
  sender_address: string // validator that paid out
  time_window: string // ISO 8601 — start of the window (UTC)
  aggregated_value: number // Luna
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

/** The 00:00 UTC instant that starts the day holding `ms`. */
function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

/**
 * The 00:00 UTC instant AFTER the day holding `ms`. As a wire `to`, which
 * the endpoint reads exclusively, it runs a request through that whole day -
 * including when `ms` sits exactly at that day's own 00:00.
 */
function dayAfter(ms: number): number {
  return dayStart(ms) + DAY_MS
}

/**
 * Aggregated restaking reward events for a staker between two instants —
 * ported from the app's `getRestakeEvents` (src/lib/stakingEvents.ts), same
 * endpoint, same failure tolerance: returns `[]` on every failure path and
 * for addresses with no staker record.
 */
export async function getRestakeEvents(
  address: string,
  fromMs: number,
  toMs: number
): Promise<RestakeGroup[]> {
  return (await getRestakeEventsReport(address, fromMs, toMs)).groups
}

/**
 * `getRestakeEvents` that says whether it worked, so callers can report a
 * short total instead of a silently missing one. Same `[]`-ish shapes: the
 * groups list is empty on every failure path, `failed` says so.
 */
export async function getRestakeEventsReport(
  address: string,
  fromMs: number,
  toMs: number
): Promise<{ groups: RestakeGroup[]; failed: boolean }> {
  // Wire contract: `from` inclusive at 00:00 UTC, `to` EXCLUSIVE at 00:00
  // UTC, never in the future. The arguments are instants: `fromMs` floors to
  // its day; `toMs` is the last instant included in the ask, so the request
  // runs through the END of its day (ceil to the next 00:00), capped at
  // today's 00:00 because the API rejects a future `to`.
  const from = utcDay(fromMs)
  const to = utcDay(Math.min(dayAfter(toMs), dayStart(Date.now())))
  if (from >= to) return { groups: [], failed: false }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await v2Get(
      `/staker/${encodeURIComponent(address.replace(/\s+/g, ''))}` + `/events/restake-grouped?from=${from}&to=${to}`,
      controller.signal
    )
    if (!res.ok) throw new Error(`Restake events HTTP ${res.status}`)
    const json: unknown = await res.json()
    const groups = (json as { groups?: unknown } | null)?.groups
    if (!Array.isArray(groups)) return { groups: [], failed: false }
    return {
      groups: groups.filter(
        (g: unknown): g is RestakeGroup =>
          !!g &&
          typeof (g as RestakeGroup).time_window === 'string' &&
          Number.isFinite(Number((g as RestakeGroup).aggregated_value))
      ),
      failed: false,
    }
  } catch (e) {
    console.warn('getRestakeEvents failed:', e)
    return { groups: [], failed: true }
  } finally {
    clearTimeout(timer)
  }
}

/** The UTC day proof-of-stake mainnet launched - the earliest day worth asking for. */
export const REWARDS_FLOOR_DAY = '2024-11-19'

/**
 * Restaking rewards for an address as rows, covering `[fromMs, toMs]` with
 * both ends INCLUSIVE instants.
 *
 * The range is clamped to the public data (floor day, now) and split into
 * calendar-year requests - one request per calendar year, at most. The
 * endpoint's `to` is exclusive at 00:00 UTC, so each request's wire `to` is
 * the UTC day AFTER the day holding its last included instant - ceil to the
 * next 00:00 - capped at today's 00:00 because the API rejects a future
 * `to`. A `toMs` exactly at 00:00 of a day still counts as including that
 * instant, and a window can sit exactly there, so the choice made here is to
 * run the request through the END of that day (`to` = the day after, the
 * trim below stays day-granular) and let the exact-timestamp filters
 * downstream - `inWindow` (index.ts) and `computeStatement` (statement.ts) -
 * drop the rows past the instant. Each response keeps only groups inside its
 * own requested range (from-day 00:00 <= time_window < request to-day
 * 00:00): the API leaks the last window before `from` and the first at/after
 * `to` at its edges, and abutting ranges must never count a window twice. No
 * cache here (this ships as a CLI: the asker holds the window), and the
 * failure tolerance is the old one - a failing request contributes `[]`
 * while the rest still count. Never throws.
 */
/** One calendar-year request's outcome: its rows plus whether the request failed. */
export interface RewardTxsReport {
  rows: NimiqTx[]
  failedYears: number[]
}

/**
 * A reporting variant of `getRestakeRewardTxs`: the same rows, plus the
 * calendar years whose request to Nimiq Watch did not answer, so callers can
 * say "the total may be short" instead of silently dropping a year's
 * rewards. The rows are identical to the wrapper's.
 */
export async function getRestakeRewardTxsReport(
  address: string,
  fromMs: number,
  toMs: number
): Promise<RewardTxsReport> {
  const from = Math.max(fromMs, Date.parse(REWARDS_FLOOR_DAY + 'T00:00:00Z'))
  const to = Math.min(toMs, Date.now())
  if (to < from) return { rows: [], failedYears: [] }
  const rows: NimiqTx[] = []
  const failedYears: number[] = []
  const firstYear = Number(utcDay(from).slice(0, 4))
  const lastYear = Number(utcDay(to).slice(0, 4))
  const today00 = dayStart(Date.now())
  for (let y = firstYear; y <= lastYear; y++) {
    const reqFrom = Math.max(from, Date.UTC(y, 0, 1))
    // Slices are inclusive instants, so a seam slice ends 1ms before next
    // New Year's midnight: the midnight instant itself belongs to the next
    // year's slice, which keeps it exactly there.
    const reqEnd = Math.min(to, Date.UTC(y + 1, 0, 1) - 1)
    if (reqEnd < reqFrom) continue
    const { groups, failed } = await getRestakeEventsReport(address, reqFrom, reqEnd)
    if (failed) failedYears.push(y)
    // getRestakeEventsReport already answers an empty list on failure. Trim
    // the edge leaks to this request's own wire range, in case the caller's
    // ranges abut.
    const lo = dayStart(reqFrom)
    const hi = Math.min(dayAfter(reqEnd), today00)
    rows.push(
      ...rollUpRestakeRewards(
        groups.filter((g) => {
          const t = Date.parse(g.time_window)
          return Number.isFinite(t) && t >= lo && t < hi
        }),
        address
      )
    )
  }
  // Only validators pay rewards: drop rows whose sender is known NOT to be one
  // (a Nimiq Pay stake arrives through an HTLC and the feed lists it as a
  // restake from the contract). Unknown verdicts keep their rows.
  const verdicts = await validatorVerdicts(rows.map((r) => r.sender))
  const kept = rows.filter((r) => verdicts.get(flatUpper(r.sender)) !== false)
  return { rows: kept.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)), failedYears }
}

// --- Only validators pay rewards (the app's v1.40.0 rule, src/lib/stakingEvents.ts)
//
// The restake feed also carries stake that arrives through a contract: a stake
// made in Nimiq Pay travels through an HTLC, and the feed lists that deposit as
// a "restake" from the HTLC's address (seen live on a Pay wallet: single
// windows of 1,001, 2,000 and 3,000 NIM next to ~2 NIM a day from its pool).
// Each sender is checked once against Nimiq Watch's validator record (retired
// validators stay on record, so old rewards stay): 200 = validator, 404 = not,
// anything else = unknown and the rows stay. The app caches verdicts in
// localStorage; this CLI keeps them for the life of the process only.

const validatorVerdictCache = new Map<string, boolean>()

function flatUpper(address: string): string {
  return (address ?? '').replace(/\s+/g, '').toUpperCase()
}

async function fetchValidatorVerdict(flat: string): Promise<boolean | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await v2Get(`/validator/${encodeURIComponent(flat)}`, controller.signal)
    if (res.status === 404) return false
    if (!res.ok) return null
    const json = (await res.json()) as { address?: unknown } | null
    return flatUpper(typeof json?.address === 'string' ? json.address : '') === flat ? true : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether each distinct sender is a validator: true, false, or absent when it
 * could not be told (network failure). Never throws.
 */
export async function validatorVerdicts(senders: readonly string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const unique = [...new Set(senders.map(flatUpper).filter(Boolean))]
  await Promise.all(
    unique.map(async (flat) => {
      const cached = validatorVerdictCache.get(flat)
      if (cached !== undefined) {
        out.set(flat, cached)
        return
      }
      const verdict = await fetchValidatorVerdict(flat)
      if (verdict === null) return
      validatorVerdictCache.set(flat, verdict)
      out.set(flat, verdict)
    })
  )
  return out
}

/** Test hook: forget every cached verdict. */
export function clearValidatorVerdicts(): void {
  validatorVerdictCache.clear()
}

export async function getRestakeRewardTxs(
  address: string,
  fromMs: number,
  toMs: number
): Promise<NimiqTx[]> {
  return (await getRestakeRewardTxsReport(address, fromMs, toMs)).rows
}

/**
 * Restaking rewards collapsed into one synthesized row per UTC day per
 * validator — the app's `rollUpRestakeRewards` verbatim. Rows carry
 * `synthetic: 'reward'` so they read as income, never as counterparty money.
 */
export function rollUpRestakeRewards(groups: RestakeGroup[], ownAddress: string): NimiqTx[] {
  const byDay = new Map<string, { validator: string; day: string; luna: number; ts: number }>()

  for (const g of groups) {
    const ts = Date.parse(g.time_window)
    if (!Number.isFinite(ts)) continue
    const luna = Number(g.aggregated_value)
    if (!Number.isFinite(luna) || luna <= 0) continue
    const validator = g.sender_address ?? ''
    const day = utcDay(ts)
    const key = `${day}|${validator.replace(/\s+/g, '').toUpperCase()}`
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.luna += luna
      if (ts > bucket.ts) bucket.ts = ts
    } else {
      byDay.set(key, { validator, day, luna, ts })
    }
  }

  return [...byDay.values()]
    .sort((a, b) => b.ts - a.ts)
    .map((b) => ({
      hash: `restake:${b.day}:${b.validator.replace(/\s+/g, '').toUpperCase()}`,
      sender: b.validator,
      recipient: ownAddress,
      value: String(Math.round(b.luna)),
      fee: '0',
      timestamp: b.ts,
      executionResult: true,
      toType: 0,
      synthetic: 'reward' as const,
    }))
}

export type TxKind = 'payment' | 'stake' | 'unstake' | 'reward' | 'fee' | 'unknown'

export function classifyTx(tx: NimiqTx, ownAddress: string): TxKind {
  // Synthesized rows carry their kind: a restaked reward is paid by the
  // validator's own address — an address that also sends payments — so only
  // the marker can read it as income. Same rule as the app's classifier.
  if (tx.synthetic) return tx.synthetic
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

// --- Validators list (the same registry the app's stake panel reads) ---

// The app's VALIDATORS_URL, verbatim. One fetch, 20 s timeout, and only an
// in-process 10-minute memo (pool scores move by the epoch); this server has
// no localStorage, so there is no cache beyond that memo.
export const VALIDATORS_URL = 'https://validators-api-main.je-cf9.workers.dev/api/v1/validators/'

const VALIDATORS_FETCH_TIMEOUT_MS = 20000
const VALIDATORS_MEMO_TTL_MS = 10 * 60 * 1000

export interface ValidatorsSnapshot {
  validators: ValidatorInfo[] // neutral order (sortValidators)
  networkStakeLuna: number // the mean back-out of balance / dominanceRatio
  fetchedAt: number
}

let validatorsMemo: (ValidatorsSnapshot & { memoAt: number }) | null = null

function validatorsUnavailable(detail: string): ToolError {
  return new ToolError(
    `The validators list at ${VALIDATORS_URL} could not be reached (${detail}), so the ` +
      `validator names, fees and yields are unavailable. Balances and rewards are unaffected: ` +
      `the staking answers still work, and a yield projection can go ahead when a rate is ` +
      `given explicitly (annualRatePercent). Try again in a moment.`
  )
}

/**
 * The validator list, one fetch per 10 minutes at most. Throws a ToolError on
 * any failure: unlike the rewards fetches, a missing validator list is not a
 * silently-empty answer, because the tools that need it can say exactly what
 * went away. Gated for offline tests with NIMBOOKS_MCP_NO_VALIDATORS=1, which
 * makes every call fail the same way an unreachable API does.
 */
export async function getValidatorsSnapshot(opts?: { force?: boolean }): Promise<ValidatorsSnapshot> {
  if (process.env.NIMBOOKS_MCP_NO_VALIDATORS === '1') {
    throw validatorsUnavailable('the offline gate NIMBOOKS_MCP_NO_VALIDATORS=1 is set')
  }
  if (
    !opts?.force &&
    validatorsMemo &&
    Date.now() - validatorsMemo.memoAt < VALIDATORS_MEMO_TTL_MS
  ) {
    const { memoAt: _memoAt, ...rest } = validatorsMemo
    return rest
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATORS_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(VALIDATORS_URL, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: unknown = await res.json()
    const validators = parseValidators(json)
    validatorsMemo = {
      validators,
      networkStakeLuna: networkStakeLunaFrom(json),
      fetchedAt: Date.now(),
      memoAt: Date.now(),
    }
    const { memoAt: _memoAt, ...rest } = validatorsMemo
    return rest
  } catch (e) {
    // A stale memo still beats nothing, same as the app serves its cache when
    // a refresh fails and the list is not being forced.
    if (validatorsMemo && !opts?.force) {
      const { memoAt: _memoAt, ...rest } = validatorsMemo
      return rest
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw validatorsUnavailable(msg === 'The operation was aborted' ? 'timed out after 20 s' : msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function getValidators(opts?: { force?: boolean }): Promise<ValidatorInfo[]> {
  return (await getValidatorsSnapshot(opts)).validators
}

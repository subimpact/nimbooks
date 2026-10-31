// History straight from the Nimiq network, through the light client.
//
// rpc.nimiqwatch.com is the only public Nimiq history RPC, and the whole app
// reads its history through it. When it is down or rate limited the wallet
// shows no history at all, even though the network itself is fine. The
// @nimiq/core light client (already a dependency for Hub signing and
// cashlinks) asks peers for the same transaction rows directly, so it can
// serve history while the RPC cannot.
//
// Two limits shape how callers use it:
//   - a light client only sees rows since the PoS launch (19 Nov 2024), so
//     anything older still has to come from the RPC;
//   - getTransactionsByAddress returns at most 500 rows per call; 1000 throws.
// Both are handled by walkTransactionHistory in chain.ts, which reads light
// pages first and then makes a single RPC continuation for the rest.
//
// The client is a singleton: history, the heartbeat and the balance fallback
// share one consensus round. A start that fails clears the promise so the next
// call retries instead of inheriting a dead client.

import type { Client, PlainTransactionDetails } from '@nimiq/core'
import { normalizeTimestamp, type NimiqTx } from './chain'

// Consensus needs 3-9 s warm. A 30 s ceiling keeps a broken network (blocked
// websockets, CSP, no peers) from holding history hostage forever: the caller
// falls back to the RPC.
const CONSENSUS_TIMEOUT_MS = 30_000
// A peer can stop answering a query after consensus (seen around an epoch's
// election block): without a ceiling one history page could hang for good and
// the progress line would never end. The slowest page measured on a busy
// address took 9.9 s; past this the walk falls back to the RPC.
const LIGHT_QUERY_TIMEOUT_MS = 20_000
let lightQueryTimeoutMs = LIGHT_QUERY_TIMEOUT_MS

/** Oracles shorten the per-query ceiling; null restores the default. */
export function setLightQueryTimeoutForTests(ms: number | null): void {
  lightQueryTimeoutMs = ms ?? LIGHT_QUERY_TIMEOUT_MS
}

// Hard per-call ceiling of the client (1000 throws).
export const LIGHT_WALK_PAGE = 500

// localStorage switch that pins history to the RPC (the support escape hatch).
// Shared with chain.ts so a warm-up and a walk can never disagree about it.
export const HISTORY_SOURCE_KEY = 'nimbooks:historySource'

// What the first history load is doing, for the one-line progress indicator.
// It lives here, beside the client, because the WASM download and consensus
// wait happen before chain.ts asks for a page. `rows` is the number of light
// rows read so far.
export type LightPhase =
  | 'idle'
  | 'downloading'
  | 'connecting'
  | 'loading'
  | 'older'
  | 'done'
  | 'fallback'
  | 'failed'

export interface LightStatus {
  phase: LightPhase
  rows: number
}

let lightStatus: LightStatus = { phase: 'idle', rows: 0 }
const lightStatusListeners = new Set<(status: LightStatus) => void>()

export function getLightStatus(): LightStatus {
  return lightStatus
}

export function subscribeLightStatus(fn: (status: LightStatus) => void): () => void {
  lightStatusListeners.add(fn)
  return () => {
    lightStatusListeners.delete(fn)
  }
}

/** Report a step to the progress line. Exported for chain.ts's history walk. */
export function setLightStatus(phase: LightPhase, rows = 0): void {
  if (lightStatus.phase === phase && lightStatus.rows === rows) return
  lightStatus = { phase, rows }
  for (const fn of lightStatusListeners) fn(lightStatus)
}

let clientPromise: Promise<Client> | null = null
let readyClient: Client | null = null

// Every wallet reads history from Nimiq's public node first and turns to the
// light client only when that node fails (one retry first). A cold light client
// takes 10 to 33 s to deliver history against 1 to 5 s from the node, which a
// user in Nimiq Pay felt as "slow" (31 Oct), so the client is the outage
// backup, not the main path. The setter is a test seam: oracles switch it off
// to drive the light-first walk, which stays reachable with
// localStorage 'nimbooks:historySource' = 'light'.
let rpcFirst = true

export function setHistoryRpcFirst(on: boolean): void {
  rpcFirst = on
}

// localStorage 'nimbooks:historySource' = 'light' puts any wallet back on the
// light client first (probes of the progress line, and support checks of it).
export function historyRpcFirst(): boolean {
  if (!rpcFirst) return false
  try {
    if (localStorage.getItem(HISTORY_SOURCE_KEY) === 'light') return false
  } catch {
    /* storage unavailable: the wallet stays RPC first */
  }
  return true
}

// Replaces the client call in oracles. Returns PlainTransactionDetails, the
// same rows the network would, so mapping runs exactly as in production.
export type LightFetcherForTests = (
  address: string,
  max: number,
  startAt: string | null
) => Promise<PlainTransactionDetails[]>

let testFetcher: LightFetcherForTests | null = null

export function setLightFetcherForTests(fn: LightFetcherForTests | null): void {
  testFetcher = fn
}

export function hasLightFetcherForTests(): boolean {
  return testFetcher !== null
}

function withTimeout<T>(promise: Promise<T>, ms: number, what = 'answer'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Light client did not ${what} within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// The client once created, consensus or not. A timeout keeps it: a retry waits
// on the same client instead of downloading and dialling a second one.
let createdClient: Client | null = null

async function startClient(): Promise<Client> {
  // Both steps are skipped when readyClient is already set: getLightClient
  // returns before startClient, so a warm client never reports them again.
  if (!createdClient) {
    setLightStatus('downloading')
    const Nimiq = await import('@nimiq/core')
    const config = new Nimiq.ClientConfiguration()
    config.logLevel('warn')
    createdClient = await Nimiq.Client.create(config.build())
  }
  const client = createdClient
  setLightStatus('connecting')
  // Never free() or disconnect the client on a timeout: waitForConsensus is
  // still pending and holds a borrow on it, so free() throws "attempted to
  // take ownership of Rust value while it was borrowed" as an uncaught page
  // error. It keeps connecting in the background and the next call reuses it.
  await withTimeout(client.waitForConsensusEstablished(), CONSENSUS_TIMEOUT_MS, 'reach consensus')
  readyClient = client
  return client
}

/**
 * Start the client before history asks for it, so the 3.2 MB WASM download and
 * consensus wait overlap the wallet handshake instead of following it. Called
 * when a wallet is being chosen or a saved session is restored, never from the
 * landing page: a visitor who does not connect must not pay for the download.
 *
 * No-op where the light path would not be used (no window, the RPC support
 * switch, or an oracle's test fetcher). Errors are swallowed: the next history
 * walk retries and reports the failure to the progress line.
 */
export function warmLightClient(): void {
  // A node-first wallet only needs the client if the public node fails, and a
  // warm-up would cost every visitor the 3.2 MB download and put "Downloading
  // the Nimiq network client" on screen.
  if (typeof window === 'undefined' || testFetcher || historyRpcFirst()) return
  try {
    if (localStorage.getItem(HISTORY_SOURCE_KEY) === 'rpc') return
  } catch {
    /* storage unavailable: use the default for this environment */
  }
  if (readyClient || clientPromise) return
  void getLightClient().catch(() => {
    /* a later history load retries; the progress line reports that attempt */
  })
}

function getLightClient(): Promise<Client> {
  if (readyClient) return Promise.resolve(readyClient)
  if (!clientPromise) {
    clientPromise = startClient().catch((e) => {
      clientPromise = null
      throw e
    })
  }
  return clientPromise
}

/** True when consensus is already established, so no call has to wait. */
export function isLightReady(): boolean {
  return readyClient !== null
}

function cleanLightAddress(address: string): string {
  return String(address).replace(/\s+/g, '')
}

function rawHex(value: { raw?: string } | undefined): string | undefined {
  return typeof value?.raw === 'string' && value.raw.length > 0 ? value.raw : undefined
}

const TO_TYPE: Record<string, number> = { basic: 0, vesting: 1, htlc: 2, staking: 3 }

function mapLightTx(t: PlainTransactionDetails): NimiqTx {
  return {
    hash: t.transactionHash,
    sender: t.sender,
    recipient: t.recipient,
    value: String(t.value ?? 0),
    fee: String(t.fee ?? 0),
    timestamp: normalizeTimestamp(t.timestamp),
    // The RPC serves the sender's data in senderData only when the recipient
    // data is empty, and omits both when empty; keep the same hex either way.
    data: rawHex(t.data) ?? rawHex(t.senderData),
    blockNumber: t.blockHeight,
    proof: rawHex(t.proof),
    executionResult: t.executionResult,
    toType: TO_TYPE[t.recipientType] ?? 0,
  }
}

/**
 * Rows for one page, newest first. `startAt` is the hash of the last row of
 * the previous page (exclusive, as the client documents) or null for the
 * newest rows. Rows without a block are not mined and do not belong in a
 * mined history.
 */
export async function getLightTransactions(
  address: string,
  max: number,
  startAt: string | null
): Promise<NimiqTx[]> {
  const limit = Math.min(max, LIGHT_WALK_PAGE)
  let rows: PlainTransactionDetails[]
  if (testFetcher) {
    rows = await withTimeout(testFetcher(address, limit, startAt), lightQueryTimeoutMs)
  } else {
    const client = await getLightClient()
    rows = await withTimeout(
      client.getTransactionsByAddress(cleanLightAddress(address), null, null, startAt, limit, null),
      lightQueryTimeoutMs
    )
  }
  return rows.filter((t) => t.blockHeight != null).map(mapLightTx)
}

/** Account balance in Luna, read from the network. */
export async function getLightBalance(address: string): Promise<number> {
  const client = await getLightClient()
  const account = await withTimeout(client.getAccount(cleanLightAddress(address)), lightQueryTimeoutMs)
  return account.balance
}

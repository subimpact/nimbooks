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
// Hard per-call ceiling of the client (1000 throws).
export const LIGHT_WALK_PAGE = 500

let clientPromise: Promise<Client> | null = null
let readyClient: Client | null = null

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Light client did not reach consensus within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function startClient(): Promise<Client> {
  const Nimiq = await import('@nimiq/core')
  const config = new Nimiq.ClientConfiguration()
  config.logLevel('warn')
  const client = await Nimiq.Client.create(config.build())
  try {
    await withTimeout(client.waitForConsensusEstablished(), CONSENSUS_TIMEOUT_MS)
  } catch (e) {
    // Free the half-started client: a retry should dial fresh instead of
    // leaving a second client connecting in the background.
    try {
      await client.disconnectNetwork()
    } catch {
      /* best effort */
    }
    try {
      client.free()
    } catch {
      /* best effort */
    }
    throw e
  }
  readyClient = client
  return client
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
    rows = await testFetcher(address, limit, startAt)
  } else {
    const client = await getLightClient()
    rows = await client.getTransactionsByAddress(
      cleanLightAddress(address),
      null,
      null,
      startAt,
      limit,
      null
    )
  }
  return rows.filter((t) => t.blockHeight != null).map(mapLightTx)
}

/** Account balance in Luna, read from the network. */
export async function getLightBalance(address: string): Promise<number> {
  const client = await getLightClient()
  const account = await client.getAccount(cleanLightAddress(address))
  return account.balance
}

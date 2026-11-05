// Every Nimiq Pay "Pay" session runs out of one HTLC contract at a time, and
// Pay recycles that contract constantly — a settled one is pruned from the
// accounts tree (reads back `type: 'basic', balance: 0`) and the next payment
// lands in a freshly created contract. NimBooks reads exactly one contract's
// history (`account.remoteAddress`), so everything that happened in the
// contracts before it — payments made in Pay, stakes made in Pay — is missing
// from History the moment Pay moves on to a new contract.
//
// This module discovers the contracts the wallet itself funded (toType 2,
// sender = own, straight from the basic-address history) and archives the
// history of each one that has *settled* — settle means its account has been
// pruned, so the history can no longer change and caching it is safe forever.
// Contracts that are still live (`type: 'htlc'`) are reported back but never
// stored: their tx list is still growing, and the regular remote read of the
// current contract covers the live one.
//
// Pay also *extends* a contract: the old HTLC funds a brand-new HTLC directly
// (contract -> contract), so the basic address never sees the new one and a
// discovery that only looks at basic-funded contracts misses the money after
// the first extension. A settled contract's own history names those successors,
// and the tx data proves the successor is still the user's: an HTLC creation
// payload starts with the 20 byte sender (the refund address), which for every
// Pay contract is the user's basic address. So a settled contract's successors
// are appended to the work queue and archived in the same sweep, with zero
// extra RPC beyond the history that was fetched anyway.
//
// Pure over the tx list, all RPC injected by the caller, all storage access
// try/caught: a failed write (quota, private mode) just means a refetch next
// time, it can never break a refresh.

import type { NimiqTx } from './chain'
import { addressToHex } from './nimAddress'

// Re-exported: the owner proof helper belongs to the contract discovery that
// uses it, and the archive oracle bundles this module alone.
export { addressToHex }

const ARCHIVE_KEY_PREFIX = 'nimbooks:htlc-archive:'
// One contract's history can run to some hundreds of rows, so bound the shelf.
const ARCHIVE_MAX_CONTRACTS = 300

function normAddress(addr: string | undefined): string {
  return (addr ?? '').replace(/\s+/g, '').toUpperCase()
}

/**
 * Distinct HTLC contracts this wallet funded, newest first.
 *
 * Nimiq Pay funds a contract from the basic address (`toType === 2`), so every
 * contract Pay ever used shows up here. Returned in the spaced form the tx list
 * carries them in — RPC calls go out in exactly that form. Failed txs are
 * skipped: a contract created by an out-of-gas rejection was never funded.
 */
export function ownFundedContracts(
  txs: NimiqTx[],
  ownAddress: string,
  limit = 200
): string[] {
  const own = normAddress(ownAddress)
  const seen = new Set<string>()
  const out: string[] = []
  for (const tx of [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))) {
    if (limit > 0 && out.length >= limit) break
    if (tx.executionResult === false) continue
    if (tx.toType !== 2) continue
    if (!tx.recipient) continue
    if (normAddress(tx.sender) !== own) continue
    const flat = normAddress(tx.recipient)
    // The same contract can be funded more than once (a top-up); list it once.
    if (seen.has(flat)) continue
    seen.add(flat)
    out.push(tx.recipient)
  }
  return out
}

/**
 * HTLC contracts a settled contract extended into, newest first.
 *
 * Nimiq Pay extends its HTLC by funding the next contract straight from the
 * old one (`Transfer.ExtendRemote`): sender = the old contract, `toType === 2`,
 * and the creation data starts with the HTLC sender (the refund address). For
 * every Pay contract that sender is the user's basic address, which is what
 * makes the successor provably theirs without an extra RPC. A contract ->
 * contract payment whose data starts with someone else's address is a swap or
 * a payment into a foreign HTLC and must not be followed: its balance is not
 * this wallet's.
 *
 * Ownership keys on the refund address, not the 32 byte hash root: extensions
 * carry an all-zero hash root, so keying on that would also match foreign
 * contracts created the same way.
 */
export function ownHtlcSuccessors(
  contract: string,
  txs: NimiqTx[],
  ownAddress: string
): string[] {
  const from = normAddress(contract)
  const ownHex = addressToHex(ownAddress)
  if (!from || !ownHex) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tx of [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))) {
    if (tx.executionResult === false) continue
    if (tx.toType !== 2) continue
    if (!tx.recipient) continue
    if (normAddress(tx.sender) !== from) continue
    // recipientData comes back as hex (an optional 0x is stripped for safety).
    const data = (tx.data ?? '').replace(/^0x/i, '').toLowerCase()
    if (!data.startsWith(ownHex)) continue
    const flat = normAddress(tx.recipient)
    if (seen.has(flat)) continue
    seen.add(flat)
    out.push(tx.recipient)
  }
  return out
}

interface ArchivedContract {
  final: true
  txs: NimiqTx[]
  at: number
}

interface ContractArchive {
  v: 1
  contracts: Record<string, ArchivedContract>
}

/** localStorage key for one wallet's settled-contract shelf (flat, uppercased). */
function archiveKey(ownAddress: string): string {
  return ARCHIVE_KEY_PREFIX + normAddress(ownAddress)
}

/**
 * Read the shelf. Anything malformed — wrong version, non-object entry, an
 * entry without a tx array — reads as empty rather than throwing: a truncated
 * or hand-mangled value must not take the refresh down.
 * Deliberately strict about `final: true`: only settled contracts are allowed
 * to be served from storage, so a shape that lost that flag reads as empty
 * instead of serving a mutable list forever.
 */
function readArchive(ownAddress: string): ContractArchive {
  try {
    const raw = localStorage.getItem(archiveKey(ownAddress))
    if (!raw) return { v: 1, contracts: {} }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { v: 1, contracts: {} }
    }
    const rec = parsed as { v?: unknown; contracts?: unknown }
    if (rec.v !== 1 || !rec.contracts || typeof rec.contracts !== 'object') {
      return { v: 1, contracts: {} }
    }
    const contracts: Record<string, ArchivedContract> = {}
    for (const [flat, value] of Object.entries(rec.contracts as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as { final?: unknown; txs?: unknown; at?: unknown }
      if (entry.final !== true || !Array.isArray(entry.txs) || typeof entry.at !== 'number') continue
      if (entry.txs.some((t) => !t || typeof t !== 'object' || typeof t.hash !== 'string')) continue
      contracts[flat] = { final: true, txs: entry.txs, at: entry.at }
    }
    return { v: 1, contracts }
  } catch {
    // Missing storage, a JSON parse error, private mode — all read as empty.
    return { v: 1, contracts: {} }
  }
}

/**
 * Merge the shelf back with the new finals on top and persist once. Capped by
 * dropping the oldest entries: the archive exists so old contracts stay in
 * History, and the newest ones are the ones the current session still needs.
 * Never throws — a failed write only means the contracts are refetched next
 * time.
 */
function writeArchive(ownAddress: string, merged: ContractArchive): void {
  let keys = Object.keys(merged.contracts)
  if (keys.length > ARCHIVE_MAX_CONTRACTS) {
    keys = keys
      .sort((a, b) => (merged.contracts[b].at ?? 0) - (merged.contracts[a].at ?? 0))
      .slice(0, ARCHIVE_MAX_CONTRACTS)
    const capped: Record<string, ArchivedContract> = {}
    for (const k of keys) capped[k] = merged.contracts[k]
    merged = { v: 1, contracts: capped }
  }
  try {
    localStorage.setItem(archiveKey(ownAddress), JSON.stringify(merged))
  } catch {
    /* quota, private mode — the sync refetches next run */
  }
}

/**
 * Is this contract already on the wallet's settled shelf? Read straight from
 * storage so the first refresh after a reload (before any sweep has run this
 * session) can skip a saved remote address Pay has long since retired.
 */
export function isArchivedContract(ownAddress: string, contract: string): boolean {
  return !!readArchive(ownAddress).contracts[normAddress(contract)]
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface ContractSyncDeps {
  // Account lookup, injected so the oracle test can fake both sides; App wires
  // the real chain functions.
  fetchAccount(addr: string): Promise<{ type: string; balance: number } | null>
  fetchTxs(addr: string): Promise<NimiqTx[]>
}

export interface ContractSyncOptions {
  // Total RPC budget for one sync — each unsettled contract costs 2 calls
  // (account +, only when settled, history). Left over? The cache makes the
  // next sync continue exactly where this one stopped.
  maxFetches?: number
  // Pacing between RPC calls — unpaced bursts trip the public RPC's 429s.
  delayMs?: number
}

export interface ContractSyncResult {
  // Rows of every *newly seen* settled contract (the cache's rows ride along
  // too), deduped by hash, unsorted.
  finalTxs: NimiqTx[]
  // Contracts still live (`type: 'htlc'`), newest first. Not stored: their
  // history is still growing and the regular remote read covers the current one.
  live: string[]
  // Luna held by each live contract, flat + uppercased address -> balance. Read
  // from the same account answer that classified the contract, so it costs no
  // extra RPC. Settled (pruned) contracts are not in here: their balance is not
  // the user's Pay money any more.
  liveBalances: Record<string, number>
  // The settled contracts of this pass, flat + uppercased, including cache hits.
  finals: Set<string>
  // false when the fetch budget ran out or any lookup failed / was malformed —
  // the caller should run the sync again next tick rather than cache the pass.
  complete: boolean
  // true when the pass stopped on a failed lookup (vs. only running out of
  // budget): the caller should back off before the next attempt.
  failed: boolean
}

/**
 * Sync the settled-contract archive: for each funded contract, decide settled
 * (archive its history) vs live (report it) from its account state, reusing
 * cached finals with zero RPC.
 *
 * `contracts` is the seed of a work queue, not the whole list: every contract
 * that resolves as settled (fetched or cached) contributes its own successors
 * (see ownHtlcSuccessors), so an extension chain is followed to its live end.
 * The queue is capped at ARCHIVE_MAX_CONTRACTS overall.
 *
 * Order of `contracts` is preserved (callers pass newest first), and pacing
 * pauses between calls, after the first call of a pass.
 */
export async function syncContractArchive(
  ownAddress: string,
  contracts: string[],
  deps: ContractSyncDeps,
  opts?: ContractSyncOptions
): Promise<ContractSyncResult> {
  const maxFetches = opts?.maxFetches ?? 16
  const delayMs = opts?.delayMs ?? 300
  const archive = readArchive(ownAddress)

  // The work queue: seeded with the caller's contracts, grown with the
  // successors of every settled one. Deduped on the flat address against
  // everything already queued, and capped so one pathological chain can never
  // grow a pass without bound. An index loop (not for..of) so appended entries
  // are seen.
  const seen = new Set<string>()
  const queue: { spaced: string; flat: string }[] = []
  const enqueue = (addr: string | undefined) => {
    if (!addr) return
    const flat = normAddress(addr)
    if (!flat || seen.has(flat)) return
    if (queue.length >= ARCHIVE_MAX_CONTRACTS) return
    seen.add(flat)
    queue.push({ spaced: addr, flat })
  }
  for (const addr of contracts) enqueue(addr)

  let budget = maxFetches
  let complete = true
  // A lookup failed (rate limit, timeout, malformed answer): the caller backs
  // off instead of retrying on the next tick.
  let failed = false
  let callsMade = 0
  const finals = new Set<string>()
  const live: string[] = []
  const liveBalances: Record<string, number> = {}
  const finalTxs: NimiqTx[] = []
  const txHashes = new Set<string>()
  // New archive entries, merged into the shelf and persisted once at the end.
  let wrote = false

  const pace = async () => {
    if (callsMade === 0) return // first call of a pass is unpaced
    await sleep(delayMs)
  }
  const addRows = (rows: NimiqTx[]) => {
    for (const t of rows) {
      if (!t?.hash || txHashes.has(t.hash)) continue
      txHashes.add(t.hash)
      finalTxs.push(t)
    }
  }

  let stopped = false
  for (let i = 0; i < queue.length; i++) {
    const { spaced, flat } = queue[i]
    const cached = archive.contracts[flat]
    if (cached?.final) {
      // Settled before and settled still: history cannot change, serve from
      // the shelf and spend no budget here. Its successors are known from the
      // cached history too, so the chain is still followed after a stop with
      // zero RPC: a budget cut or a failed lookup must not hide an extension
      // that was already proved on a previous pass.
      finals.add(flat)
      addRows(cached.txs)
      for (const next of ownHtlcSuccessors(spaced, cached.txs, ownAddress)) enqueue(next)
      continue
    }
    // Once fetching has stopped (budget spent or a failed lookup) the loop
    // keeps walking only to serve the remaining cached finals: a pass that
    // stops early must never drop already-archived rows from History.
    if (stopped) {
      complete = false
      continue
    }
    if (budget < 2) {
      // A decision costs 2 calls (account + history for a settled one); going
      // further would spend the budget on half-decisions.
      complete = false
      stopped = true
      continue
    }
    let acct: { type: string; balance: number } | null
    try {
      await pace()
      acct = await deps.fetchAccount(spaced)
      callsMade++
      budget--
    } catch {
      // Rate limit, timeout — the call was made, so it spends budget, and the
      // contract is left unprocessed and retried on the next sync.
      callsMade++
      budget--
      complete = false
      failed = true
      stopped = true
      continue
    }
    if (acct === null) {
      // Failed or malformed answer (getContractAccount folds errors into
      // null). Stop the pass: after a 429 every further call in this burst
      // fails too, and each one costs the public RPC and the user's battery.
      complete = false
      failed = true
      stopped = true
      continue
    }
    if (acct.type === 'htlc') {
      // Still live. Reported, never stored, and not expanded: the extension
      // that moves this contract's money does not exist yet, and the next
      // settled pass will discover it from this contract's own history.
      live.push(spaced)
      liveBalances[flat] = Number.isFinite(acct.balance) ? acct.balance : 0
    } else if (acct.type === 'basic') {
      // Settled: pruned to a basic account, so it is no longer a contract and
      // Pay can never spend from it again. Usually balance 0; a balance means
      // someone sent NIM to the dead address afterwards, which is not Pay
      // activity. Treating that as "unknown, retry" would re-run the whole
      // sweep every 10s forever, so it is archived like any settled contract.
      let txs: NimiqTx[]
      try {
        await pace()
        txs = await deps.fetchTxs(spaced)
        callsMade++
        budget--
      } catch {
        callsMade++
        budget--
        complete = false
        failed = true
        stopped = true
        continue
      }
      if (!Array.isArray(txs)) {
        complete = false
        failed = true
        stopped = true
        continue
      }
      archive.contracts[flat] = { final: true, txs, at: Date.now() }
      wrote = true
      finals.add(flat)
      addRows(txs)
      // This contract settled: whatever it extended into is the next contract
      // of the user's Pay wallet (proved by the refund-address prefix in the
      // creation data). Queue it. A live one is not expanded above.
      for (const next of ownHtlcSuccessors(spaced, txs, ownAddress)) enqueue(next)
    } else {
      // Any other account type (a toType-2 recipient should only ever read as
      // htlc or, once pruned, basic) is not understood well enough to cache:
      // reported as neither, and the pass counts as complete so an oddity
      // can never keep the sweep re-running on every tick.
    }
  }

  if (wrote) writeArchive(ownAddress, archive)
  return { finalTxs, live, liveBalances, finals, complete, failed }
}
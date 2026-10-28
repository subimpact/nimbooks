// Ported from the NimBooks app's src/lib/htlcFlows.ts, byte for byte below this
// header except the import path. test/htlc-parity.test.ts runs both on the same
// inputs; change the app module first, then copy it here.
//
// Nimiq Pay's HTLC round trips, netted out of a wallet's transfers.
//
// Nimiq Pay parks the user's NIM in HTLC contracts: the wallet funds a contract
// (toType 2) and the same NIM comes back once the contract settles or refunds.
// Both legs are real chain transactions, but they are not payments: the money
// never left the user. Netting each contract's funding against what came back
// lets Analytics show that as an internal layer, and keep real income and real
// spending apart.
//
// Pure: no RPC, no DOM. Every amount is integer luna.
//
// Payment and stake activity made *inside* Nimiq Pay never touches the basic
// address: it goes out of the contract — to the merchant, or to the fixed
// staking contract when the user stakes in Pay. Those rows only show in the
// contract's own history, which the basic-address list never sees, so a stake
// made in Pay would otherwise be counted as real "Sent" while Analytics' own
// info text says staking moves are not included. `splitHtlcFlows` therefore
// accepts `contractTxs` — the merged row set of the wallet's contracts — and
// nets every contract's staking outflow against its funding before deciding
// how much of the funding leg is still real spending.

import type { NimiqTx } from './chain.ts'

export interface FlowSplit {
  realIn: number // LUNA
  internalIn: number // LUNA
  realOut: number // LUNA
  internalOut: number // LUNA
}

// Nimiq addresses arrive spaced and in either case.
function normAddress(addr: string | undefined): string {
  return (addr ?? '').replace(/\s+/g, '').toUpperCase()
}

// v * part / whole, rounded half up, in exact integer arithmetic. Doubles stop
// being exact past 2^53, and a large contract's product gets there.
function share(v: bigint, part: bigint, whole: bigint): bigint {
  if (whole <= 0n) return 0n
  return (2n * v * part + whole) / (2n * whole)
}

interface Flow {
  hash: string
  sender: string
  recipient: string
  toType?: number
  luna: bigint
}

// The fixed staking contract Nimiq Pay stakes into, flat + uppercased. Defined
// locally with the literal so this file stays pure — importing chain.ts would
// drag the RPC layer into what must stay a pure netting module.
const STAKING_CONTRACT_FLAT = 'NQ7700000000000000000000000000000001'

/**
 * Per contract, how much of its funding was staked out by the user in Pay:
 * rows from the contract's own history whose sender is a contract this wallet
 * funded and whose recipient is the staking contract (or `toType 3`, the
 * staking contract type). Deduped by hash, so a row that arrives twice through
 * two contract lists counts once.
 */
function stakedPerContract(rows: readonly NimiqTx[] | undefined): Map<string, bigint> {
  const staked = new Map<string, bigint>()
  if (!rows) return staked
  const seen = new Set<string>()
  for (const tx of rows) {
    if (!tx?.hash || seen.has(tx.hash)) continue
    seen.add(tx.hash)
    if (tx.executionResult === false) continue
    const v = Math.round(Number(tx.value))
    if (!Number.isFinite(v) || v <= 0) continue
    if (normAddress(tx.recipient) !== STAKING_CONTRACT_FLAT && tx.toType !== 3) continue
    const c = normAddress(tx.sender)
    if (!c) continue
    staked.set(c, (staked.get(c) ?? 0n) + BigInt(v))
  }
  return staked
}

/**
 * Splits every transfer touching `ownAddress` into its real and internal parts,
 * keyed by tx hash. Txs that move nothing get no entry (read them as zeros):
 * failed txs, zero or invalid values, self transfers, and txs that do not
 * involve the wallet. A hash counts once, so a duplicate row cannot double a
 * contract's totals.
 *
 * Netting runs over the whole list, so the order of `txs` does not matter.
 * `heldContracts` are contracts that still hold the wallet's NIM: their whole
 * funding counts as internal, not only the part that has come back.
 * `contractTxs` are the merged rows of the wallet's own contracts (Nimiq Pay's
 * contracts hold the wallet's money and spend out of it — see the header).
 * Staking that left a contract counts as never having left the user, and is
 * capped by the funding: a contract can only stake out what it was funded with
 * (over-stakes, if the chain ever allowed one, would come back out of user
 * spending, not out of nothing). Without `contractTxs` the netting is exactly
 * what it was before Pay-contract history arrived.
 */
export function splitHtlcFlows(
  txs: NimiqTx[],
  ownAddress: string,
  opts?: { heldContracts?: Iterable<string>; contractTxs?: readonly NimiqTx[] }
): Map<string, FlowSplit> {
  const own = normAddress(ownAddress)

  const seen = new Set<string>()
  const flows: Flow[] = []
  for (const tx of txs) {
    if (tx.executionResult === false) continue
    const v = Math.round(Number(tx.value))
    if (!Number.isFinite(v) || v <= 0) continue
    const sender = normAddress(tx.sender)
    const recipient = normAddress(tx.recipient)
    if (sender === recipient) continue // self transfer: the money never left
    if (sender !== own && recipient !== own) continue // not this wallet's transfer
    if (seen.has(tx.hash)) continue
    seen.add(tx.hash)
    flows.push({ hash: tx.hash, sender, recipient, toType: tx.toType, luna: BigInt(v) })
  }

  // C: the contracts this wallet funded, with the total it put into each.
  const funded = new Map<string, bigint>()
  for (const f of flows) {
    if (f.sender === own && f.toType === 2) {
      funded.set(f.recipient, (funded.get(f.recipient) ?? 0n) + f.luna)
    }
  }
  // What has come back from each of those contracts.
  const returned = new Map<string, bigint>()
  for (const f of flows) {
    if (f.recipient === own && funded.has(f.sender)) {
      returned.set(f.sender, (returned.get(f.sender) ?? 0n) + f.luna)
    }
  }
  // Stakes the user made from each of those contracts in Pay (see header).
  const staked = stakedPerContract(opts?.contractTxs)

  const held = new Set<string>()
  for (const a of opts?.heldContracts ?? []) held.add(normAddress(a))
  // What has come back against the funding: never more than was funded.
  const settled = (c: string): bigint => {
    const F = funded.get(c) ?? 0n
    const R = returned.get(c) ?? 0n
    return R < F ? R : F
  }
  // What of the funding is still the user's: refunded back plus staked out in
  // Pay, capped by the funding itself.
  const stillTheirs = (c: string): bigint => {
    const F = funded.get(c) ?? 0n
    const net = (returned.get(c) ?? 0n) + (staked.get(c) ?? 0n)
    return net < F ? net : F
  }

  const out = new Map<string, FlowSplit>()
  for (const f of flows) {
    const leg = { realIn: 0n, internalIn: 0n, realOut: 0n, internalOut: 0n }
    if (f.sender === own) {
      const F = funded.get(f.recipient)
      if (F === undefined) {
        leg.realOut = f.luna
      } else {
        // Funding leg: the part still the user's (held, or settled back —
        // refunded or staked out in Pay — see stillTheirs) stays internal.
        const stillTheirsLuna = held.has(f.recipient) ? F : stillTheirs(f.recipient)
        leg.internalOut = share(f.luna, stillTheirsLuna, F)
        leg.realOut = f.luna - leg.internalOut
      }
    } else {
      const F = funded.get(f.sender)
      if (F === undefined) {
        leg.realIn = f.luna
      } else {
        // Return leg: the part that refunds the funding is internal; any excess
        // over the funding is income.
        const R = returned.get(f.sender) ?? 0n
        leg.internalIn = share(f.luna, settled(f.sender), R)
        leg.realIn = f.luna - leg.internalIn
      }
    }
    out.set(f.hash, {
      realIn: Number(leg.realIn),
      internalIn: Number(leg.internalIn),
      realOut: Number(leg.realOut),
      internalOut: Number(leg.internalOut),
    })
  }
  return out
}

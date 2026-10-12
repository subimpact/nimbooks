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

import type { NimiqTx } from './chain'

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
 */
export function splitHtlcFlows(
  txs: NimiqTx[],
  ownAddress: string,
  opts?: { heldContracts?: Iterable<string> }
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

  const held = new Set<string>()
  for (const a of opts?.heldContracts ?? []) held.add(normAddress(a))
  // What has settled back against the funding: never more than was funded.
  const settled = (c: string): bigint => {
    const F = funded.get(c) ?? 0n
    const R = returned.get(c) ?? 0n
    return R < F ? R : F
  }

  const out = new Map<string, FlowSplit>()
  for (const f of flows) {
    const leg = { realIn: 0n, internalIn: 0n, realOut: 0n, internalOut: 0n }
    if (f.sender === own) {
      const F = funded.get(f.recipient)
      if (F === undefined) {
        leg.realOut = f.luna
      } else {
        // Funding leg: the part still the user's (held, or settled back) stays internal.
        const stillTheirs = held.has(f.recipient) ? F : settled(f.recipient)
        leg.internalOut = share(f.luna, stillTheirs, F)
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

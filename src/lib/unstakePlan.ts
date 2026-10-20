// What a partial unstake will actually do, worked out before anything is sent.
//
// Nimiq rejects a partial deactivation that would leave a staker record below
// the 100 NIM minimum, so an amount that would shrink the active stake under
// the floor gets snapped up to a bigger deactivation that leaves exactly the
// minimum staked - and when the whole active balance is at or under the
// minimum, no partial amount is legal at all and only a full unstake works.
//
// Pure and exported so the submit handler and the unstake panel's inline
// explainer share one set of numbers and can never disagree.

export interface UnstakePlanInput {
  requestedLuna: number // what the user asked to unstake, in Luna
  retiredLuna: number // fully cooled (retired) stake; withdrawn whole, first
  retireableLuna: number // live (active) stake that can be deactivated, in Luna
  inactiveLuna: number // already cooling down (inactive) stake, in Luna
  minStakeLuna: number // protocol minimum a staker record must keep (100 NIM)
}

export interface UnstakePlan {
  retiredCoveredLuna: number // retired stake withdrawn first (always the whole retired balance)
  deactivateLuna: number // active stake that will actually be deactivated
  inactiveCoveredLuna: number // what is left of the request after that, met by stake already cooling down
  snapped: boolean // true when the deactivation was enlarged to respect the minimum
  askedDeactivateLuna: number | null // what was asked for before the snap, when snapped
  remainderLuna: number // active stake left after the deactivation
  fullOnly: boolean // true when the active stake is at or under the minimum, so only a full unstake is legal
}

// Same order as the submit handler: 1. withdraw the whole retired balance
// (the protocol allows nothing partial there), 2. deactivate active stake for
// what is still owed, snapped to keep the 100 NIM minimum, 3. anything left is
// already cooling down and only needs its retire later.
export function planUnstake({
  requestedLuna,
  retiredLuna,
  retireableLuna,
  inactiveLuna,
  minStakeLuna,
}: UnstakePlanInput): UnstakePlan {
  const pos = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0)
  const request = Number.isFinite(requestedLuna) ? Math.max(0, Math.round(requestedLuna)) : 0
  const retired = pos(retiredLuna)
  const retireable = pos(retireableLuna)
  const inactive = pos(inactiveLuna)
  const min = pos(minStakeLuna)

  const retiredCoveredLuna = request > 0 ? retired : 0
  const afterRetired = Math.max(0, request - retired)

  let deactivateLuna = Math.min(afterRetired, retireable)
  const baseRemainder = retireable - deactivateLuna
  let snapped = false
  let askedDeactivateLuna: number | null = null
  let fullOnly = false

  if (deactivateLuna > 0 && baseRemainder > 0 && baseRemainder < min) {
    // A staker record may not sit below the minimum: leave exactly the
    // minimum staked by deactivating the difference. Deactivating everything
    // is fine too (that closes the record), so when the active stake is at or
    // under the minimum no partial amount is legal: only a full unstake.
    askedDeactivateLuna = deactivateLuna
    const snappedTo = retireable - min
    deactivateLuna = Math.max(snappedTo, 0)
    snapped = snappedTo > 0
    fullOnly = snappedTo <= 0
  }

  // A snap deactivates MORE than was asked, so nothing is left for step 3.
  const inactiveCoveredLuna = snapped || fullOnly ? 0 : Math.min(inactive, Math.max(0, afterRetired - deactivateLuna))

  return {
    retiredCoveredLuna,
    deactivateLuna,
    inactiveCoveredLuna,
    snapped,
    askedDeactivateLuna,
    remainderLuna: retireable - deactivateLuna,
    fullOnly,
  }
}

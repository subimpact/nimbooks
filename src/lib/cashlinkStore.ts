// Recently created cashlinks, shelved locally so copy/revert affordances
// survive a reload or a closed sheet. The links themselves live on the Nimiq
// chain — this is a convenience shelf, not a source of truth: status refreshes
// from the chain whenever the sheet opens, and reverting closes the link out.
//
// ⚠️ The `secret` field is the link's private key. It is kept ONLY here (and
// in the shared link); losing it before the link is claimed means losing the
// funds. Entries from the earlier Hub-managed era (no secret) are dropped —
// those links could only be managed inside the Hub.
//
// Kept per wallet address, so a session that signs in with another account
// never shows links it did not make.

export interface StoredCashlink {
  address: string
  /** The link secret (key material). Never sent to any server. */
  secret: string
  valueLuna: number
  message: string
  /** Local label: 'Funding…', 'Ready to claim', 'Claimed or reverted', … */
  status: string
  /** The wallet address the cashlink was created from. */
  from: string
  createdAt: number
  fundingTx?: string
}

const KEY = 'nimbooks.cashlinks.v1'
/** How many records the shelf holds. Exported so the sheet's copy can name the
 *  number instead of repeating it by hand. */
export const CASHLINK_ACTIVE_LIMIT = 20

/** Statuses that mean the link is closed out and its key is worth nothing —
 *  the only entries the shelf may ever evict on its own. */
const FINAL_STATUSES = ['Claimed or reverted', 'Reverted ✓']

function readAll(): StoredCashlink[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    return (list as StoredCashlink[]).filter((c) => c && typeof c.secret === 'string' && c.secret)
  } catch {
    return []
  }
}

/** Returns whether the write landed: a created link must not be funded until
 *  its key is really on the device, so the caller has to be able to tell. */
function writeAll(list: StoredCashlink[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    /* storage full or unavailable */
    return false
  }
}

/** Newest first, for one wallet address. */
export function loadCashlinks(from: string): StoredCashlink[] {
  return readAll()
    .filter((c) => c.from === from)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export type SaveCashlinkResult = { ok: true } | { ok: false; reason: 'storage' | 'limit' }

/**
 * Add (or replace, keyed by address) a created cashlink, and confirm it really
 * landed — the caller must not move any NIM until this answers `ok`.
 *
 * Pruning is state-aware: the shelf only evicts entries that are closed out,
 * oldest first. When nothing is evictable the save is refused rather than
 * dropping a live key, because that key is the only thing that could still
 * claim or revert the funds sitting in its link.
 */
export function saveCashlink(entry: StoredCashlink): SaveCashlinkResult {
  const rest = readAll().filter((c) => c.address !== entry.address)
  let list = [entry, ...rest]
  if (list.length > CASHLINK_ACTIVE_LIMIT) {
    const evictable = list
      .filter((c) => c.address !== entry.address && FINAL_STATUSES.includes(c.status))
      .sort((a, b) => a.createdAt - b.createdAt)
    const drop = new Set(
      evictable.slice(0, list.length - CASHLINK_ACTIVE_LIMIT).map((c) => c.address)
    )
    list = list.filter((c) => !drop.has(c.address))
    if (list.length > CASHLINK_ACTIVE_LIMIT) return { ok: false, reason: 'limit' }
  }
  if (!writeAll(list)) return { ok: false, reason: 'storage' }
  // Written is not the same as stored: read it back before anyone funds it.
  const saved = loadCashlinks(entry.from).some(
    (c) => c.address === entry.address && c.secret === entry.secret
  )
  return saved ? { ok: true } : { ok: false, reason: 'storage' }
}

/** Merge fields into a shelved cashlink (status refreshes, funding hash). */
export function updateCashlink(
  from: string,
  address: string,
  patch: Partial<Pick<StoredCashlink, 'status' | 'fundingTx'>>
): void {
  const list = readAll()
  const idx = list.findIndex((c) => c.from === from && c.address === address)
  if (idx === -1) return
  list[idx] = { ...list[idx], ...patch }
  writeAll(list)
}

/** Forget a shelved cashlink. The sheet only offers this for entries that are
 *  closed out, or for one that was never funded behind an explicit confirm —
 *  the key goes with the record. */
export function removeCashlink(from: string, address: string): void {
  writeAll(readAll().filter((c) => !(c.from === from && c.address === address)))
}

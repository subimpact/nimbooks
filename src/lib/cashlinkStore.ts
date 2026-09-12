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
const LIMIT = 20

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

function writeAll(list: StoredCashlink[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)))
  } catch {
    /* storage full or unavailable — the shelf is best-effort */
  }
}

/** Newest first, for one wallet address. */
export function loadCashlinks(from: string): StoredCashlink[] {
  return readAll()
    .filter((c) => c.from === from)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Add (or replace, keyed by address) a created cashlink. */
export function saveCashlink(entry: StoredCashlink): void {
  const list = readAll().filter((c) => c.address !== entry.address)
  writeAll([entry, ...list])
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

/** Forget a shelved cashlink (only for entries with nothing left in them). */
export function removeCashlink(from: string, address: string): void {
  writeAll(readAll().filter((c) => !(c.from === from && c.address === address)))
}

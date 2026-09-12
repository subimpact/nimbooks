// Recently created cashlinks, shelved locally so copy/manage affordances
// survive a reload or a closed sheet. The links themselves live on the Nimiq
// chain (and in the Hub) — this is a convenience shelf, not a source of truth:
// a status refreshes whenever the user reopens the link in the Hub's manage
// screen, and a stale entry is always deletable by clearing browser storage.
//
// Kept per wallet address, so a Hub session that signs in with another account
// never shows links it did not make.

export interface StoredCashlink {
  address: string
  link: string | null
  valueLuna: number
  message: string
  status: string
  /** The wallet address the cashlink was created from. */
  from: string
  createdAt: number
}

const KEY = 'nimbooks.cashlinks.v1'
const LIMIT = 20

function readAll(): StoredCashlink[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? (list as StoredCashlink[]) : []
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
    .filter((c) => c && c.from === from)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Add (or replace, keyed by address) a created cashlink. */
export function saveCashlink(entry: StoredCashlink): void {
  const list = readAll().filter((c) => c.address !== entry.address)
  writeAll([entry, ...list])
}

/** Update a shelved cashlink's status after a Hub manage round-trip. */
export function updateCashlinkStatus(from: string, address: string, status: string): void {
  const list = readAll()
  const idx = list.findIndex((c) => c.from === from && c.address === address)
  if (idx === -1) return
  list[idx] = { ...list[idx], status }
  writeAll(list)
}

// Backup & restore of everything NimBooks keeps on the device.
//
// The app has no server: receipts, invoices, the staking log and the display
// preferences all live in localStorage. A WebView storage wipe — Nimiq Pay
// clearing its cache, the OS reclaiming space, the user tapping "clear site
// data" — takes the lot with no way back. So the user can take a copy out and
// paste it back in.
//
// The file is plain JSON, opaque only in the sense that it is the raw storage
// values: no encryption, no compression, no server round-trip. It is the
// user's own data in the user's own hands.
//
// That includes the cashlink shelf, whose `secret` fields are the private keys
// of links that may still hold NIM — kept in deliberately, because a restore
// that dropped them would lose the only copy. It also means the file has to be
// kept as carefully as a wallet, which the backup screen says out loud.

export interface BackupFile {
  app: 'nimbooks'
  version: 1
  exportedAt: number
  keys: Record<string, string>
}

const PREFIX = 'nimbooks:'
// Sanity bound on a restore payload. Real books run well under this: one key
// each for currency/theme/device, plus a handful per connected address.
const MAX_KEYS = 100

// Re-fetchable caches. They carry no user intent — every one of them is
// rebuilt from the chain or CoinGecko on the next load — and the tx cache
// alone can run to megabytes, which would blow past what anyone can paste
// into a textarea. Excluded so a backup stays small enough to actually move.
const CACHE_KEYS = ['nimbooks:txs', 'nimbooks:rates', 'nimbooks:prices365', 'nimbooks:validators']
// `nimbooks:txs:<address>` — the history cache is one slot per address, and
// those slots are the megabytes: the bare `nimbooks:txs` above matches none of
// them, so the prefix is what actually keeps a backup pasteable.
const CACHE_PREFIXES = ['nimbooks:restake:', 'nimbooks:txs:']

// The cashlink shelf predates the `nimbooks:` convention and keeps the dotted
// key it shipped with — renaming it now would strand every live link. It holds
// key material that exists nowhere else, so it is named here explicitly rather
// than falling outside the backup on a punctuation mismatch.
const CASHLINK_KEY = 'nimbooks.cashlinks.v1'

/** Re-fetchable, never exported — and never restorable either (see below). */
function isCacheKey(key: string): boolean {
  return CACHE_KEYS.includes(key) || CACHE_PREFIXES.some((p) => key.startsWith(p))
}

function isUserData(key: string): boolean {
  if (key === CASHLINK_KEY) return true
  if (!key.startsWith(PREFIX)) return false
  return !isCacheKey(key)
}

/** Snapshot of the user-created storage on this device. Never throws. */
export function exportBackup(): BackupFile {
  const keys: Record<string, string> = {}
  try {
    for (const k of Object.keys(localStorage)) {
      if (!isUserData(k)) continue
      const v = localStorage.getItem(k)
      if (typeof v === 'string') keys[k] = v
    }
  } catch {
    /* storage unavailable */
  }
  return { app: 'nimbooks', version: 1, exportedAt: Date.now(), keys }
}

/**
 * Parse and vet pasted text. Returns null for anything that is not a NimBooks
 * backup of this version — never throws, so the caller can treat null as "show
 * the user a message" and nothing else.
 */
export function validateBackup(raw: string): BackupFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const file = parsed as Record<string, unknown>
  if (file.app !== 'nimbooks' || file.version !== 1) return null
  const keys = file.keys
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null

  const entries = Object.entries(keys as Record<string, unknown>)
    // A cache key in a pasted file is not a backup of anything: it would seed
    // History, the CSV and the tax statement with transactions nobody made,
    // and a tx cache stamped in the future used to outlive its TTL. Dropped
    // rather than rejected, because backups taken before the tx slots were
    // excluded carry them honestly.
    .filter(([k]) => !isCacheKey(k))
  if (entries.length > MAX_KEYS) return null
  for (const [k, v] of entries) {
    // The prefix check is also what keeps a hostile payload from reaching any
    // storage key that isn't ours — including `__proto__`, which JSON.parse
    // does hand back as a plain own property. The cashlink shelf is the one
    // key of ours that doesn't wear the prefix.
    if (!k.startsWith(PREFIX) && k !== CASHLINK_KEY) return null
    if (typeof v !== 'string') return null
  }

  const exportedAt =
    typeof file.exportedAt === 'number' && Number.isFinite(file.exportedAt) ? file.exportedAt : 0
  return {
    app: 'nimbooks',
    version: 1,
    exportedAt,
    keys: Object.fromEntries(entries) as Record<string, string>,
  }
}

/**
 * Merge a backup into local storage. A key that already exists is left alone:
 * a restore must never clobber live books, so the device you are restoring
 * onto always wins. `skipped` is that collision count.
 */
export function importBackup(file: BackupFile): { restored: number; skipped: number } {
  let restored = 0
  let skipped = 0
  for (const [k, v] of Object.entries(file.keys)) {
    // `validateBackup` already dropped these; this function is exported on its
    // own, so a fabricated cache must not get in through it either.
    if (isCacheKey(k)) {
      skipped++
      continue
    }
    try {
      if (localStorage.getItem(k) !== null) {
        skipped++
        continue
      }
      localStorage.setItem(k, v)
      restored++
    } catch {
      // Quota or a locked-down WebView — count it as not restored rather than
      // aborting halfway and leaving the caller with no number to report.
      skipped++
    }
  }
  return { restored, skipped }
}

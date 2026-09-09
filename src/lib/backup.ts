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
const CACHE_PREFIXES = ['nimbooks:restake:']

function isUserData(key: string): boolean {
  if (!key.startsWith(PREFIX)) return false
  if (CACHE_KEYS.includes(key)) return false
  return !CACHE_PREFIXES.some((p) => key.startsWith(p))
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
  if (entries.length > MAX_KEYS) return null
  for (const [k, v] of entries) {
    // The prefix check is also what keeps a hostile payload from reaching any
    // storage key that isn't ours — including `__proto__`, which JSON.parse
    // does hand back as a plain own property.
    if (!k.startsWith(PREFIX)) return null
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

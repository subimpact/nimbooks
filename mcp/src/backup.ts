// Read-only reader for a NimBooks backup file (Backup → Copy in the app,
// saved to disk and passed here with `--backup <path>`).
//
// The file is the raw localStorage values, shape defined by the app's
// `src/lib/backup.ts`: `{ app, version, exportedAt, keys }`. Only the invoice
// slots are read.
//
// The cashlink shelf (`nimbooks.cashlinks.v1`) is in that file too, and every
// entry carries a `secret` — the private key of a link that may still hold
// NIM. This module never opens it. Not "reads it and drops the field": never
// parses it. There is no tool here that could use one, and the safest thing to
// do with key material is not to touch it.

import { formatLunaExact, isValidInvoice, type InvoicePayload } from './invoice.ts'
import { cleanAddress, ToolError } from './chain.ts'

const CASHLINK_KEY = 'nimbooks.cashlinks.v1'

export interface BackupFile {
  exportedAt: number
  keys: Record<string, string>
}

export interface BackupInvoice {
  id: string
  amountLuna: string
  amountNim: string
  memo?: string
  createdAt: string // ISO 8601 (UTC)
  expiresAt?: string
  status: 'paid' | 'expired' | 'pending'
  role: 'payee' | 'payer'
  paidTxHash?: string
  link: string
}

/**
 * Parse and vet a backup file's text. Returns null for anything that is not a
 * NimBooks v1 backup — never throws, so the caller decides what to say.
 */
export function parseBackup(raw: string): BackupFile | null {
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

  const entries = Object.entries(keys as Record<string, unknown>).filter(
    // The shelf of link private keys is dropped here, at the door.
    ([k, v]) => typeof v === 'string' && k !== CASHLINK_KEY
  ) as [string, string][]

  const exportedAt =
    typeof file.exportedAt === 'number' && Number.isFinite(file.exportedAt) ? file.exportedAt : 0
  return { exportedAt, keys: Object.fromEntries(entries) }
}

export function readBackupFile(path: string, read: (p: string) => string): BackupFile {
  let raw: string
  try {
    raw = read(path)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new ToolError(`Could not read the backup file at ${path} (${msg}).`)
  }
  const file = parseBackup(raw)
  if (!file) {
    throw new ToolError(
      `${path} is not a NimBooks backup. Take a fresh one in the app: ` +
        `Backup → Copy, then save the clipboard to a .json file.`
    )
  }
  return file
}

// Invoices are stored per account under `nimbooks:invoices:<address>`, where
// <address> is spelled however the wallet handed it over — spaced on one
// device, flat on another. Match on the normalised suffix so either spelling
// finds the right slot, and fall back to the pre-per-account key.
function invoiceSlots(file: BackupFile, address: string): string[] {
  const want = cleanAddress(address).toUpperCase()
  const slots: string[] = []
  for (const key of Object.keys(file.keys)) {
    if (key === 'nimbooks:invoices') {
      slots.push(key) // legacy single-account slot
      continue
    }
    if (!key.startsWith('nimbooks:invoices:')) continue
    if (cleanAddress(key.slice('nimbooks:invoices:'.length)).toUpperCase() === want) slots.push(key)
  }
  return slots
}

interface StoredInvoice extends InvoicePayload {
  role: 'payee' | 'payer'
  paid?: boolean
  paidTxHash?: string
  unpaidByUser?: boolean
}

/**
 * The address's payment requests, newest first. A slot that doesn't parse, or
 * an entry that isn't a valid invoice, is skipped rather than failing the
 * call: a backup is a hand-moved file and one bad row must not cost the user
 * the other forty-nine.
 */
export function listBackupInvoices(
  file: BackupFile,
  address: string,
  linkFor: (inv: InvoicePayload) => string,
  now: number
): { invoices: BackupInvoice[]; skipped: number } {
  const out: BackupInvoice[] = []
  let skipped = 0

  for (const slot of invoiceSlots(file, address)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(file.keys[slot])
    } catch {
      skipped++
      continue
    }
    if (!Array.isArray(parsed)) {
      skipped++
      continue
    }
    for (const entry of parsed) {
      if (!isValidInvoice(entry)) {
        skipped++
        continue
      }
      const inv = entry as StoredInvoice
      const role = inv.role === 'payer' ? 'payer' : 'payee'
      out.push({
        id: inv.id,
        amountLuna: inv.amountNim,
        amountNim: formatLunaExact(inv.amountNim),
        ...(inv.memo ? { memo: inv.memo } : {}),
        createdAt: isoOrUnknown(inv.createdAt),
        ...(inv.expiresAt ? { expiresAt: isoOrUnknown(inv.expiresAt) } : {}),
        // Same rule as the app's `invoiceStatus`: paid wins, then expiry.
        status: inv.paid ? 'paid' : inv.expiresAt && now > inv.expiresAt ? 'expired' : 'pending',
        role,
        ...(inv.paidTxHash ? { paidTxHash: inv.paidTxHash } : {}),
        link: linkFor(inv),
      })
    }
  }

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return { invoices: out, skipped }
}

function isoOrUnknown(ms: number): string {
  try {
    return new Date(ms).toISOString()
  } catch {
    return 'unknown'
  }
}

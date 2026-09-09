// Payment requests (invoices) — self-contained, shareable, client-side only.
// An invoice is a JSON payload carried inside the share link's URL fragment
// (same URL-safe base64 convention as receipts in receipt.ts), so no server
// ever sees it. Locally created requests are kept per account in localStorage.

export interface InvoicePayload {
  app: 'nimbooks'
  v: 1
  id: string
  payer?: string // optional — set when the request targets a specific address
  payee: string // who gets paid
  amountNim: string // Luna (1 NIM = 1e5 Luna) — string, never a float
  memo?: string // human description, travels in the link (not on-chain)
  createdAt: number // ms
  expiresAt?: number // ms
}

export type InvoiceStatus = 'pending' | 'paid' | 'expired'

// Local bookkeeping around a payload. `role` records which side of the
// request this device is on: 'payee' (you asked) or 'payer' (you paid).
export interface StoredInvoice extends InvoicePayload {
  role: 'payee' | 'payer'
  paid?: boolean
  paidTxHash?: string
  paidAt?: number
  // Set when the user marked a request unpaid by hand. Auto-reconciliation
  // matches the tagged transaction forever, so without this the effect just
  // marks it paid again on the next pass and the toggle looks broken.
  unpaidByUser?: boolean
}

export const MAX_INVOICES = 50
export const MAX_MEMO_CHARS = 80
// Nimiq caps basic-transaction data at 64 bytes, so the on-chain reference
// must stay short. Only the invoice tag goes on-chain; the memo rides along
// in the share link.
export const MAX_LUNA = 200000000000000n // 2e9 NIM

// --- On-chain reference ---
// Paying from an invoice tags the transaction with `nimbooks:invoice:<id>`,
// which is what lets the payee's History mark the request paid automatically.
const INVOICE_MEMO_RE = /^nimbooks:invoice:([0-9a-z-]+)$/i

export function invoiceMemo(id: string): string {
  return `nimbooks:invoice:${id}`
}

export function parseInvoiceMemo(memo: string | undefined): string | null {
  if (!memo) return null
  const m = memo.trim().match(INVOICE_MEMO_RE)
  return m ? m[1] : null
}

export function newInvoiceId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10)
}

// --- Amount handling (exact string math — no float drift) ---

/**
 * Parse a user-typed NIM amount into Luna. Returns null when the input is not
 * a positive amount with at most 5 decimals and within the supply cap.
 */
export function parseNimToLuna(input: string): string | null {
  const s = input.trim().replace(/\s/g, '')
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null
  const [intPart, fracPart = ''] = s.split('.')
  if (fracPart.length > 5) return null // finer than a Luna
  const luna = BigInt(intPart || '0') * 100000n + BigInt(fracPart.padEnd(5, '0') || '0')
  if (luna <= 0n || luna > MAX_LUNA) return null
  return luna.toString()
}

/** Luna → exact decimal NIM string (no locale separators, no trailing zeros). */
export function formatLunaExact(luna: string): string {
  let n: bigint
  try {
    n = BigInt(luna)
  } catch {
    return '0'
  }
  const neg = n < 0n
  if (neg) n = -n
  const whole = n / 100000n
  const frac = (n % 100000n).toString().padStart(5, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}

// --- Link encoding (mirrors receipt.ts) ---

export function encodeInvoice(inv: InvoicePayload): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(canonicalInvoice(inv)))))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeInvoice(encoded: string): InvoicePayload | null {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const raw = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return isValidInvoice(raw) ? raw : null
  } catch {
    return null
  }
}

// Keep the link short and the field order stable.
function canonicalInvoice(inv: InvoicePayload): InvoicePayload {
  const out: InvoicePayload = {
    app: 'nimbooks',
    v: 1,
    id: inv.id,
    payee: inv.payee.replace(/\s+/g, '').toUpperCase(),
    amountNim: inv.amountNim,
    createdAt: inv.createdAt,
  }
  if (inv.payer) out.payer = inv.payer.replace(/\s+/g, '').toUpperCase()
  if (inv.memo) out.memo = inv.memo
  if (inv.expiresAt) out.expiresAt = inv.expiresAt
  return out
}

export function isValidInvoice(x: unknown): x is InvoicePayload {
  if (!x || typeof x !== 'object') return false
  const i = x as Record<string, unknown>
  if (i.app !== 'nimbooks' || i.v !== 1) return false
  if (typeof i.id !== 'string' || !i.id) return false
  // Accept both address spellings — "NQ43 6G6H …" and the flat form.
  if (typeof i.payee !== 'string' || !/^NQ[0-9A-Z]{34}$/i.test(i.payee.replace(/\s+/g, ''))) return false
  if (i.payer !== undefined && (typeof i.payer !== 'string' || !/^NQ[0-9A-Z]{34}$/i.test(i.payer.replace(/\s+/g, ''))))
    return false
  if (typeof i.amountNim !== 'string' || !/^\d+$/.test(i.amountNim)) return false
  if (BigInt(i.amountNim) <= 0n || BigInt(i.amountNim) > MAX_LUNA) return false
  if (typeof i.createdAt !== 'number' || !Number.isFinite(i.createdAt)) return false
  if (i.memo !== undefined && typeof i.memo !== 'string') return false
  if (i.expiresAt !== undefined && typeof i.expiresAt !== 'number') return false
  return true
}

/** The app route this request lives at — the whole payload rides in the hash. */
export function invoiceRoute(inv: InvoicePayload): string {
  return `#/invoice/${encodeInvoice(inv)}`
}

// The link this page would produce for itself. Used for the QR code, which is
// scanned off whatever screen the request is shown on; a link that leaves this
// origin (a share) goes through device.siteLink instead.
export function invoiceUrl(inv: InvoicePayload): string {
  return `${window.location.origin}${window.location.pathname}${invoiceRoute(inv)}`
}

// --- Status ---

export function invoiceStatus(inv: StoredInvoice | (InvoicePayload & { paid?: boolean }), now = Date.now()): InvoiceStatus {
  if (inv.paid) return 'paid'
  if (inv.expiresAt && now > inv.expiresAt) return 'expired'
  return 'pending'
}

// --- Per-account storage ---

export function invoicesKey(address?: string | null): string {
  return address ? `nimbooks:invoices:${address}` : 'nimbooks:invoices'
}

export function loadInvoices(address?: string | null): StoredInvoice[] {
  try {
    const raw = localStorage.getItem(invoicesKey(address))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((i): i is StoredInvoice => {
      if (!isValidInvoice(i)) return false
      const role = (i as Partial<StoredInvoice>).role
      return role === 'payee' || role === 'payer'
    })
  } catch {
    return []
  }
}

export function saveInvoices(address: string | null | undefined, invoices: StoredInvoice[]): void {
  try {
    localStorage.setItem(invoicesKey(address), JSON.stringify(invoices.slice(0, MAX_INVOICES)))
  } catch {
    /* storage full — keep in memory */
  }
}

/** Insert or replace an invoice (matched by id) in the account's list. */
export function upsertInvoice(
  address: string | null | undefined,
  invoice: StoredInvoice
): StoredInvoice[] {
  const existing = loadInvoices(address)
  const next = [invoice, ...existing.filter((i) => i.id !== invoice.id)].slice(0, MAX_INVOICES)
  saveInvoices(address, next)
  return next
}

export const EXPIRY_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'No expiry', ms: null },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
]

// Payment requests (invoices) — the link format, ported byte-for-byte from the
// app's `src/lib/invoice.ts`.
//
// The whole request rides inside the URL fragment as URL-safe base64 of a
// canonical JSON payload, so no server ever sees it and the app's own decoder
// is the only thing that has to agree with this file. `test/invoice-parity.test.ts`
// holds that line: it encodes with this module and decodes with the app's.
//
// Nothing here signs anything. A payment request is a *request*: the payer's
// wallet is what moves money, and it does that only when its owner approves.

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

export const MAX_MEMO_CHARS = 80
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

// --- Link encoding ---
//
// The app builds this with `btoa(unescape(encodeURIComponent(json)))`, which is
// base64 of the UTF-8 bytes. Buffer says the same thing in one step and without
// leaning on two functions Annex B lists as deprecated — the parity test pins
// the two against each other for ASCII, emoji and CJK memos alike.

export function encodeInvoice(inv: InvoicePayload): string {
  const b64 = Buffer.from(JSON.stringify(canonicalInvoice(inv)), 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeInvoice(encoded: string): InvoicePayload | null {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const raw = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    return isValidInvoice(raw) ? raw : null
  } catch {
    return null
  }
}

// Keep the link short and the field order stable. Field order is part of the
// format here: it decides the bytes, and the bytes are what has to match.
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
  // The id is not just a label: it becomes the on-chain memo the payer signs
  // (`invoiceMemo`), so a crafted link must not be able to write arbitrary text
  // into someone else's transaction data, blow Nimiq's 64-byte cap, or produce
  // a reference that INVOICE_MEMO_RE can never reconcile.
  if (typeof i.id !== 'string' || !/^[0-9a-z-]{1,24}$/i.test(i.id)) return false
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

// The public site, hardcoded exactly as the app hardcodes it (`src/lib/device.ts`),
// for the same reason: a link built from anywhere else is dead for whoever gets
// it. This server never *calls* that host — it only writes the address into a
// link, the way a printed invoice carries a street address.
export const NIMBOOKS_SITE_URL = 'https://nimbooks.subimpact.net'

export function invoiceUrl(inv: InvoicePayload): string {
  return `${NIMBOOKS_SITE_URL}/${invoiceRoute(inv)}`
}

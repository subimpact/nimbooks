// Public supporters oracle — donations arriving at the NimBooks donation address.
//
// This is a module, not an endpoint (files under functions/_lib are never routed
// by Pages): `functions/api/supporters.ts` imports from here.
//
// Privacy is the design constraint. Supporter addresses live only on the server,
// in memory: they are never written into the bundle, never served, never logged.
// A supporter's name is looked up in a map keyed by the SHA-256 of the
// normalised on-chain address, so even a leaked cache dump carries no addresses
// — only digests that map to a consented display name. A donor not in that map
// renders as "Anonymous supporter", and several donations from one sender fold
// into a single row.

/** The donation address. Public on purpose — it is the owner's receiving address. */
export const DONATION_ADDRESS = 'NQ39 XC3L JHXL 5GKB K09G J765 X577 PS3A KHFE'

/** History reader. It 429s bursts, so callers pace and cache. */
const RPC_URL = 'https://rpc.nimiqwatch.com'
const RPC_UA =
  'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'

/** Donations below this luna count are dust (funding tops, not support). */
export const MIN_DONATION_LUNA = 100000

/** Addresses whose incoming transfers never count as donations. Kept as one list. */
const DENY_LIST = [
  // Nimiq.Space mining pool payouts memo'd "You mined NIM on Nimiq.Space!" —
  // the owner's own mining, not support.
  'NQ162SSN82TLSMQSKXT3Q01VCMALNU6F1LJG',
  // The staking contract: a deactivated stake is refunded by it, which would
  // otherwise look like a huge anonymous donation.
  'NQ770000000000000000000000000000000001',
]

/** Spaces stripped, uppercased — the form addresses take in every comparison here. */
export function normaliseAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const isDenied = (from: string): boolean => {
  const flat = normaliseAddress(from)
  return DENY_LIST.some((a) => a === flat)
}

// ── SHA-256, synchronous and dependency-free ────────────────────────────────
//
// crypto.subtle.digest in a Pages Function is asynchronous, and the summary is
// pure and testable outside workers only if name lookup stays synchronous. This
// is the standard compression path, small enough to review line by line.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  // Message + 0x80 + padding to a 56-length block + 8 length bytes.
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  // Big-endian bit length. Shift counts in JS are mod 32, so the length must
  // go down through a DataView rather than a `>>> (i*8)` walk.
  const lenView = new DataView(padded.buffer, padded.byteOffset)
  lenView.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32))
  lenView.setUint32(padded.length - 4, bitLen % 2 ** 32)

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = new DataView(padded.buffer, padded.byteOffset + off, 64).getUint32(i * 4)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }
  return Array.from(h)
    .map((x) => x.toString(16).padStart(8, '0'))
    .join('')
}

// ── Names: consented display names, keyed by address digest ────────────────
//
// Only the digest is in source, never the address it came from. Adding a
// supporter means adding the SHA-256 of their normalised address here, with
// their consent to the name.

const SUPPORTER_NAMES: Record<string, string> = {
  // "Wool" — consented to his display name and donation amount, not his address.
  '09c216087db04647c60216189635c6e60b55e6e050438896049d713bc95ce00f': 'Wool',
}

const ANONYMOUS = 'Anonymous supporter'

/** How a row comes back from the chain reader. */
export interface DonationRow {
  hash: string
  from: string
  to: string
  fromType: number
  value: number // luna
  timestamp: number // milliseconds since the epoch on PoS
  executionResult: boolean
}

export interface SupporterRow {
  name: string
  amountNim: number
  lastAt: number // milliseconds
}

export interface DonationSummary {
  totalNim: number
  count: number // donations, not supporters
  supporters: SupporterRow[] // sorted by amount, highest first
}

/** Which incoming transfers count as donations. */
export const isDonation = (row: DonationRow, donationAddress: string): boolean =>
  normaliseAddress(row.to) === normaliseAddress(donationAddress) &&
  row.fromType === 0 &&
  row.executionResult !== false &&
  row.value >= MIN_DONATION_LUNA &&
  !isDenied(row.from)

/**
 * Fold chain rows into the public view: a total, the donation count, and one
 * row per supporter. Pure and synchronous; the digest lookup keeps the caller
 * from ever having to hold an address next to a name.
 */
export function summariseDonations(rows: DonationRow[], donationAddress: string = DONATION_ADDRESS): DonationSummary {
  const byDigest = new Map<string, { name: string; luna: number; lastAt: number }>()
  let totalLuna = 0
  let count = 0
  for (const row of rows) {
    if (!isDonation(row, donationAddress)) continue
    totalLuna += row.value
    count++
    const digest = sha256Hex(normaliseAddress(row.from))
    const name = SUPPORTER_NAMES[digest] ?? ANONYMOUS
    const held = byDigest.get(digest)
    if (held) {
      held.luna += row.value
      held.lastAt = Math.max(held.lastAt, row.timestamp)
    } else {
      byDigest.set(digest, { name, luna: row.value, lastAt: row.timestamp })
    }
  }
  const supporters = [...byDigest.values()]
    .map((s) => ({ name: s.name, amountNim: s.luna / 100000, lastAt: s.lastAt }))
    .sort((a, b) => b.amountNim - a.amountNim)
  return { totalNim: totalLuna / 100000, count, supporters }
}

// ── Fetching: page the chain history ────────────────────────────────────────

const PAGE_SIZE = 500
const MAX_PAGES = 10
const PAGE_PACING_MS = 300

/** POST one history page. It 429s bursts, so callers pace between pages. */
async function rpcPage(address: string, cursor: string | null): Promise<DonationRow[]> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransactionsByAddress',
    params: [address, PAGE_SIZE, cursor],
  })
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': RPC_UA },
    body,
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const json = (await res.json()) as { result?: { data?: DonationRow[] } }
  return json.result?.data ?? []
}

/** Every history page for the donation address, oldest cursor walk, capped. */
export async function fetchDonationRows(donationAddress: string = DONATION_ADDRESS): Promise<DonationRow[]> {
  const rows: DonationRow[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await rpcPage(donationAddress, cursor)
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    cursor = batch[batch.length - 1]?.hash ?? null
    if (!cursor) break
    await new Promise((r) => setTimeout(r, PAGE_PACING_MS))
  }
  return rows
}
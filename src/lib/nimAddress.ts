// Nimiq address decoding, in plain TypeScript.
//
// Ownership of an HTLC extension is proved from the transaction data alone (the
// first 20 bytes of a contract-creation payload are the HTLC's sender, i.e. the
// refund address), so the only thing needed here is address -> bytes. Pulling
// @nimiq/core in for that would cost a few hundred KB for one conversion, so
// the base32 alphabet is spelled out instead.
//
// No RPC, no DOM, no imports: pure enough to be used from the contract archive
// oracle as well as from the app.

// Nimiq's base32 alphabet (RFC 4648 without I, O, W and Z).
const NIMIQ_BASE32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

/**
 * The 20 address bytes as lowercase hex, or null on anything malformed.
 *
 * The display form is `NQxx xxxx ...` with 36 base32 characters: the four
 * character prefix (`NQ` plus two check characters) is dropped, the remaining
 * 32 characters decode to 160 bits, MSB first. The check characters are not
 * verified here: ownership only needs the bytes, and a mistyped address that
 * still decodes simply matches nothing.
 */
export function addressToHex(address: string): string | null {
  if (typeof address !== 'string') return null
  const flat = address.replace(/\s+/g, '').toUpperCase()
  // "NQ" + 2 check chars + 32 payload chars.
  if (!/^NQ[0-9A-Z]{34}$/.test(flat)) return null
  const payload = flat.slice(4)
  const bytes: number[] = []
  let acc = 0
  let bits = 0
  for (const ch of payload) {
    const value = NIMIQ_BASE32.indexOf(ch)
    if (value < 0) return null
    // 5 bits per character; the window never needs more than 12 bits, so the
    // mask only keeps the accumulator from growing without bound.
    acc = ((acc << 5) | value) & 0xffff
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  if (bytes.length !== 20 || bits !== 0) return null
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

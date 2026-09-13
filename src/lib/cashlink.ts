// Hand-rolled cashlinks — the money rides inside a link.
//
// Format, byte-for-byte with hub.nimiq.com (src/lib/Cashlink.ts) and
// nimiq/cashlink-generator (src/cashlink.ts), as base64url of:
//   privateKey[32] | value uint64 BE [| messageLength uint8 | message]
// so every link we mint also claims at hub.nimiq.com/cashlink, and every
// link the Hub mints parses here.
//
// The private key is generated in this client and never leaves it: it rides
// in the URL fragment (fragments are never sent to any server) and in the
// local shelf (localStorage) so the sender can revert. Nothing in this
// module talks to a server except reading balances and broadcasting.
//
// Transactions we build ourselves (both ends of the link's life):
//   claim / revert: a sweep signed with the link's own key and tagged with
//     the Hub's CLAIMING extra data. No wallet signature is involved — the
//     link holds its own key; the wallet only supplied, or later receives,
//     the funds.
//   funding: NOT built here. It is a regular send to the link address that
//     goes through the usual wallet flow (Nimiq Pay approval / Hub checkout),
//     tagged with the Hub's FUNDING extra data via sendNim's extraData.

import { broadcastRawTransaction, getNimiqBalance, getNimiqBlockNumber } from './chain'

type NimiqCoreModule = typeof import('@nimiq/core')

// Same bytes hub.nimiq.com attaches to funding and claiming transactions
// ('CASH' and 'LINK' in Nimiq's compact extra-data encoding).
export const FUNDING_DATA = new Uint8Array([0, 130, 128, 146, 135])
export const CLAIMING_DATA = new Uint8Array([0, 139, 136, 141, 138])

// The same two tags as they come back from the chain. They are not text, so
// `decodeMemo` hands them back as raw hex; Nimiq Pay's rail takes a string
// rather than bytes, so a funding sent from there carries the word instead.
const CASHLINK_TAGS = [FUNDING_DATA, CLAIMING_DATA].map((bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
)
const PAY_FUNDING_MEMO = 'Cashlink'

/**
 * Is this decoded memo one of the cashlink tags rather than a note someone
 * wrote? Protocol furniture, like a staking transaction's signalling payload:
 * History and the CSV say "Cashlink" instead of printing the bytes.
 */
export function isCashlinkMemo(memo: string): boolean {
  if (memo === PAY_FUNDING_MEMO) return true
  return CASHLINK_TAGS.includes(memo.replace(/^0x/, '').toLowerCase())
}

// Nimiq mainnet; the app is mainnet-only.
const MAINNET_NETWORK_ID = 24
const FEE = 0n
// The message length rides in a uint8, so that is the hard ceiling.
const MAX_MESSAGE_BYTES = 255

let core: NimiqCoreModule | null = null
let corePromise: Promise<NimiqCoreModule> | null = null

/**
 * Load the signer module (wasm, ~1.2 MB — the same lazily-imported module
 * the Hub staking path uses). Warm it while the sheet is open so that key
 * generation never sits between a click and the wallet popup. Safe to call
 * repeatedly; resolves to whether the signer is ready.
 */
export async function prepareCashlinkCore(): Promise<boolean> {
  if (!corePromise) {
    corePromise = import('@nimiq/core')
      .then((m) => {
        core = m
        return m
      })
      .catch((e) => {
        corePromise = null
        console.warn('@nimiq/core failed to load:', e)
        throw e
      })
  }
  try {
    await corePromise
  } catch {
    return false
  }
  return true
}

export function cashlinkCoreReady(): boolean {
  return core !== null
}

export interface FreshCashlink {
  secret: string
  address: string
}

/** The created cashlink as the sheet presents and tracks it. */
export interface CashlinkResultView {
  address: string
  secret: string
  valueLuna: number
  message: string
  status: string
}

export interface ParsedCashlink {
  secret: string
  address: string
  valueLuna: number
  message: string
}

/**
 * Generate a fresh link. Synchronous once the signer is ready — it runs
 * inside the create click, before the wallet call, with no await in between.
 */
export function newCashlink(valueLuna: number, message: string): FreshCashlink {
  const N = core
  if (!N) throw new Error('The cashlink signer is not ready yet.')
  if (!Number.isSafeInteger(valueLuna) || valueLuna <= 0) {
    throw new Error('Enter an amount above 0.')
  }
  // The format stores the message length in a single byte, and the writer
  // below wraps silently past that — so refuse here rather than mint a link
  // whose message decodes as garbage.
  if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) {
    throw new Error(
      `That message is too long. A cashlink message holds up to ${MAX_MESSAGE_BYTES} bytes.`
    )
  }
  const keyPair = N.KeyPair.derive(N.PrivateKey.generate())
  const secret = renderSecret(N, keyPair.privateKey.serialize(), valueLuna, message)
  return { secret, address: keyPair.toAddress().toUserFriendlyAddress() }
}

/**
 * Render the secret exactly like the Hub does (and undo-able: parse below
 * accepts Hub output). The `.`→`=` and `~` steps mirror the Hub's iPhone /
 * WhatsApp URL workarounds; on the current core the padding dots no longer
 * occur but the transform is kept for byte-parity.
 */
function renderSecret(N: NimiqCoreModule, privateKey: Uint8Array, valueLuna: number, message: string): string {
  const messageBytes = new TextEncoder().encode(message)
  const buf = new N.SerialBuffer(32 + 8 + (messageBytes.length ? 1 : 0) + messageBytes.length)
  buf.write(privateKey)
  buf.writeUint64(valueLuna)
  if (messageBytes.length) {
    buf.writeUint8(messageBytes.length)
    buf.write(messageBytes)
  }
  let secret = N.BufferUtils.toBase64Url(buf)
  secret = secret.replace(/\./g, '=')
  secret = secret.replace(/[A-Za-z0-9_]{257,}/g, (match) => match.replace(/.{256}/g, '$&~'))
  return secret
}

interface DecodedCashlink {
  keyPair: import('@nimiq/core').KeyPair
  valueLuna: number
  message: string
}

function decodeSecret(secret: string): DecodedCashlink | null {
  const N = core
  if (!N) return null
  try {
    // Accept both spellings (our render output, the Hub's, and legacy `~`
    // breaks): strip the soft breaks and any padding before decoding.
    const cleaned = secret.replace(/~/g, '').replace(/[.=]+$/, '')
    const buffer = N.BufferUtils.fromBase64Url(cleaned)
    const sb = new N.SerialBuffer(buffer)
    const privateKey = N.PrivateKey.deserialize(sb.read(32))
    const keyPair = N.KeyPair.derive(privateKey)
    const valueLuna = Number(sb.readUint64())
    let message = ''
    if (sb.readPos !== sb.byteLength) {
      const length = sb.readUint8()
      message = new TextDecoder().decode(sb.read(length))
    }
    return { keyPair, valueLuna, message }
  } catch (e) {
    console.warn('Cashlink parse failed:', e)
    return null
  }
}

/** Parse a secret into its public facts; null when the link is invalid. */
export function parseCashlink(secret: string): ParsedCashlink | null {
  const decoded = decodeSecret(secret)
  if (!decoded) return null
  return {
    secret,
    address: decoded.keyPair.toAddress().toUserFriendlyAddress(),
    valueLuna: decoded.valueLuna,
    message: decoded.message,
  }
}

/** The canonical share link — the Hub's claim page understands the same secret. */
export function cashlinkShareUrl(secret: string): string {
  return `https://hub.nimiq.com/cashlink/#${secret}`
}

export type SweepResult = { ok: true; hash: string } | { ok: false; error: string }

/**
 * Move the whole balance of a cashlink to `recipient`, signed with the
 * link's own key (so this leg needs no wallet approval). Used for reverting
 * back to the sender; the same sweep serves claiming, once a claim screen
 * exists.
 */
export async function sweepCashlink(secret: string, recipient: string): Promise<SweepResult> {
  // A revert can be tapped from the shelf on a fresh load, where nothing has
  // warmed the signer yet. This leg is already async, so load it here instead
  // of sending the user away; the message below is the last resort.
  if (!core) await prepareCashlinkCore()
  const N = core
  if (!N) return { ok: false, error: 'The cashlink signer is not ready yet.' }
  const decoded = decodeSecret(secret)
  if (!decoded) return { ok: false, error: 'This cashlink link is not valid.' }
  try {
    const balance = Number(await getNimiqBalance(decoded.keyPair.toAddress().toUserFriendlyAddress()))
    if (!Number.isFinite(balance) || balance <= 0) {
      return {
        ok: false,
        error: 'Nothing to move — this cashlink is empty (already claimed, reverted, or not funded yet).',
      }
    }
    const height = await getNimiqBlockNumber()
    const tx = N.TransactionBuilder.newBasicWithData(
      decoded.keyPair.toAddress(),
      N.Address.fromUserFriendlyAddress(recipient.replace(/\s+/g, '').toUpperCase()),
      CLAIMING_DATA,
      BigInt(balance),
      FEE,
      height,
      MAINNET_NETWORK_ID
    )
    decoded.keyPair.signTransaction(tx)
    const hash = await broadcastRawTransaction(N.BufferUtils.toHex(tx.serialize()))
    return { ok: true, hash }
  } catch (e) {
    console.error('Cashlink sweep failed:', e)
    const message = e instanceof Error ? e.message : ''
    return { ok: false, error: message || 'The cashlink transaction could not reach the network.' }
  }
}

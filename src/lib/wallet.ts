// Wallet adapter — provider-agnostic layer.
// Nimiq-specific calls live ONLY here, so the app can port to
// Telegram Mini Apps / Farcaster later by swapping this file.

import { init, requestDeviceIdentifier, getHostLanguage } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import HubApi from '@nimiq/hub-api'
import type { SignedReceipt } from './receipt'
import { canonicalPayload } from './receipt'
import { broadcastRawTransaction, encodeMemo } from './chain'

export interface WalletAccount {
  nimiqAddress?: string
  evmAddress?: string
  provider: 'pay' | 'hub' | 'demo'
}

let nimiqProvider: NimiqProvider | null = null
let hubApi: HubApi | null = null
let activeProvider: 'pay' | 'hub' | 'demo' = 'pay'
let currentAccount: WalletAccount | null = null

export function isDemoMode(): boolean {
  return activeProvider === 'demo'
}

/**
 * The account connected in this session, if any. Lets a hash-route page (e.g.
 * an invoice link opened from inside the app) reuse the live connection
 * instead of asking the user to connect again.
 */
export function getConnectedAccount(): WalletAccount | null {
  return currentAccount
}

function getHub(): HubApi {
  if (!hubApi) hubApi = new HubApi('https://hub.nimiq.com')
  return hubApi
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function connectWallet(): Promise<WalletAccount> {
  const account: WalletAccount = { provider: 'pay' }
  activeProvider = 'pay'

  // Nimiq side
  try {
    nimiqProvider = await init({ timeout: 10000 })
    const accounts = await nimiqProvider.listAccounts()
    if (Array.isArray(accounts) && accounts.length > 0) {
      account.nimiqAddress = accounts[0]
    }
  } catch (e) {
    console.warn('Nimiq provider unavailable:', e)
  }

  // EVM side
  try {
    if (window.ethereum) {
      const evmAccounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (Array.isArray(evmAccounts) && evmAccounts.length > 0) {
        account.evmAddress = evmAccounts[0]
      }
    }
  } catch (e) {
    console.warn('EVM provider unavailable:', e)
  }

  currentAccount = account
  return account
}

// Browser fallback: Nimiq Hub web-wallet login (choose-address popup).
// Gives NIM address only — EVM assets stay a Nimiq Pay bonus.
export async function connectHub(): Promise<WalletAccount> {
  const result = await getHub().chooseAddress({ appName: 'NimBooks' })
  if (!result?.address) throw new Error('No address returned from Nimiq Hub.')
  activeProvider = 'hub'
  currentAccount = { nimiqAddress: result.address, provider: 'hub' }
  return currentAccount
}

// Read-only demo mode: sets the module-level provider so signing is
// correctly disabled (a demo address is not owned by the user).
export function connectDemoAccount(address: string): WalletAccount {
  activeProvider = 'demo'
  currentAccount = { nimiqAddress: address, provider: 'demo' }
  return currentAccount
}

/** Forget the session connection (used by the app's disconnect button). */
export function disconnectWallet(): void {
  currentAccount = null
  activeProvider = 'pay'
}

export async function getDeviceId(): Promise<string | null> {
  try {
    return await requestDeviceIdentifier({ reason: 'Save your statement preferences on this device' })
  } catch {
    return null
  }
}

export function getLanguage(): string | undefined {
  return getHostLanguage()
}

export async function signMessage(
  message: string,
  signer?: string
): Promise<{ publicKey: string; signature: string } | null> {
  // Demo mode is read-only — never attempt to sign with a wallet we don't own.
  if (activeProvider === 'demo') {
    throw new Error('Demo mode is read-only — connect your wallet to sign receipts.')
  }
  // Hub-connected users sign via the Nimiq keyguard (Nimiq Signed Message scheme)
  if (activeProvider === 'hub') {
    try {
      const result = await getHub().signMessage({ appName: 'NimBooks', message, signer })
      if (!result || !result.signerPublicKey || !result.signature) return null
      return {
        publicKey: bytesToHex(result.signerPublicKey),
        signature: bytesToHex(result.signature),
      }
    } catch (e) {
      console.error('Hub signMessage failed:', e)
      throw new Error('Nimiq Hub signing failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  if (!nimiqProvider) return null
  try {
    const result = await nimiqProvider.sign(message)
    if (result && 'signature' in result) {
      return { publicKey: result.publicKey, signature: result.signature }
    }
    return null
  } catch (e) {
    console.error('Nimiq Pay sign failed:', e)
    throw new Error('Nimiq Pay signing failed: ' + (e instanceof Error ? e.message : String(e)))
  }
}

// --- Sending ---

export interface SendNimParams {
  recipient: string
  amountLuna: string // string in, so callers never do float maths on Luna
  memo?: string // plain UTF-8; hex-encoded here for the chain
  fee?: number
  from?: string // connected address — pins the sender in the Hub flow
}

export interface SendNimResult {
  /** Known immediately for Hub; recovered from history afterwards for Nimiq Pay. */
  hash: string | null
  serializedTx?: string
}

/** Can the active provider sign and send a transaction? */
export function canSend(): boolean {
  if (activeProvider === 'demo') return false
  if (activeProvider === 'hub') return true
  return !!nimiqProvider
}

export async function sendNim({
  recipient,
  amountLuna,
  memo,
  fee = 0,
  from,
}: SendNimParams): Promise<SendNimResult> {
  if (activeProvider === 'demo') {
    throw new Error('Demo mode is read-only — connect your wallet to send NIM.')
  }
  const value = Number(amountLuna)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid amount.')
  }
  const to = recipient.replace(/\s+/g, '').toUpperCase()

  if (activeProvider === 'hub') {
    // Nimiq Hub: the checkout flow signs and sends. `forceSender` keeps the
    // payment on the address the user connected with.
    const result = await getHub().checkout({
      appName: 'NimBooks',
      recipient: to,
      value,
      fee,
      ...(memo ? { extraData: new TextEncoder().encode(memo) } : {}),
      ...(from ? { sender: from.replace(/\s+/g, ''), forceSender: true } : {}),
    })
    if (!result || !('hash' in result)) {
      throw new Error('Nimiq Hub did not return a signed transaction.')
    }
    // Re-broadcast defensively: harmless when the Hub already sent it (same
    // hash ⇒ applied at most once), decisive when it only signed.
    try {
      await broadcastRawTransaction(result.serializedTx)
    } catch (e) {
      console.warn('Re-broadcast after Hub checkout skipped:', e)
    }
    return { hash: result.hash, serializedTx: result.serializedTx }
  }

  if (!nimiqProvider) throw new Error('No Nimiq wallet connected.')
  const res = memo
    ? await nimiqProvider.sendBasicTransactionWithData({ recipient: to, value, fee, data: encodeMemo(memo) })
    : await nimiqProvider.sendBasicTransaction({ recipient: to, value, fee })
  if (typeof res !== 'string') {
    const message = res && typeof res === 'object' && 'error' in res ? res.error?.message : null
    throw new Error(message || 'Transaction was rejected.')
  }
  // Nimiq Pay returns the serialized transaction, not a hash — the caller
  // recovers the hash from history (chain.findSentTx).
  return { hash: null, serializedTx: res }
}

// --- Staking ---

export type StakeResult = { ok: true; hash: string } | { ok: false; error: string }

/**
 * Can the active provider stake? Nimiq Pay only: the injected provider signs
 * and sends staking transactions itself, while Nimiq Hub's `signStaking` wants
 * a pre-serialized transaction (and therefore the @nimiq/core wasm bundle).
 */
export function canStake(): boolean {
  return activeProvider === 'pay'
}

/**
 * Delegate NIM to a validator through Nimiq Pay.
 *
 * @param delegation validator address for a first stake; `null` adds to the
 *   staker record that already exists (the delegation is fixed at creation).
 * @param amountNim amount in NIM — converted to Luna here (1 NIM = 1e5 Luna).
 *
 * Errors come back in the result rather than thrown: every failure here is a
 * message for the stake panel, not an exception for the app to survive.
 */
export async function stakeNim(delegation: string | null, amountNim: number): Promise<StakeResult> {
  if (activeProvider === 'demo') {
    return { ok: false, error: 'Demo mode is read-only — connect your wallet to stake.' }
  }
  if (activeProvider === 'hub') {
    return {
      ok: false,
      error: 'Staking needs the Nimiq Pay app — the browser login can read and sign, but not stake.',
    }
  }

  const value = Math.round(amountNim * 100000)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: 'Enter an amount above 0.' }
  }

  // Same as connectWallet: re-init if the provider handle was never obtained
  // (or the page reloaded inside Nimiq Pay without a fresh connect).
  if (!nimiqProvider) {
    try {
      nimiqProvider = await init({ timeout: 10000 })
    } catch (e) {
      console.warn('Nimiq provider unavailable for staking:', e)
    }
  }
  if (!nimiqProvider) {
    return { ok: false, error: 'No Nimiq wallet connected — open NimBooks inside Nimiq Pay to stake.' }
  }

  try {
    const res = delegation
      ? await nimiqProvider.sendNewStakerTransaction({
          delegation: delegation.replace(/\s+/g, '').toUpperCase(),
          value,
          fee: 0,
        })
      : await nimiqProvider.sendStakeTransaction({ value, fee: 0 })
    if (typeof res !== 'string') {
      const message = res && typeof res === 'object' && 'error' in res ? res.error?.message : null
      return { ok: false, error: message || 'The staking transaction was rejected.' }
    }
    // Nimiq Pay hands back the transaction it sent — a hash for the staking
    // calls, a serialized transaction for the basic ones. Either way it is the
    // receipt the user sees; the balance card is the real confirmation.
    return { ok: true, hash: res }
  } catch (e) {
    console.error('Nimiq Pay staking failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type UnstakeResult = { ok: true; hash: string } | { ok: false; error: string }

/**
 * Retire stake: moves it from "active" to "inactive" (cooldown). The stake
 * keeps no longer earning; once cooled down (inactiveBalance appears), the
 * same amount becomes withdrawable via `unstakeRemove`.
 *
 * Works only inside Nimiq Pay (same provider constraint as `stakeNim`).
 */
export async function unstakeRetire(amountNim: number): Promise<UnstakeResult> {
  if (activeProvider === 'demo') {
    return { ok: false, error: 'Demo mode is read-only — connect your wallet to unstake.' }
  }
  if (activeProvider === 'hub') {
    return {
      ok: false,
      error: 'Unstaking needs the Nimiq Pay app — the browser login can read and sign, but not unstake.',
    }
  }

  const value = Math.round(amountNim * 100000)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: 'Enter an amount above 0.' }
  }

  if (!nimiqProvider) {
    try {
      nimiqProvider = await init({ timeout: 10000 })
    } catch (e) {
      console.warn('Nimiq provider unavailable for unstaking:', e)
    }
  }
  if (!nimiqProvider) {
    return { ok: false, error: 'No Nimiq wallet connected — open NimBooks inside Nimiq Pay to unstake.' }
  }

  try {
    const res = await nimiqProvider.sendRetireStakeTransaction({ retireStake: value, fee: 0 })
    if (typeof res !== 'string') {
      const message = res && typeof res === 'object' && 'error' in res ? res.error?.message : null
      return { ok: false, error: message || 'The unstaking transaction was rejected.' }
    }
    return { ok: true, hash: res }
  } catch (e) {
    console.error('Nimiq Pay unstake (retire) failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Withdraw retired stake: moves it from "inactive" back to the basic balance.
 * Only the amount already shown as `retiredBalance` (after the cooldown)
 * can be removed.
 *
 * Works only inside Nimiq Pay.
 */
export async function unstakeRemove(amountNim: number): Promise<UnstakeResult> {
  if (activeProvider === 'demo') {
    return { ok: false, error: 'Demo mode is read-only — connect your wallet to withdraw.' }
  }
  if (activeProvider === 'hub') {
    return {
      ok: false,
      error: 'Withdrawing needs the Nimiq Pay app — the browser login can read and sign, but not withdraw.',
    }
  }

  const value = Math.round(amountNim * 100000)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: 'Enter an amount above 0.' }
  }

  if (!nimiqProvider) {
    try {
      nimiqProvider = await init({ timeout: 10000 })
    } catch (e) {
      console.warn('Nimiq provider unavailable for withdrawal:', e)
    }
  }
  if (!nimiqProvider) {
    return { ok: false, error: 'No Nimiq wallet connected — open NimBooks inside Nimiq Pay to withdraw.' }
  }

  try {
    const res = await nimiqProvider.sendRemoveStakeTransaction({ value, fee: 0 })
    if (typeof res !== 'string') {
      const message = res && typeof res === 'object' && 'error' in res ? res.error?.message : null
      return { ok: false, error: message || 'The withdrawal transaction was rejected.' }
    }
    return { ok: true, hash: res }
  } catch (e) {
    console.error('Nimiq Pay unstake (remove) failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function signReceipt(
  receipt: Omit<SignedReceipt, 'publicKey' | 'signature'>,
  signer?: string
): Promise<SignedReceipt | null> {
  // Single source of truth for the signed payload (receipt.ts canonicalPayload)
  const payload = canonicalPayload(receipt)
  const sig = await signMessage(payload, signer)
  if (!sig) return null
  return { ...receipt, publicKey: sig.publicKey, signature: sig.signature }
}

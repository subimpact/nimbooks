// Wallet adapter — provider-agnostic layer.
// Nimiq-specific calls live ONLY here, so the app can port to
// Telegram Mini Apps / Farcaster later by swapping this file.

import { init, requestDeviceIdentifier, getHostLanguage } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
// Only the default export is real at runtime: hub-api 1.15.0's types/index.d.ts
// re-exports RedirectRequestBehavior, but dist/HubApi.es.js exports nothing but
// `default`, so a named import type-checks and then fails to bundle. The
// behaviours are reachable as statics on the class instead.
import HubApi from '@nimiq/hub-api'
import type { SignedReceipt } from './receipt'
import { canonicalPayload } from './receipt'
import { broadcastRawTransaction, encodeMemo, getNimiqBlockNumber } from './chain'
import { isInNimiqPay, isMobileDevice } from './device'

export interface WalletAccount {
  nimiqAddress?: string
  evmAddress?: string
  provider: 'pay' | 'hub' | 'demo'
  /**
   * Whether the wallet host has established consensus. Only Nimiq Pay reports
   * it; `true` for Hub (a web wallet talks to a synced node) and `null` for
   * demo mode, where there is no provider to ask.
   */
  consensus?: boolean | null
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
  const account: WalletAccount = { provider: 'pay', consensus: null }
  activeProvider = 'pay'

  // Nimiq side
  try {
    nimiqProvider = await init({ timeout: 10000 })
    const accounts = await nimiqProvider.listAccounts()
    if (Array.isArray(accounts) && accounts.length > 0) {
      account.nimiqAddress = accounts[0]
    }
    // A Pay host that is still syncing answers `listAccounts` but has no chain
    // view yet, which reads to the user as an empty wallet. Ask, and let the
    // UI say so — never gate on it: NimBooks reads the chain over its own RPC,
    // so the data lands regardless.
    try {
      // Typed `Promise<boolean>`, but every other provider method can hand
      // back an ErrorResponse object instead — anything that isn't a boolean
      // means "didn't answer", which is `null`, not `false`.
      const established = await nimiqProvider.isConsensusEstablished()
      if (typeof established === 'boolean') account.consensus = established
    } catch (e) {
      console.warn('Consensus check unavailable:', e)
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

// --- Nimiq Hub redirect login (mobile browsers) ---

// Where the app was when it sent the user to the Hub. Parked in sessionStorage
// rather than carried on the return URL: the Hub answers on the URL fragment
// (@nimiq/rpc UrlRpcEncoder), and NimBooks routes on the fragment too, so a
// return URL that already has one comes back percent-mangled.
const HUB_ROUTE_KEY = 'nimbooks:hub-return-route'

let hubRedirectError: string | null = null

/**
 * Mobile browsers block the Hub's popup, so the Hub API prescribes a full-page
 * redirect there. Desktop keeps the popup — it never leaves the page.
 */
function shouldRedirectToHub(): boolean {
  return isMobileDevice() && !isInNimiqPay()
}

/**
 * Is this page load the return leg of a Hub redirect? Matches what
 * @nimiq/rpc looks for: the response in the fragment, or the `rpcId` search
 * param pointing at a stored one.
 */
export function isHubRedirectReturn(): boolean {
  if (typeof window === 'undefined') return false
  return (
    /(^|[#&])status=/.test(window.location.hash) ||
    new URLSearchParams(window.location.search).has('rpcId')
  )
}

/** Why the last redirect login failed, if it did — for the page to surface. */
export function getHubRedirectError(): string | null {
  return hubRedirectError
}

// Put back the route the redirect could not carry. Runs before the app
// renders, so the router reads the restored hash on its first pass.
function restoreHubRoute(): void {
  let parked: string | null = null
  try {
    parked = sessionStorage.getItem(HUB_ROUTE_KEY)
    sessionStorage.removeItem(HUB_ROUTE_KEY)
  } catch {
    /* no session storage — the user lands on the app root, still signed in */
  }
  if (!parked || !parked.startsWith('#/') || window.location.hash === parked) return
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${parked}`)
}

/**
 * Pick up a Hub login that came back by redirect, and restore the route.
 *
 * Must run BEFORE the app renders (see main.tsx): the response lives in the
 * URL fragment the router reads, and `on()` has to be registered before
 * `checkRedirectResponse()` dispatches it. Returns the account on success,
 * `null` when this load is not a return leg (or the login did not complete —
 * `getHubRedirectError()` then says why).
 */
export async function checkHubRedirect(): Promise<WalletAccount | null> {
  if (!isHubRedirectReturn()) return null
  const hub = getHub()
  // The Hub dispatches into these callbacks synchronously from within
  // checkRedirectResponse(); an object carries the result back out.
  const picked: { account?: WalletAccount } = {}
  hub.on(
    HubApi.RequestType.CHOOSE_ADDRESS,
    (result) => {
      if (!result?.address) {
        hubRedirectError = 'No address returned from Nimiq Hub.'
        return
      }
      activeProvider = 'hub'
      currentAccount = { nimiqAddress: result.address, provider: 'hub', consensus: true }
      picked.account = currentAccount
    },
    (error) => {
      hubRedirectError = error?.message || 'The Nimiq Hub login did not complete.'
    }
  )
  try {
    await hub.checkRedirectResponse()
  } catch (e) {
    console.warn('Hub redirect response could not be read:', e)
    hubRedirectError = e instanceof Error ? e.message : String(e)
  }
  restoreHubRoute()
  return picked.account ?? null
}

// Browser fallback: Nimiq Hub web-wallet login — a choose-address popup on
// desktop, a full-page redirect on mobile browsers, which block popups.
// Gives NIM address only — EVM assets stay a Nimiq Pay bonus.
export async function connectHub(): Promise<WalletAccount> {
  hubRedirectError = null
  if (shouldRedirectToHub()) {
    try {
      sessionStorage.setItem(HUB_ROUTE_KEY, window.location.hash)
    } catch {
      /* private mode — the user comes back to the app root, still signed in */
    }
    // Fragment-free return URL: the Hub appends its response to the fragment.
    // The behaviour type has to be named explicitly — HubApi only uses it in a
    // conditional return type, which TypeScript cannot infer an argument from,
    // so it would otherwise fall back to the popup default.
    await getHub().chooseAddress<typeof HubApi.BehaviorType.REDIRECT>(
      { appName: 'NimBooks' },
      new HubApi.RedirectRequestBehavior(`${window.location.origin}${window.location.pathname}`)
    )
    // The browser is on its way to the Hub and this frame is going away.
    // Resolving would flash "no address" over the outgoing page, so don't:
    // the answer arrives on the next page load, via checkHubRedirect().
    return new Promise<WalletAccount>(() => {})
  }
  const result = await getHub().chooseAddress({ appName: 'NimBooks' })
  if (!result?.address) throw new Error('No address returned from Nimiq Hub.')
  activeProvider = 'hub'
  currentAccount = { nimiqAddress: result.address, provider: 'hub', consensus: true }
  return currentAccount
}

// Read-only demo mode: sets the module-level provider so signing is
// correctly disabled (a demo address is not owned by the user).
export function connectDemoAccount(address: string): WalletAccount {
  activeProvider = 'demo'
  currentAccount = { nimiqAddress: address, provider: 'demo', consensus: null }
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

/**
 * Chain head, from the wallet host where there is one. Inside Nimiq Pay the
 * provider already tracks the head, so asking it costs no HTTP request — that
 * removes ~6 RPC calls/min from the 10s refresh and makes the unstake gate
 * (which compares `inactiveFrom + BLOCKS_PER_EPOCH` against this) read the same
 * height the wallet signs against.
 *
 * Falls back to the public RPC when the provider has no answer, and is the
 * only path for Hub/demo. `null` means "unknown" — callers keep the last
 * height rather than treating it as block 0.
 */
export async function getCurrentBlock(): Promise<number | null> {
  if (activeProvider === 'pay' && nimiqProvider) {
    try {
      const height = await nimiqProvider.getBlockNumber()
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) return height
    } catch (e) {
      console.warn('Provider block height unavailable — falling back to RPC:', e)
    }
  }
  try {
    const height = await getNimiqBlockNumber()
    return Number.isFinite(height) && height > 0 ? height : null
  } catch (e) {
    console.warn('Block number lookup failed:', e)
    return null
  }
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
 * Deactivate stake: moves it from "active" to "inactive" (cooldown). Takes
 * effect at the next election block (~12h). This is the FIRST step of
 * unstaking — the protocol only ever retires *inactive* stake, so sending a
 * retire against live stake is rejected and the transaction never mines.
 *
 * @param newActiveBalanceNim the active balance to LEAVE staked, not the
 *   amount being deactivated — `sendSetActiveStakeTransaction` sets an
 *   absolute balance (`newActiveBalance`), so a full unstake passes 0.
 *
 * Works only inside Nimiq Pay (same provider constraint as `stakeNim`).
 */
export async function unstakeDeactivate(newActiveBalanceNim: number): Promise<UnstakeResult> {
  if (activeProvider === 'demo') {
    return { ok: false, error: 'Demo mode is read-only — connect your wallet to unstake.' }
  }
  if (activeProvider === 'hub') {
    return {
      ok: false,
      error: 'Unstaking needs the Nimiq Pay app — the browser login can read and sign, but not unstake.',
    }
  }

  // 0 is the normal case (unstake everything), so only negatives are invalid.
  const value = Math.round(newActiveBalanceNim * 100000)
  if (!Number.isSafeInteger(value) || value < 0) {
    return { ok: false, error: 'Invalid unstake amount.' }
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
    const res = await nimiqProvider.sendSetActiveStakeTransaction({ newActiveBalance: value, fee: 0 })
    if (typeof res !== 'string') {
      const message = res && typeof res === 'object' && 'error' in res ? res.error?.message : null
      return { ok: false, error: message || 'The unstaking transaction was rejected.' }
    }
    return { ok: true, hash: res }
  } catch (e) {
    console.error('Nimiq Pay unstake (deactivate) failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Retire stake: moves it from "inactive" (cooled down) to "retired". Second
 * step of the unstake flow — valid only once the deactivation has taken
 * effect and the reporting window has passed; retired stake is then
 * withdrawable via `unstakeRemove`.
 *
 * @param amountNim a portion of the inactive balance (`newRetireStake` takes
 *   an amount, not a target balance).
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
 * Withdraw retired stake: moves it from "retired" back to the basic balance.
 * Only the amount already shown as `retiredBalance` (after the cooldown)
 * can be removed; `amountNim` is an amount, not a target balance.
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

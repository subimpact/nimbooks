// Wallet adapter — provider-agnostic layer.
// Nimiq-specific calls live ONLY here, so the app can port to
// Telegram Mini Apps / Farcaster later by swapping this file.

import { init, requestDeviceIdentifier, getHostLanguage } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import HubApi from '@nimiq/hub-api'
import type { SignedReceipt } from './receipt'
import { canonicalPayload } from './receipt'

export interface WalletAccount {
  nimiqAddress?: string
  evmAddress?: string
  provider: 'pay' | 'hub' | 'demo'
}

let nimiqProvider: NimiqProvider | null = null
let hubApi: HubApi | null = null
let activeProvider: 'pay' | 'hub' | 'demo' = 'pay'

export function isDemoMode(): boolean {
  return activeProvider === 'demo'
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

  return account
}

// Browser fallback: Nimiq Hub web-wallet login (choose-address popup).
// Gives NIM address only — EVM assets stay a Nimiq Pay bonus.
export async function connectHub(): Promise<WalletAccount> {
  const result = await getHub().chooseAddress({ appName: 'NimBooks' })
  if (!result?.address) throw new Error('No address returned from Nimiq Hub.')
  activeProvider = 'hub'
  return { nimiqAddress: result.address, provider: 'hub' }
}

// Read-only demo mode: sets the module-level provider so signing is
// correctly disabled (a demo address is not owned by the user).
export function connectDemoAccount(address: string): WalletAccount {
  activeProvider = 'demo'
  return { nimiqAddress: address, provider: 'demo' }
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

// Wallet adapter — provider-agnostic layer.
// Nimiq-specific calls live ONLY here, so the app can port to
// Telegram Mini Apps / Farcaster later by swapping this file.

import { init, requestDeviceIdentifier, getHostLanguage } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import type { SignedReceipt } from './receipt'
import { canonicalPayload } from './receipt'

export interface WalletAccount {
  nimiqAddress?: string
  evmAddress?: string
}

let nimiqProvider: NimiqProvider | null = null

export async function connectWallet(): Promise<WalletAccount> {
  const account: WalletAccount = {}

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

export async function getConsensus(): Promise<boolean> {
  if (!nimiqProvider) return false
  try {
    return await nimiqProvider.isConsensusEstablished()
  } catch {
    return false
  }
}

export async function getBlockNumber(): Promise<number | null> {
  if (!nimiqProvider) return null
  try {
    return await nimiqProvider.getBlockNumber()
  } catch {
    return null
  }
}

export async function signMessage(message: string): Promise<{ publicKey: string; signature: string } | null> {
  if (!nimiqProvider) return null
  try {
    const result = await nimiqProvider.sign(message)
    if (result && 'signature' in result) {
      return { publicKey: result.publicKey, signature: result.signature }
    }
    return null
  } catch {
    return null
  }
}

export async function signReceipt(receipt: Omit<SignedReceipt, 'publicKey' | 'signature'>): Promise<SignedReceipt | null> {
  // Single source of truth for the signed payload (receipt.ts canonicalPayload)
  const payload = canonicalPayload(receipt)
  const sig = await signMessage(payload)
  if (!sig) return null
  return { ...receipt, publicKey: sig.publicKey, signature: sig.signature }
}

export function verifyReceipt(receipt: SignedReceipt): boolean {
  // Client-side structural check; real verification happens on the
  // public verification page (server-side Ed25519 verify).
  return !!(
    receipt.txHash &&
    receipt.sender &&
    receipt.recipient &&
    receipt.amount &&
    receipt.signature &&
    receipt.publicKey
  )
}

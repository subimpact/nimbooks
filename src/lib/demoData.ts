// Demo-mode story data — baked into the sample wallet so the Receipts and
// Request tabs show real, verifiable artifacts on ANY device, no console
// seed needed. Both artifacts are REAL:
//
//   Receipt: 20 NIM "Landing page deposit" — signed by the owner's key,
//            verify link https://nimbook.s.gy/TenQls (✅ Verified)
//   Invoice: 50 NIM "Acme Corp - Invoice #12" — paid on-chain,
//            tx 3f77f5cfaa65…, ref nimbooks:invoice:4u010r140g,
//            share link https://nimbook.s.gy/i65lPn (PAID via chain check)
//
// Seeding is an idempotent upsert per address: reconnecting demo mode
// restores the artifacts if they were deleted, and never duplicates or
// clobbers anything the user already has for the same address.

import type { SignedReceipt } from './receipt'
import type { StoredInvoice } from './invoice'

export const DEMO_RECEIPT: SignedReceipt = {
  app: 'nimbooks',
  v: 1,
  txHash: 'daf8b248fe35d9d070b43786c275a3f6d93d11903f2ea2ddd218a99c58d1ef3e',
  sender: 'NQ27 NCB1 3CYU 9P4L EM2V D7L2 28QE 36PA EXB1',
  recipient: 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX',
  amount: '2000000', // 20 NIM in Luna
  asset: 'NIM',
  timestamp: 1789005449, // seconds
  memo: '4c616e64696e672070616765206465706f736974', // hex: "Landing page deposit"
  publicKey: '148f08b10c27996da764348b7d00351b5a17c04fdc01a758ea1998641ef3eca0',
  signature:
    'eb0a6a938eca0e35bb902423b22fb4b0c4cb95b5bfc12cdb8272947600366bca5d261892cff643e6f0186dc29e68d0b07f5439dbcf3e336d65ce653ce7819401',
}

export const DEMO_INVOICE: StoredInvoice = {
  app: 'nimbooks',
  v: 1,
  id: '4u010r140g',
  payee: 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX',
  amountNim: '5000000', // 50 NIM in Luna
  memo: 'Acme Corp - Invoice #12',
  createdAt: 1789005506154, // ms — canonical from the share link
  role: 'payee',
  paid: true,
  paidTxHash: '3f77f5cfaa6576840483c2cff3dd112d1d2d6c3e5fd8fd0d2b4c7b1b7c8236b1',
  paidAt: 1789005604873, // ms — the on-chain timestamp
}

function upsert<T extends { txHash?: string; id?: string }>(
  key: string,
  item: T,
  idKey: 'txHash' | 'id'
): void {
  try {
    let arr: unknown[] = []
    try {
      arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    } catch {
      /* fresh */
    }
    if (!Array.isArray(arr)) arr = []
    const idx = arr.findIndex(
      (x) => x && typeof x === 'object' && (x as Record<string, unknown>)[idKey] === item[idKey]
    )
    if (idx >= 0) arr[idx] = item
    else arr.unshift(item)
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {
    /* storage full — demo data stays in memory only */
  }
}

/** Ensure the demo artifacts exist for this address (idempotent). */
export function seedDemoData(address: string): void {
  upsert(`nimbooks:receipts:${address}`, DEMO_RECEIPT, 'txHash')
  upsert(`nimbooks:invoices:${address}`, DEMO_INVOICE, 'id')
}

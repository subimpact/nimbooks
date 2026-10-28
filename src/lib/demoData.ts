// The sample wallet (demo mode): a public mainnet address the app reads from
// the chain, read-only. Its numbers are real chain state, not props.
//
// NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR: a live Nimiq Pay wallet staking with ImpactZero, so the demo
// shows Pay's internal transfers (HTLC hops), the Hide internal switch and
// staking rewards on real history. Keys are held by the owner.
//
// Demo story data, baked in so the Receipts and Request tabs show real,
// verifiable artifacts on ANY device. Both kinds are REAL (added 2026-10-28,
// signed in Nimiq Pay by the owner of NQ82):
//
//   Receipts: four, each signed by NQ82's key and checked with the app's own
//             verifyReceiptFull (signature, signer bound, tx confirmed on chain).
//   Request:  10 NIM "Coffee split" (1s204x1h0b), paid on chain by tx
//             3ddfe0c3b7e9..., ref nimbooks:invoice:1s204x1h0b.
//
// Seeding is an idempotent upsert per address: reconnecting demo mode restores
// the artifacts if they were deleted, and never duplicates or clobbers
// anything else stored for the same address.
//
// Until 2026-10-27 the sample wallet was NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX; its receipt and request
// belonged to that address and are not seeded here.

import type { SignedReceipt } from './receipt'
import type { StoredInvoice } from './invoice'

export const DEMO_WALLET_ADDRESS = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'

/** Earlier sample-wallet addresses, still excluded from public wallet counts. */
export const FORMER_DEMO_WALLET_ADDRESSES = ['NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX']

/** Newest first, the order the Receipts tab lists them in. */
export const DEMO_RECEIPTS: SignedReceipt[] = [
  // 10 NIM in from NQ27 NCB1, paying the "Coffee split" request below
  {
    app: 'nimbooks',
    v: 1,
    txHash: '3ddfe0c3b7e964f6c75d5f1602611c790afba5f0710ad9dbfec8a9e9cf911896',
    sender: 'NQ27 NCB1 3CYU 9P4L EM2V D7L2 28QE 36PA EXB1',
    recipient: 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR',
    amount: '1000000',
    asset: 'NIM',
    timestamp: 1789155491,
    memo: '6e696d626f6f6b733a696e766f6963653a31733230347831683062',
    publicKey: 'ddacc667ff4c0e616a2d841b128d36c85bd0b62ee316355f55241d7335d7d3cb',
    signature: '3cffbb01ef1efd1e2f104b62d00838ec3e345bfccd6f913a76d9e70b33b8e42f73c3247d72de8e71dc7580031ddf671610723651b7431f990a80207046ff1308',
  },
  // 510.10165 NIM out to NQ65 Y2FH (a Nimiq Pay contract)
  {
    app: 'nimbooks',
    v: 1,
    txHash: 'b8565744bd27ed60649036a950691840101273f7cb16cc03bd48df03281fc355',
    sender: 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR',
    recipient: 'NQ65 Y2FH 00CQ CUV9 87CF V70G Q682 U7E6 SRJQ',
    amount: '51010165',
    asset: 'NIM',
    timestamp: 1789090734,
    memo: '343fcb7b9c015b50d4ef06a526904eb72da9ba99a70b9e44a448b5183ac4e186cd749d3d889fff8401000000000000000000000000000000000000000000000000000000000000000001000001a0d6371402',
    publicKey: 'ddacc667ff4c0e616a2d841b128d36c85bd0b62ee316355f55241d7335d7d3cb',
    signature: '1ac8589dc389f4de6a812bf171e8e2311cc85c2d1b3523f7ae3e29fbd66a715b0124e5c62944c3116bc03f8ccce00f86ccebc377db5ba36254f677c3cbc4aa06',
  },
  // 9,910.00052 NIM out to NQ64 CNFM (a Nimiq Pay contract)
  {
    app: 'nimbooks',
    v: 1,
    txHash: 'b1a17b3cd3873a05235fa78f0aedc1a95340f9b8ef70c02610d2d373c13befcc',
    sender: 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR',
    recipient: 'NQ64 CNFM 19SU LHLT K5EN RLMG 8MMP 2H0S 02KK',
    amount: '991000052',
    asset: 'NIM',
    timestamp: 1788924622,
    memo: '343fcb7b9c015b50d4ef06a526904eb72da9ba99a70b9e44a448b5183ac4e186cd749d3d889fff8401000000000000000000000000000000000000000000000000000000000000000001000001a0cc50792f',
    publicKey: 'ddacc667ff4c0e616a2d841b128d36c85bd0b62ee316355f55241d7335d7d3cb',
    signature: '23008a8e9c6a61f0879b9ed1e2bd139bf53d553db6db4afac3d47b05db1c3d59406ff8ec4440693dcd094115c54b8c473c8dfcecda4a1bbb2b182ba96da35700',
  },
  // 7,910.00052 NIM in from NQ90 U4J7 (a Nimiq Pay contract paying out)
  {
    app: 'nimbooks',
    v: 1,
    txHash: '7b70eb25724e88f37f28885925930c7615066cc08f80af887f6ae4df85b8d62b',
    sender: 'NQ90 U4J7 E4FP J4E2 ERQK KQ9R 9J0L 5X5R KMA9',
    recipient: 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR',
    amount: '791000052',
    asset: 'NIM',
    timestamp: 1788924620,
    publicKey: 'ddacc667ff4c0e616a2d841b128d36c85bd0b62ee316355f55241d7335d7d3cb',
    signature: '4c6c7014458ddab871e2ec8f65fdc339cf998428b054c072d49273f3e9e01290567f1911d76ade72321e7b6151cb26a6005089712eb2c5bc3884c5239ff50508',
  },
]

export const DEMO_INVOICE: StoredInvoice = {
  app: 'nimbooks',
  v: 1,
  id: '1s204x1h0b',
  payee: 'NQ826GYUNXUU05DM1M7F0SJJD42ENUNSKELR',
  amountNim: '1000000', // 10 NIM in Luna (the share link's field name)
  createdAt: 1789155409754, // ms, canonical from the share link
  memo: 'Coffee split',
  role: 'payee',
  paid: true,
  paidTxHash: '3ddfe0c3b7e964f6c75d5f1602611c790afba5f0710ad9dbfec8a9e9cf911896',
  paidAt: 1789155491124, // ms, the on-chain timestamp
}

function upsert<T extends { txHash?: string; id?: string }>(key: string, items: T[], idKey: 'txHash' | 'id'): void {
  try {
    let arr: unknown[] = []
    try {
      arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    } catch {
      /* fresh */
    }
    if (!Array.isArray(arr)) arr = []
    // Walk oldest first and unshift, so the list ends newest first.
    for (const item of [...items].reverse()) {
      const idx = arr.findIndex(
        (x) => x && typeof x === 'object' && (x as Record<string, unknown>)[idKey] === item[idKey]
      )
      if (idx >= 0) arr[idx] = item
      else arr.unshift(item)
    }
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {
    /* storage full: demo data stays out, the tabs show their empty state */
  }
}

/** Ensure the demo artifacts exist for this address (idempotent). */
export function seedDemoData(address: string): void {
  upsert(`nimbooks:receipts:${address}`, DEMO_RECEIPTS, 'txHash')
  upsert(`nimbooks:invoices:${address}`, [DEMO_INVOICE], 'id')
}

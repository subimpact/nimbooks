// NimBooks demo seed — run this in the browser console on ANY device
// (or via the app's own demo mode) to populate the Receipts + Request tabs
// with real, verifiable data. Device-independent: no original signing device
// needed. The receipt signature is real (verify link from the owner's wallet);
// the invoice is chain-checked (50 NIM paid on-chain, tx 3f77f5cfaa65…).
//
// Usage: open https://nimbooks.subimpact.net/ → DevTools console → paste →
// Enter → reload the page → tap "Try with a sample wallet" (demo mode).
// The Receipts tab shows the 20 NIM "Landing page deposit" receipt;
// the Request tab shows "Acme Corp - Invoice #12" marked PAID.

(() => {
  const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX' // spaced form — matches demo mode + Pay

  // --- 1. Signed receipt (20 NIM, "Landing page deposit") ---
  // Source: https://nimbook.s.gy/TenQls → #/verify/… (signed by owner's key)
  const receipt = {
    app: 'nimbooks',
    v: 1,
    txHash: 'daf8b248fe35d9d070b43786c275a3f6d93d11903f2ea2ddd218a99c58d1ef3e',
    sender: 'NQ27 NCB1 3CYU 9P4L EM2V D7L2 28QE 36PA EXB1',
    recipient: ADDR,
    amount: '2000000', // 20 NIM in Luna
    asset: 'NIM',
    timestamp: 1789005449, // seconds
    memo: '4c616e64696e672070616765206465706f736974', // hex: "Landing page deposit"
    publicKey: '148f08b10c27996da764348b7d00351b5a17c04fdc01a758ea1998641ef3eca0',
    signature: 'eb0a6a938eca0e35bb902423b22fb4b0c4cb95b5bfc12cdb8272947600366bca5d261892cff643e6f0186dc29e68d0b07f5439dbcf3e336d65ce653ce7819401',
  }

  // --- 2. Payment request (50 NIM, Acme Corp - Invoice #12) — PAID ---
  // On-chain: tx 3f77f5cfaa6576840483c2cff3dd112d1d2d6c3e5fd8fd0d2b4c7b1b7c8236b1
  // from NQ64 CNFM 19SU LHLT K5EN RLMG 8MMP 2H0S 02KK → NQ43, 50 NIM, exec OK
  const invoice = {
    app: 'nimbooks',
    v: 1,
    id: '4u010r140g',
    payee: ADDR,
    amountNim: '5000000', // 50 NIM in Luna
    memo: 'Acme Corp - Invoice #12',
    createdAt: 1789005506154, // ms — canonical from the share link (nimbook.s.gy/i65lPn)
    role: 'payee',
    paid: true,
    paidTxHash: '3f77f5cfaa6576840483c2cff3dd112d1d2d6c3e5fd8fd0d2b4c7b1b7c8236b1',
    paidAt: 1789005604873, // ms — the on-chain timestamp
  }

  const receiptsKey = `nimbooks:receipts:${ADDR}`
  const invoicesKey = `nimbooks:invoices:${ADDR}`

  // Upsert: replace any existing entry with the same id/txHash (so a stale
  // memo-less copy from an earlier session is overwritten, not skipped).
  const upsert = (key, item) => {
    let arr = []
    try { arr = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* fresh */ }
    if (!Array.isArray(arr)) arr = []
    const idKey = item.txHash ? 'txHash' : 'id'
    const idx = arr.findIndex((x) => x && x[idKey] === item[idKey])
    if (idx >= 0) arr[idx] = item
    else arr.unshift(item)
    localStorage.setItem(key, JSON.stringify(arr))
  }

  upsert(receiptsKey, receipt)
  upsert(invoicesKey, invoice)

  console.log('✅ NimBooks demo seed applied (upsert).')
  console.log('   Receipts:', localStorage.getItem(receiptsKey)?.length, 'bytes')
  console.log('   Invoices:', localStorage.getItem(invoicesKey)?.length, 'bytes')
  console.log('   Reload the page, then tap "Try with a sample wallet".')
})()

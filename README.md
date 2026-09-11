# 📒 NimBooks

**The books for your Nimiq wallet — and the world's first in-Pay staking.**

NimBooks is a Nimiq Pay Mini App that answers the question every payments wallet user eventually asks: *"What do I actually have, and what happened to it?"*

It shows your NIM balance and transaction history with fiat values, lets you **stake and unstake** with a validator picker — **including staking NIM that's still in transit through HTLC swap contracts, a world first for Nimiq Pay mini apps** — exports CSV statements for tax records, issues **payment requests (invoices)** that settle on-chain and reconcile themselves, and lets you create **cryptographically signed proof-of-payment receipts** that anyone can verify on a public page.

**Live:** https://nimbooks.subimpact.net (legacy: https://nimbooks.pages.dev redirects)

## Why

91 submissions across two Nimiq Mini Apps Competition cycles built apps for *moving* money. Zero built apps for *accounting for* it. NimBooks fills that gap — it's the accounting and decision-support layer for Nimiq Pay.

## Features

- **NIM balance + full transaction history** with fiat conversion in **37 currencies** (currency switcher, remembered per device)
- **Staking** — stake and unstake with a validator picker (live APY estimates, pool fee and reliability), reward rollups in history, and an HTLC-aware balance breakdown (Available / Locked in swaps / Staked / Unstaking / Ready to withdraw / Vesting)
- **Payment requests (invoices)** — amount + memo + optional expiry → shareable link and QR; the payer settles it in-app, and the tagged transaction (`nimbooks:invoice:<id>`) marks the request paid automatically when it lands on-chain
- **EVM balances** — native + USDT across Polygon, Base, Arbitrum, Optimism, Ethereum (via public RPCs)
- **Signed receipts** — `signMessage` attestation over `{txHash, amount, memo, timestamp}` → shareable verification link
- **Public verification page** — Ed25519 signature check + signer-address binding + on-chain cross-check by transaction hash
- **CSV export** — accountant-ready statement downloads (formula-injection safe, UTF-8 BOM); statements aggregate daily CoinGecko UTC closes
- **Download via link** — Nimiq Pay's WebView can't save files, so exports there go through a gzip-in-URL Pages Function that serves the CSV with `Content-Disposition`, plus QR and clipboard fallbacks
- **Account-scoped receipt storage** — receipts are partitioned per wallet address

## Tech

- React 19 + TypeScript + Vite
- `@nimiq/mini-app-sdk` (v0.1.0) — `init()`, `listAccounts()`, `sign()`, `sendBasicTransactionWithData()`, `requestDeviceIdentifier()`
- `@nimiq/hub-api` — the desktop path: sign-in, checkout and staking transactions when there's no Nimiq Pay provider to talk to
- `viem` — multi-chain EVM balance reads via public RPCs (no chain-switching needed); lazy-loaded via dynamic `import()`, so it code-splits out of the initial bundle and only downloads when EVM balances are read
- Nimiq public RPC (`rpc.nimiqwatch.com`) — balance + transaction history + staker records
- Nimiq validators API — validator list, pool fees and reliability scores (cached 10 min)
- CoinGecko API — fiat rates (cached in localStorage, 5 min TTL) and daily UTC closes for statements (12 h TTL)
- Cloudflare Pages Function (`functions/export/[[file]].ts`) — serves an export link's gzipped CSV back with `Content-Disposition`, so Nimiq Pay users get a real file
- WebCrypto Ed25519 + `blakejs` — receipt signing/verification and Nimiq address derivation

## Architecture

```
src/
├── lib/
│   ├── wallet.ts        # Wallet adapter — Nimiq provider calls ONLY here (portable to Telegram/Farcaster)
│   ├── chain.ts         # Nimiq RPC + fiat rates + validator registry + tx classification
│   ├── evm.ts           # EVM balance reads (viem) — dynamically imported, own bundle chunk
│   ├── stakingEvents.ts # Staking reward rollups synthesized into the history feed
│   ├── statement.ts     # Tax-year statement — daily aggregation against CoinGecko UTC closes
│   ├── downloadLink.ts  # gzip-in-URL export links for Nimiq Pay's WebView
│   ├── receipt.ts       # Receipt encode/decode + Ed25519 verify + signer binding + on-chain cross-check
│   ├── invoice.ts       # Payment requests — exact Luna maths, link encoding, per-account storage
│   ├── qr.ts            # Dependency-free QR encoder (byte mode, ECC L/M, versions 1–40)
│   ├── shorten.ts       # Client half of the share-link shortener — never throws, falls back to the long URL
│   ├── stakingLog.ts    # Local log of staking actions the public tx index doesn't return
│   ├── backup.ts        # Export/restore of everything the app keeps in localStorage
│   ├── demoData.ts      # Demo-mode story: a real signed receipt and a chain-paid invoice
│   ├── changelog.ts     # Release notes + the version label shown in the badge
│   ├── device.ts        # One-path-per-device detection (Nimiq Pay on mobile, Hub on desktop)
│   ├── dialogFocus.ts   # Focus into and back out of every aria-modal dialog
│   ├── theme.ts         # Light/dark preference
│   └── global.d.ts      # window.ethereum types (Nimiq Pay's own provider comes typed with the SDK)
├── App.tsx              # Main mini app (Overview / History / Receipts / Request / Export)
├── Analytics.tsx        # Dependency-free SVG charts — daily net flow + balance trajectory, with drilldowns
├── HeroBackground.tsx   # The living hexagon field behind the app
├── DetailSheet.tsx      # Shared bottom-sheet shell for the Analytics drilldowns
├── Confetti.tsx         # Celebration burst for a confirmed send or stake
├── QrCode.tsx           # SVG renderer for lib/qr.ts
├── InfoIcon.tsx         # Tap-to-explain icon used across the Overview cards
├── InvoicePage.tsx      # Public payment-request page (#/invoice/<request>)
└── VerifyPage.tsx       # Public receipt verification page (#/verify/<receipt>)

functions/
├── api/shorten.ts       # Pages Function — short.io share links (the API key stays server-side)
└── export/[[file]].ts   # Pages Function — decodes an export link and serves the CSV as a download

public/
└── _headers             # Content-Security-Policy (frame-ancestors left open for Pay's WebView)
```

The wallet layer is behind an adapter interface — swapping Nimiq Pay for Telegram Mini Apps later means replacing one file.

## Receipt verification

Any receipt link looks like `https://nimbooks.subimpact.net/#/verify/<base64url-receipt>`. The page:

1. Decodes the receipt payload
2. Verifies the Ed25519 signature against the embedded public key
3. **Derives the Nimiq address from the public key** (Blake2b-256 → base32 + IBAN checksum) and requires it to match the sender or recipient — this prevents forgery
4. Cross-checks the transaction on the Nimiq blockchain by hash (sender/recipient/amount/memo)

Three outcomes: ✅ verified, ❌ not verified, ⏳ inconclusive (chain lookup unavailable).

## Payment requests

A request link looks like `https://nimbooks.subimpact.net/#/invoice/<base64url-request>` — the whole invoice (payee, amount in Luna, memo, created/expiry) rides in the URL fragment, so nothing is ever stored on a server. The page renders read-only before any wallet is connected; paying needs a wallet:

- **Nimiq Pay** — `sendBasicTransactionWithData()`; the transaction hash is recovered from the sender's history
- **Nimiq Hub** — checkout flow, with a defensive re-broadcast of the signed transaction

The payment carries `nimbooks:invoice:<id>` as transaction data. When that transaction shows up in the payee's History, NimBooks marks the request paid and links the hash — no polling service, no backend. Requests are stored per account (`nimbooks:invoices:<address>`, newest 50).

## Run locally

```bash
npm install
npm run dev
```

In a desktop browser you get the Nimiq Hub sign-in path, or "Try with a sample wallet" for a read-only tour. The Nimiq Pay provider only injects inside the app itself — for the full experience, deploy and open via `nimiqpay://miniapp?url=https://nimbooks.subimpact.net`.

## Build

```bash
npm run build   # outputs to dist/
```

## License

MIT — see [LICENSE](LICENSE).

---

Built for the Nimiq Mini Apps Competition. Pura Vida 🌴

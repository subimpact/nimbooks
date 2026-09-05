# 📒 NimBooks

**The books for your Nimiq wallet.**

NimBooks is a Nimiq Pay Mini App that answers the question every payments wallet user eventually asks: *"What do I actually have, and what happened to it?"*

It shows your NIM balance and transaction history with fiat values, exports CSV statements for tax records, and lets you issue **cryptographically signed proof-of-payment receipts** that anyone can verify on a public page.

**Live:** https://nimbooks.pages.dev

## Why

91 submissions across two Nimiq Mini Apps Competition cycles built apps for *moving* money. Zero built apps for *accounting for* it. NimBooks fills that gap — it's the accounting and decision-support layer for Nimiq Pay.

## Features

- **NIM balance + full transaction history** with fiat conversion (USD)
- **EVM balances** — native + USDT across Polygon, Base, Arbitrum, Optimism, Ethereum (via public RPCs)
- **Signed receipts** — `signMessage` attestation over `{txHash, amount, memo, timestamp}` → shareable verification link
- **Public verification page** — Ed25519 signature check + signer-address binding + on-chain cross-check by transaction hash
- **CSV export** — accountant-ready statement downloads (formula-injection safe, UTF-8 BOM)
- **Account-scoped receipt storage** — receipts are partitioned per wallet address

## Tech

- React 19 + TypeScript + Vite
- `@nimiq/mini-app-sdk` (v0.1.0) — `init()`, `listAccounts()`, `sign()`, `requestDeviceIdentifier()`
- `viem` — multi-chain EVM balance reads via public RPCs (no chain-switching needed)
- Nimiq public RPC (`rpc.nimiqwatch.com`) — balance + transaction history
- CoinGecko API — fiat rates (cached in localStorage, 5 min TTL)
- WebCrypto Ed25519 + `blakejs` — receipt signing/verification and Nimiq address derivation

## Architecture

```
src/
├── lib/
│   ├── wallet.ts    # Wallet adapter — Nimiq provider calls ONLY here (portable to Telegram/Farcaster)
│   ├── chain.ts     # Nimiq RPC + EVM balance (viem) + fiat rate clients
│   ├── receipt.ts   # Receipt encode/decode + Ed25519 verify + signer binding + on-chain cross-check
│   └── global.d.ts  # window.ethereum / window.nimiqPay types
├── App.tsx          # Main mini app (Overview / History / Receipts / Export)
└── VerifyPage.tsx   # Public receipt verification page (#/verify/<receipt>)
```

The wallet layer is behind an adapter interface — swapping Nimiq Pay for Telegram Mini Apps later means replacing one file.

## Receipt verification

Any receipt link looks like `https://nimbooks.pages.dev/#/verify/<base64url-receipt>`. The page:

1. Decodes the receipt payload
2. Verifies the Ed25519 signature against the embedded public key
3. **Derives the Nimiq address from the public key** (Blake2b-256 → base32 + IBAN checksum) and requires it to match the sender or recipient — this prevents forgery
4. Cross-checks the transaction on the Nimiq blockchain by hash (sender/recipient/amount/memo)

Three outcomes: ✅ verified, ❌ not verified, ⏳ inconclusive (chain lookup unavailable).

## Run locally

```bash
npm install
npm run dev
```

Open in a browser for the connect screen (providers only inject inside Nimiq Pay). For the full experience, deploy and open via `nimiqpay://miniapp?url=https://nimbooks.pages.dev`.

## Build

```bash
npm run build   # outputs to dist/
```

## License

MIT — see [LICENSE](LICENSE).

---

Built for the Nimiq Mini Apps Competition. Pura Vida 🌴

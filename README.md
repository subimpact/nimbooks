# 📒 NimBooks

**The books for your Nimiq wallet.**

NimBooks is a Nimiq Pay Mini App that answers the question every payments wallet user eventually asks: *"What do I actually have, and what happened to it?"*

It unifies your NIM and EVM balances, shows your full transaction history with fiat values in your own currency, exports CSV statements for tax records, and lets you issue **cryptographically signed proof-of-payment receipts** that anyone can verify on a public page.

## Why

91 submissions across two Nimiq Mini Apps Competition cycles built apps for *moving* money. Zero built apps for *accounting for* it. NimBooks fills that gap — it's the accounting and decision-support layer for Nimiq Pay, spanning both the native Nimiq provider and the EVM provider.

## Features

- **Unified balances** — NIM + USDT on Polygon, Base, Arbitrum, Optimism, Ethereum in one screen
- **Transaction history** — full NIM history with fiat conversion in the user's preferred currency
- **Signed receipts** — `signMessage` attestation over `{txHash, amount, memo, timestamp}` → shareable verification link
- **Public verification page** — Ed25519 signature check + on-chain cross-check via Nimiq RPC
- **CSV export** — accountant-ready statement downloads
- **Device-scoped preferences** — no account system needed (pseudonymous device identifier)
- **i18n-ready** — uses `nimiqPay.language` for localization

## Tech

- React 19 + TypeScript + Vite
- `@nimiq/mini-app-sdk` (v0.1.0) — `init()`, `listAccounts()`, `sign()`, `requestDeviceIdentifier()`
- `window.ethereum` (EIP-1193) — multi-chain EVM balances
- Nimiq public RPC (`rpc.nimiqwatch.com`) — balance + transaction history
- CoinGecko API — fiat rates (cached 5 min)
- WebCrypto Ed25519 — receipt signing/verification (zero extra deps)

## Architecture

```
src/
├── lib/
│   ├── wallet.ts    # Wallet adapter — Nimiq provider calls ONLY here (portable to Telegram/Farcaster)
│   ├── chain.ts     # Nimiq RPC + EVM balance + fiat rate clients
│   ├── receipt.ts   # Receipt encode/decode + Ed25519 verify + on-chain cross-check
│   └── global.d.ts  # window.ethereum / window.nimiqPay types
├── App.tsx          # Main mini app (Overview / History / Receipts / Export)
└── VerifyPage.tsx   # Public receipt verification page (#/verify/<receipt>)
```

The wallet layer is behind an adapter interface — swapping Nimiq Pay for Telegram Mini Apps later means replacing one file.

## Run locally

```bash
npm install
npm run dev
```

Open in a browser for the connect screen (providers only inject inside Nimiq Pay). For the full experience, deploy and open via `nimiqpay://miniapp?url=<your-domain>`.

## Build

```bash
npm run build   # outputs to dist/
```

## Verify a receipt

Any receipt link looks like `https://<your-domain>/#/verify/<base64-receipt>`. The page:

1. Decodes the receipt payload
2. Verifies the Ed25519 signature against the embedded public key
3. Cross-checks the transaction on the Nimiq blockchain (sender/recipient/amount match)

## License

MIT — see [LICENSE](LICENSE).

---

Built for the Nimiq Mini Apps Competition. Pura Vida 🌴

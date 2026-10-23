# NimBooks privacy

_Last updated 22 October 2026 (v1.37.0)._

The short version:
- **No account and no keys.** Your wallet signs everything; NimBooks never sees a private key.
- **Your books stay on your device.** Receipts, payment requests, cashlink keys and settings live in your browser or Nimiq Pay.
- **The server keeps very little:** a wallet count you can opt out of, CSV short links for 48 hours, and a cache of public donations.
- **Every server function is open source** in this repository, so you can check all of this.

The Nimiq chain itself is public. Anyone can look up the balances and
transactions NimBooks shows you; NimBooks just reads them for you.

## On your device

_Last updated 21 October 2026 (v1.33.0)._

Stored in browser storage (`localStorage`) under `nimbooks:` keys, for each
address you connect:

| What | Key |
|---|---|
| Signed receipts | `nimbooks:receipts:<address>` |
| Payment requests | `nimbooks:invoices:<address>` |
| Staking actions the public index doesn't list | `nimbooks:stakingLog:<address>` |
| Cashlinks you created, **including their keys** | `nimbooks.cashlinks.v1` |
| An unstake you started, until the chain finishes it | `nimbooks:pendingUnstake:<address>` |
| Portfolio address list, currency, theme, session | `nimbooks:portfolio:addresses`, `nimbooks:currency`, … |
| Nimiq Pay's device ID, so your currency is remembered per device | `nimbooks:deviceId`, `nimbooks:d:<id>:currency` |
| Caches (history, prices, validators, rewards) | `nimbooks:txs:*`, `nimbooks:rates`, `nimbooks:fx`, … |
| Nimiq Pay's settled payment contracts, so their history loads once | `nimbooks:htlc-archive:<address>` |
| Your counting choice and backup reminder | `nimbooks:connect-count`, `nimbooks:backup-state` |
| When you last visited, so the Earn card can show your rewards since then | `nimbooks:last-visit:<address>` |
| Payments you declined to stake ("Not now"), so they are never offered twice | `nimbooks:stake-nudge-dismissed:<address>` |
| Your choice of the New look (beta) or the classic look | `nimbooks:ui` |
| Whether the beta Earn card is collapsed (New look beta only) | `nimbooks:earn-collapsed` |
| Analytics chart choices (balance line or daily bars, hide internal transfers) | `nimbooks:analytics:chart`, `nimbooks:analytics:filterHtlc` |

The device ID comes from Nimiq Pay and never leaves your device. Caches,
including the payment-contract archive, are left out of backups because they
rebuild from the public chain. The last-visit marker and the dismissed-stake
list are preferences, so a backup carries them; in demo mode the sample wallet
keeps both per tab (sessionStorage) and never writes them to localStorage.
Neither key is anything but a timestamp or list of transaction hashes, and
neither ever leaves your device.

None of this is sent anywhere. It also means **clearing site data, or signing
out of Nimiq Pay, deletes it.** Export → Backup & restore gives you a copy to
keep. A backup includes cashlink keys, so store it as carefully as a wallet.

Receipt and payment-request links carry their own data inside the link, so
links you already shared keep working even if your device copy is gone.

## On NimBooks' server

NimBooks runs on Cloudflare Pages with a small key-value store (Workers KV).
It keeps exactly this:

**1. The public wallet count, only if you agree.** The connect screen says that
NimBooks counts wallets and offers "Don't count me". Wallets that connected
before this notice existed are asked once in the app. Nothing is sent for your
wallet until you've seen the notice and not opted out. For each counted
wallet the server keeps:
- a SHA-256 hash of the address (a one-way fingerprint, used as the key),
- a masked address (first and last four characters),
- the wallet app (Nimiq Pay or Nimiq Hub) and the device type (Pay, mobile, desktop),
- when it first and last connected, and how many visits.

Each counted visit also sends the builder a chat alert on NimBooks' own Matrix
server (`matrix.subimpact.net`) with the masked address, wallet app and device
type. Running totals (wallets; visits via Pay and via Hub; sample-wallet
sessions) are public at `/api/stats`.

The hash is pseudonymous, not anonymous: someone who already knows an address
could compute its hash. **"Don't count me" in the app (the banner, or Export →
Backup & restore) deletes your wallet's record** and recounts. Visit totals
stay, since they are plain numbers with no address attached. The sample
wallet holds no one's data and is always counted, separately, as demo.

**2. CSV short links, for 48 hours.** If you ask for a short download link
for an export (mainly inside Nimiq Pay, which can't save files), the gzipped
CSV is stored under a random link and deleted automatically after 48 hours.
The long download link stores nothing: the file travels inside the URL.

**3. A donations summary.** The landing page lists donations to the public
support address. Supporter names appear only for donors who asked to be
named; addresses are never published or logged, and the summary is cached.

That is all. There is no user table, no history of your books, and no IP log
kept by NimBooks.

## Services NimBooks talks to

Every origin the app may send data to or load code from is pinned in its
Content Security Policy (`public/_headers`). The image rule is wider than it
needs to be (it allows any HTTPS image); the app itself only shows images it
ships or validator logos delivered inline as data, and that rule is due to be
tightened. Like any website, each service can see your IP address when your
device calls it.

| Service | Why | What it sees |
|---|---|---|
| Cloudflare (hosting) | serves the app and Functions | requests to nimbooks.subimpact.net |
| Cloudflare Web Analytics | cookie-free page-view statistics for the site | page, referrer, country, browser; not linked to your wallet |
| Google Fonts | the app's typefaces | that a page loaded the fonts |
| `rpc.nimiqwatch.com`, `v2.nimiqwatch.com` | balances, history, staker record, rewards | the Nimiq addresses you look up |
| Validators API | validator fees, reliability, yields | nothing about you |
| CoinGecko, DefiLlama, `prices.nim.sh` | prices (Nimiq's own price service first, then DefiLlama and CoinGecko as backups) | nothing about you |
| EVM public RPCs (Polygon, Base, Arbitrum, Optimism, Ethereum) | USDT and native balances | your EVM address |
| Nimiq Hub (`hub.nimiq.com`) | browser sign-in and signing | what you sign there |
| short.io | short links for receipts and payment requests you share | the shared link, including its contents |
| Google Calendar (only if you tap the restake reminder link) | adds a weekly "Restake your NIM rewards" event | the event title and a link to NimBooks; no address or amount |

NimBooks sets no cookies of its own.

FX rates for the display currencies come from a chain of three sources, tried
in order: the Nimiq Wallet's own exchange-rate table
(`firestore.googleapis.com`), then the currency-api data served by
`cdn.jsdelivr.net`, then ExchangeRate-API (`open.er-api.com`). Each is a
plain GET carrying nothing but the request itself - no address, no user data
- and whichever answers first fills the table. ExchangeRate-API's terms ask
for a credit: **FX rates from [ExchangeRate-API](https://www.exchangerate-api.com)**.

## Your wallet and your keys

Payments, stakes and receipt signatures are confirmed in your wallet, never
by NimBooks. The one key NimBooks ever creates is a cashlink's key, made on
your device for that link and kept there until the link is claimed or reverted.

## The AI server (nimbooks-mcp)

`nimbooks-mcp` runs on your own computer. It reads the same public chain data,
never signs, holds no keys and never calls NimBooks' server.

## Changes and contact

This page changes when the app's data handling changes; the changelog in the
app says so too. Questions, bug reports or a request to check what's stored:
the [NimBooks Telegram group](https://t.me/subimpactNET/6) or
nimbooks@subimpact.net.

# NimBooks roadmap

NimBooks helps Nimiq holders **earn on their NIM and keep the books**: what
your stake earns and why, every reward in your history, and statements, tax
files and proofs when you need them. It works inside Nimiq Pay and with Nimiq
Wallet in any browser.

_Last updated 24 October 2026. Dates are targets._

## Shipped since Cycle 2 (v1.14 → v1.38)

**Prices and currencies (v1.37)**
- Total value never shows $0.00 when a price service is busy: the last known price stays on screen, dated ("as of HH:MM") when older than 30 minutes, or "Price unavailable" when none exists.
- Prices now come from Nimiq's own price service first (prices.nim.sh), with DefiLlama and CoinGecko as backups, and FX rates from the Nimiq Wallet's table with currency-api and ExchangeRate-API behind it.
- 148 display currencies in a searchable picker (code or name), popular currencies first; tax reports stay in USD for currencies added today until historical exchange rates arrive.

**Earning**
- Earn card at the top of Overview: what your stake earns a year, or what idle NIM could earn at the median pool's rate (v1.28).
- Yield calculator: any amount, pool and 1, 3 or 5 years, with compounding for restaking pools and the protocol's falling issuance (v1.28).
- Staking from a browser through the Nimiq Hub: stake, unstake, retire and withdraw on desktop (v1.14).
- **Partial unstakes** that would leave less than the protocol's 100 NIM minimum staked are explained before they're sent (v1.32).
- **Reasons to come back:** the Earn card shows the rewards earned since your last visit, your actual yield over the last 30 days next to the pool's estimate, and what each validator has earned you all time (v1.33).
- **"Stake it?" prompt** when a received payment leaves NIM idle (v1.33).
- **Staking terms** on every position: how it works, that the rate varies, what can go wrong, and how long getting out takes (v1.38).
- **Restake loop** for pools that pay rewards into your wallet: what restaking adds a year, a one-tap restake, and a weekly calendar reminder (v1.38).
- **New look (beta) sidebar:** NIM price with its 24-hour or 7-day change, a ring of where your NIM is, and Stake idle NIM (v1.38).

**Books and tax**
- FIFO crypto tax with staking income, in your display currency, plus Koinly, CoinTracking and CryptoTaxCalculator CSVs (v1.21–1.22).
- Tax-year statements that separate staking from real payments, with opening and closing balances anchored to live on-chain state (v1.21–1.23).
- Older history on demand past the 1,000-transaction cap (v1.23).
- Portfolio PDF across up to 11 addresses, including Nimiq Pay's (v1.24).
- Analytics that tell Nimiq Pay's internal HTLC transfers apart from real payments (v1.23–1.25).
- Every Nimiq Pay payment contract in History, not just the current one, and stakes made from Nimiq Pay counted as staking rather than money sent (v1.29).
- Full-year staking rewards: statements, tax and History count every reward back to January 2025, fetched in calendar chunks with closed periods cached (v1.30).

**Payments**
- Cashlinks: NIM inside a claimable link, compatible with the Nimiq Hub (v1.14–1.15).
- When Nimiq Pay cannot confirm a payment went through, NimBooks says so, blocks a second send and checks the chain (v1.29).

**Trust and usability**
- `nimbooks-mcp`: a local, read-only AI server that never signs (v1.15).
- Guided tour of the sample wallet, and a landing page that explains every feature before you connect (v1.16, v1.25).
- 10-second refresh that keeps history, statements, tax and portfolio current (v1.25).
- An honest usage count, consent before counting, and "forget me" (v1.27).
- Backup reminders, because receipts and cashlink keys live only on the device (v1.27).
- Nimiq Pay SDK 0.2.4: wallet refusals show Pay's own reason (v1.27).
- **Neutral validator list:** sorted by net yield and reliability. ImpactZero, the builder's own validator, is labelled as such and no longer pinned first (v1.32).

## Cycle 3 (to 11 November 2026)

### Week 2 · 22–28 October: reasons to come back
- **`nimbooks-mcp` 1.1:** read-only `get_staking`, `list_validators`, `project_yield` and `get_rewards` tools, sharing the app's yield maths through a parity test.

### Week 3 · 29 October – 4 November: earning beyond the basics
- **`draft_stake` in the MCP server:** it returns a NimBooks link that opens the stake panel pre-filled. It never signs; you confirm in your own wallet.
- **Wider MCP reach:** listings in public MCP directories, and earning prompts on the `/mcp` page.

### Week 4 · 5–11 November: polish and submit
- **Submission material:** new screenshots and demo video (Nimiq Pay and Nimiq Wallet), plus the "Changes since Cycle 2" write-up.
- **Accessibility and performance:** a pass on both, and a stake/unstake end-to-end check in both wallets.
- **Submission:** targeted for 9 November, two days before the deadline.

## After the competition

These follow the prize payout schedule, so each milestone is public:
- **Month 1:** fix every critical bug reported in the Telegram group or by email, and answer community feedback.
- **Month 2:** at least one substantial update chosen by user feedback, plus a written status report.

**Candidates:**
- Reward alerts inside Nimiq Pay when it supports them.
- Switching validator as one guided flow (unstake, cooldown, restake) instead of separate steps.
- A read-only comparison of NIM staking with the dollar yields Nimiq Pay users can reach on Polygon, with the risks stated. Moved out of Cycle 3 to keep the competition scope on NIM books and staking.
- Encrypted, user-held sync for receipts across devices.
- More tax-software formats.

## Ideas we won't do

- **Hold keys or custody funds.** NimBooks never signs for you.
- **Add accounts, tracking or third-party analytics** beyond what [PRIVACY.md](PRIVACY.md) lists.
- **Hide who runs a pool.** The builder's pool is always labelled.

Feedback shapes this list: [Telegram](https://t.me/subimpactNET/6) · nimbooks@subimpact.net

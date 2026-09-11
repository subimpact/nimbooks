// Release notes shown in the version badge modal. Newest first — the git log is
// the source of truth, so every line here maps to shipped commits.
// Badge text. Spelled out rather than built from a version constant so the exact
// label ships as one string in the bundle (JSX would emit "v" as a separate node).
// package.json carries the machine-readable version.
export const APP_VERSION_LABEL = 'v1.8.0'

export interface ChangelogEntry {
  version: string
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.8.0',
    date: '2026-09-11',
    items: [
      'Quick actions on Overview: send NIM or receive it with a QR code without leaving the dashboard',
      'Send uses the same Pay/Hub wallet adapter as invoices, with demo mode safely read-only',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-09-10',
    items: [
      'Receipts show their memo: signed receipts now display the payment note right on the card, matching what the verify page proves',
      'History speaks human: a payment that settled a request shows the request name (e.g. “Acme Corp - Invoice #12”) alongside its on-chain reference',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-09-10',
    items: [
      'World first: stake NIM from inside Nimiq Pay even while your funds are in transit — NimBooks lets Pay’s wallet fund your stake straight from HTLC swap contracts, so your NIM never needs to rest to start earning',
      'Stake panel celebrates: confetti burst on a confirmed stake, then the panel closes itself — no more staring at a success line',
      'Stake ceiling now counts your in-transit NIM: the slider shows your true stakable balance, not just the resting balance',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-09-10',
    items: [
      'Info icons on every Overview card: tap the circle to see what each number means, right where you are',
      'Shared payment links now check the chain: a request that has been paid shows “Paid” and hides the pay button, so nobody pays twice',
      'Request cards show their on-chain reference, matching the memo in History — you can always tell which payment settled which request',
      'Memo fix: payments sent from inside Nimiq Pay now carry a clean, readable memo (and older double-encoded ones decode correctly too)',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-09-10',
    items: [
      'Your true balance, even inside Nimiq Pay: funds held in HTLC swap contracts now count toward your total, with an “in transit” line and a trajectory that shows the real story',
      'Share links are short and clean: receipts, invoices and CSV exports get a nimbook.s.gy link (QR codes scan instantly), and shared receipts open straight on the verify page',
      'Verify links work everywhere: a shared receipt opens in any browser, and the Pay button hands off through the app’s own deep link',
      'Taste pass: zero em-dashes in the copy, stat tiles read clean in screenshots',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-09-09',
    items: [
      'Shared payment links now open straight inside Nimiq Pay, on the right page: invoices keep their place when handed across devices',
      'Phone browser? Continue with Nimiq Hub via a redirected sign-in, and verify any receipt by pasting its link, payload or transaction hash',
      'Validator switch dialog explains the cool-down protocol instead of “coming soon”',
      'Rate sanity guard: NIM prices outside the real range are never shown or cached, so your books stay correct even if a price feed misbehaves',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-09',
    items: [
      'Protocol-hardened staking: 100 NIM minimum enforced, full retired balance withdrawn, failed transactions never pollute the charts',
      'Backup & restore your books: export everything to your clipboard and re-import it any time, on any device',
      '“Your books start here” first-run card for fresh wallets: receive NIM, create a request, or stake 100 NIM',
      'Statement fixes: daily-priced fees reconcile exactly with the net row; CSV carries a feeUSD column',
      'Inside Nimiq Pay: consensus-aware connects (no more $0 screens while syncing) and provider-native block height',
      'Validator logos in the stake picker; validator list loads only when you open staking',
      'Fiat formatting: thousands separators and correct decimals for zero-decimal currencies (JPY, KRW, VND, IDR, CLP)',
      'Keyboard-accessible charts and Escape closes every dialog',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-09-09',
    items: [
      'Analytics drilldown: tap any bar on the daily net flow chart to see that day\'s transactions',
      'Received, Sent and Net flow cards expand into detail sheets: top counterparties, fees paid, flow composition and period comparison',
      'Side-by-side Total value and NIM balance tiles on the Overview, with the balance breakdown in its own card',
      'Txs stat jumps straight to History',
      'Device preferences: your currency choice is remembered per device (in Nimiq Pay) and keeps working across sessions',
      'Staking history keeps the last 500 actions per address (up from 50)',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-09',
    items: [
      'Protocol-correct unstaking: deactivate → retire → withdraw, each step gated on chain validity (no more dead clicks)',
      'Staking actions (deactivate/retire/withdraw) now appear in History with explorer links',
      'Stake and unstake submits are verified on-chain: expired transactions are surfaced instead of hanging as pending',
      'Unstake banner reads cooling/ready state from the chain, scoped per address',
      'Feature list on the connect screen; lazy-loaded viem (smaller first load) and an accessibility pass',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-09-08',
    items: [
      'Staking: stake, unstake and rewards, with a validator picker showing live net yields',
      'Payment requests (invoices): create, share by link or QR, pay on-chain, auto-reconcile',
      'Tax-year statement with daily closes, per-year selector and CSV download',
      'Currency switcher: 37 currencies with flag tiles',
      'CSV export via download link + QR, so exports work inside the Nimiq Pay WebView',
      'Full holdings coverage: staking, vesting and locked HTLC swap funds in the balance card',
      'Light/dark theme toggle with system-preference default',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-07',
    items: [
      'Nimiq Hub browser login on desktop, plus the Nimiq Signed Message scheme for receipts',
      'Analytics: daily net flow and balance trajectory charts (SVG, no dependencies)',
      'Floating bottom tab dock for mobile thumb reach',
      'History pagination with caching, transaction kind badges and explorer links',
      'Read-only demo mode for trying the app without a wallet',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-05',
    items: [
      'Initial release: balances, history, signed receipts and CSV export',
      'Nimiq Pay mini app deep link',
      'Multi-chain EVM balances via viem; receipts bound to their signer',
    ],
  },
]

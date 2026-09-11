// Release notes shown in the version badge modal. Newest first, and the git log
// stays the source of truth: every line here maps to shipped commits.
//
// One entry per date. Everything shipped on the same day merges into that day's
// single entry, labelled with the last version to ship that day. A new entry
// appears only when the date changes.
// Badge text. Spelled out rather than built from a version constant so the exact
// label ships as one string in the bundle (JSX would emit "v" as a separate node).
// package.json carries the machine-readable version.
export const APP_VERSION_LABEL = 'v1.13.1'

export interface ChangelogEntry {
  version: string
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.13.1',
    date: '2026-09-11',
    items: [
      'Quick actions on Overview: send NIM or receive it with a QR code without leaving the dashboard, using the same Pay/Hub wallet adapter as invoices, with demo mode safely read-only',
      'Sends celebrate: the confetti fires the instant your payment leaves the wallet, and the success sheet stays open until you tap Done',
      'Full wallet history: transactions that flow through your Nimiq Pay HTLC relay address now appear in History too, every send, receive, swap and contract hop shown and classified (swap / HTLC / payment), so nothing your wallet does is hidden',
      'Staking now finishes the way sending does: a clear "confirming on chain" step while the transaction settles, then a "Stake confirmed" card with your amount, your validator and the explorer link, confetti included',
      'Unstaking finishes the same way: a confirming step, then a clean summary card for deactivate, retire and withdraw, whether you started from the stake panel or the balance banner',
      'The finishing steps you launch from the balance banner now get a window of their own instead of a toast you could miss, and tapping the banner again while one is in flight reopens it rather than sending a second transaction',
      'Those cards wait for your Done tap instead of vanishing on their own, and Done lands you back on the Overview dashboard',
      'Close the panel mid-confirmation and the stake or unstake keeps going: you still get the toast when it lands, and reopening picks the confirming step back up',
      'The app now sits on a living field of Nimiq hexagons in Nimiq brand colors: a travelling wave sweeps through the honeycomb, hexes swell as it passes, your cursor lifts nearby cells and every tap drops a ripple',
      'The field flows behind every screen, softly veiled so your books stay the focus, and the connect panel rests on a frosted glass card with a gradient wordmark and glass corner pills so nothing fights the moving hexes',
      'Field manners: it never follows statements, receipts and exports onto paper, resizes without reshuffling, runs at a steady battery-friendly pace, and the reduced-motion still frame follows theme changes and window resizes',
      'Inside Nimiq Pay, your in-transit NIM is now read straight from the wallet’s own account list, so the figure lands in one call instead of a history scan (the scan stays as the fallback everywhere else)',
      'History no longer double-counts payments that hop through your wallet’s relay address',
      'A stake that never reaches the chain no longer leaves a phantom entry in your books',
      'Demo mode now shows the staking panel in full, read-only: the validator picker, yields and the finish flow are all visible without a wallet',
      'Dialogs now manage focus for screen readers, and a content security policy guards the app',
      'Polish: readable payee addresses, safer invoice links, relay history cleared on disconnect, unstake errors can no longer resurface',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-09-10',
    items: [
      'World first: stake NIM from inside Nimiq Pay even while your funds are in transit. NimBooks lets Pay’s wallet fund your stake straight from HTLC swap contracts, so your NIM never needs to rest to start earning',
      'Your true balance, even inside Nimiq Pay: funds held in HTLC swap contracts now count toward your total, with an “in transit” line and a trajectory that shows the real story',
      'Stake ceiling now counts your in-transit NIM: the slider shows your true stakable balance, not just the resting balance',
      'Stake panel celebrates: confetti burst on a confirmed stake, then the panel closes itself, no more staring at a success line',
      'Share links are short and clean: receipts, invoices and CSV exports get a nimbook.s.gy link (QR codes scan instantly), and shared receipts open straight on the verify page',
      'Verify links work everywhere: a shared receipt opens in any browser, and the Pay button hands off through the app’s own deep link',
      'Info icons on every Overview card: tap the circle to see what each number means, right where you are',
      'Shared payment links now check the chain: a request that has been paid shows “Paid” and hides the pay button, so nobody pays twice',
      'Request cards show their on-chain reference, matching the memo in History, so you can always tell which payment settled which request',
      'Memo fix: payments sent from inside Nimiq Pay now carry a clean, readable memo (and older double-encoded ones decode correctly too)',
      'Receipts show their memo: signed receipts now display the payment note right on the card, matching what the verify page proves',
      'History speaks human: a payment that settled a request shows the request name (e.g. “Acme Corp - Invoice #12”) alongside its on-chain reference',
      'Demo mode tells a whole story on any device: the sample wallet now comes with a genuinely signed receipt and a request that was really paid on chain, so Receipts and Requests are never empty',
      'Taste pass: zero em-dashes in the copy, stat tiles read clean in screenshots',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-09-09',
    items: [
      'Protocol-correct unstaking: deactivate → retire → withdraw, each step gated on chain validity (no more dead clicks)',
      'Protocol-hardened staking: 100 NIM minimum enforced, full retired balance withdrawn, failed transactions never pollute the charts',
      'Stake and unstake submits are verified on-chain: expired transactions are surfaced instead of hanging as pending',
      'Staking actions (deactivate/retire/withdraw) now appear in History with explorer links',
      'Unstake banner reads cooling/ready state from the chain, scoped per address',
      'Validator switch dialog explains the cool-down protocol instead of “coming soon”',
      'Analytics drilldown: tap any bar on the daily net flow chart to see that day\'s transactions',
      'Received, Sent and Net flow cards expand into detail sheets: top counterparties, fees paid, flow composition and period comparison',
      'Side-by-side Total value and NIM balance tiles on the Overview, with the balance breakdown in its own card, and the Txs stat jumps straight to History',
      'Shared payment links now open straight inside Nimiq Pay, on the right page: invoices keep their place when handed across devices',
      'Phone browser? Continue with Nimiq Hub via a redirected sign-in, and verify any receipt by pasting its link, payload or transaction hash',
      'Backup & restore your books: export everything to your clipboard and re-import it any time, on any device',
      '“Your books start here” first-run card for fresh wallets: receive NIM, create a request, or stake 100 NIM',
      'Statement fixes: daily-priced fees reconcile exactly with the net row; CSV carries a feeUSD column',
      'Inside Nimiq Pay: consensus-aware connects (no more $0 screens while syncing) and provider-native block height',
      'Validator logos in the stake picker; validator list loads only when you open staking',
      'Fiat formatting: thousands separators and correct decimals for zero-decimal currencies (JPY, KRW, VND, IDR, CLP)',
      'Rate sanity guard: NIM prices outside the real range are never shown or cached, so your books stay correct even if a price feed misbehaves',
      'Device preferences: your currency choice is remembered per device (in Nimiq Pay) and keeps working across sessions',
      'Staking history keeps the last 500 actions per address (up from 50)',
      'Accessibility pass: keyboard-accessible charts and Escape closes every dialog',
      'Feature list on the connect screen, plus lazy-loaded viem for a smaller first load',
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

// Release notes shown in the version badge modal. Newest first — the git log is
// the source of truth, so every line here maps to shipped commits.
export const APP_VERSION = '1.0.0'
// Badge text. Spelled out rather than built with `'v' + APP_VERSION` so the exact
// label ships as one string in the bundle (JSX would emit "v" as a separate node).
export const APP_VERSION_LABEL = 'v1.0.0'

export interface ChangelogEntry {
  version: string
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-09-09',
    items: [
      'Protocol-correct unstaking: deactivate → retire → withdraw, each step gated on chain validity (no more dead clicks)',
      'Staking actions (deactivate/retire/withdraw) now appear in History with explorer links',
      'Stake and unstake submits are verified on-chain — expired transactions are surfaced instead of hanging as pending',
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
      'Currency switcher — 37 currencies with flag tiles',
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

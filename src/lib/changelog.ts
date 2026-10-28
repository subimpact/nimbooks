// Release notes shown in the version badge modal. Newest first, and the git log
// stays the source of truth: every line here maps to shipped commits.
//
// One entry per date. Everything shipped on the same day merges into that day's
// single entry, labelled with the last version to ship that day. A new entry
// appears only when the date changes.
// Badge text. Spelled out rather than built from a version constant so the exact
// label ships as one string in the bundle (JSX would emit "v" as a separate node).
// package.json carries the machine-readable version.
export const APP_VERSION_LABEL = 'v1.40.1'

export interface ChangelogEntry {
  version: string
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.40.1',
    date: '2026-10-28',
    items: [
      'Wallet Iqons now show their full picture. On the live site they had been drawn as a plain coloured circle since they arrived, because the shapes they are built from never loaded',
      'NimBooks MCP 1.2.2 counts staking rewards the same way as the app: a stake made in Nimiq Pay is no longer read as a reward',
    ],
  },
  {
    version: '1.40.0',
    date: '2026-10-27',
    items: [
      "The sample wallet is now a live Nimiq Pay wallet that stakes with ImpactZero, so you can see Nimiq Pay's transfers, the Hide internal switch and staking rewards on real history. It no longer comes with a ready-made receipt or payment request",
      'Staking rewards count only what your pool paid. A stake made in Nimiq Pay was also being counted as a reward, which inflated Rewards in History, the statement, the tax report and the actual yield on the Earn card',
      'The guided tour scrolls to the Send and Receive buttons before pointing at them, so the highlight no longer lands on the tab bar (found in phone test by subimpact)',
    ],
  },
  {
    version: '1.39.0',
    date: '2026-10-26',
    items: [
      'History has filters: Received, Sent, Rewards, Staking, Nimiq Pay transfers and Cashlinks, each with a count and a total. Rewards are grouped by month, so a year of daily rewards reads as twelve lines you can open',
      "History can hide Nimiq Pay's internal transfers, with the same switch as Analytics, so totals count only money that really came in or went out",
      'A stake link now opens the stake panel in about a second instead of waiting for your whole history to load',
    ],
  },
  {
    version: '1.38.0',
    date: '2026-10-24',
    items: [
      'Every stake now shows its terms: how staking works with your pool, that the rate varies, what can go wrong and how long getting out takes. They sit under Staking terms on the Earn card and in full in the Stake panel before you stake',
      'Pools that pay rewards into your wallet instead of restaking them get a restake loop on the Earn card: what restaking would add over a year, a one-tap Restake button, and a weekly reminder for Google Calendar or as a calendar file (inside Nimiq Pay, copy the reminder link)',
      "The yield calculator links to Nimiq's own staking calculator so you can compare the estimate",
      'New look (beta): the sidebar now carries the NIM price in your currency with its 24-hour or 7-day change and a small chart (tap 24h to switch), a ring showing where your NIM is (available, staked, moving in Nimiq Pay), and a Stake idle NIM button. There are no buy, sell or swap buttons: NimBooks does not trade',
      'Stake links: a link can open the stake panel with an amount and validator filled in, in a browser or, through Open in Nimiq Pay on a phone, inside the app. You still check and confirm it in your wallet',
      'The currency picker shows a flag for every currency that belongs to one country; shared currencies such as the CFA franc show their code',
      'nimbooks-mcp 1.2.0 adds draft_stake: ask your AI assistant for a stake link and it hands back one that opens the stake panel filled in. Like the other tools, it never signs',
    ],
  },
  {
    version: '1.37.0',
    date: '2026-10-22',
    items: [
      "Total value never shows $0.00 when a price service is busy: the last known price stays on screen with its time, or the tile says Price unavailable",
      'Prices now come from Nimiq\'s own price service first, with backups: DefiLlama and CoinGecko behind it, plus a ladder of exchange-rate tables for your display currency',
      '148 display currencies with a searchable picker: type a code or a name ("peso" finds six), popular currencies first',
      'Tax reports stay in USD for currencies added today until historical exchange rates are added',
    ],
  },
  {
    version: '1.36.1',
    date: '2026-10-21',
    items: [
      'New look (beta) rebuilt on shadcn: a sidebar and bottom tab layout, a new Overview with a collapsible Earn card, and the yield calculator as a bottom sheet. Classic stays the default',
      'New look (beta): the Analytics labels, chart title and footnote were nearly invisible (the beta and classic styles disagreed on one colour). They are readable again in both themes',
      'Gold buttons, the active tab and the period chips are easier to read: dark text on gold instead of white (contrast 7.8:1, up from 1.9:1)',
      'Analytics is shorter: the daily net flow and your balance over time now share one chart card. The two small icons at its top right switch between the bars and the balance line, and NimBooks remembers your pick',
      "The Earn card now gives you three reasons to come back: the rewards earned since your last visit, what the chain actually paid you over the last month next to the pool's estimate, and what each validator has earned you all time (per pool, collapsed until you open it)",
      'A received payment that leaves NIM idle now asks "Stake it?" - with what it could earn in a year, one tap to stake just that payment, and Not now when you would rather not',
      "The validator picker now orders pools on its own: highest net yield first, then reliability, with pools that are not producing last. Nothing is pinned to the top any more, and the developer's own pool, ImpactZero, is always labelled Builder's pool so you always know who runs it",
      "A partial unstake that would leave less than the protocol's 100 NIM minimum staked is now explained before you send it, with the amount NimBooks will actually unstake and a one-tap Unstake all button, instead of only appearing in the receipt afterwards",
    ],
  },
  {
    version: '1.31.0',
    date: '2026-10-20',
    items: [
      "The Stake button now always says why it can't be pressed yet: pick a validator, choose an amount, or wait while the signing library loads. The sample wallet says it is read-only at the top of the panel instead of below a long validator list - found by Jethro Adamu",
      'Browser sign-in: if the signing library fails to load, staking now retries on its own instead of staying stuck on "Preparing" until the panel is reopened',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-10-19',
    items: [
      'Statements and the tax report now count every staking reward back to January 2025, not just the last 90 days, so a full tax year\'s staking income is all there. History shows the older rewards too',
      'Tax figures now have a price for every day back to 2018. Days before late March 2025 used to come out unpriced, so older gains and staking income were left out of the totals',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-10-17',
    items: [
      'No more double payments by accident: when Nimiq Pay cannot confirm whether a payment, stake or cashlink went out, NimBooks checks the chain for it instead of saying it failed, and the send sheet no longer offers to pay a second time',
      'History now shows everything you paid and staked from Nimiq Pay. Pay moves your NIM into a new holding contract every few days, and NimBooks used to read only one of them',
      'Analytics no longer counts NIM you staked from Nimiq Pay as money sent',
      "Statements now show what you really sent and received from Nimiq Pay. NIM moving into and back out of Pay's own payment contracts sits on its own line (and in two new CSV columns) instead of being counted as money sent and received, so a busy Pay wallet no longer looks like it spent three times what it did",
      'The explorer link appears the moment a Nimiq Pay payment is sent, without waiting for the history to catch up',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-10-15',
    items: [
      "Earning comes first: a new Earn card tops Overview with what your stake earns a year (or what your NIM could earn staked, at the median pool's rate), how much NIM sits idle, and one tap to stake it",
      'Yield calculator: pick an amount, a validator and 1, 3 or 5 years to see the rewards month by month, with a chart and a year-by-year table. It counts compounding for pools that restake, and the yearly fall in new NIM issuance, so later years honestly earn less. Its stake button only ever offers NIM that is free to stake, never what is already staking',
      'Bugs and ideas now have a home: the changelog and the end of the tour link to the NimBooks Telegram group',
      'An honest usage number: the landing page now counts only real wallets recorded since October 9 (the earlier figure started from a placeholder of 18 wallets and 45 visits), sample-wallet sessions no longer count as visits, and a reload within 30 minutes is the same visit',
      "NimBooks asks before it counts your wallet: the connect screen says what is kept and has a Don't count me link, wallets that connected before ask once, and Export, Backup & restore has the switch",
      'Nimiq Pay SDK 0.2.4: when Pay turns down a payment, stake or signature, NimBooks now shows the reason Pay gave',
      "Don't count me now also deletes your wallet's record from the server, and the landing page shows where visits come from: Nimiq Pay or Nimiq Wallet",
      'Receipts and cashlink keys live only on the device, so signing out of Nimiq Pay clears them: NimBooks now says so where it matters, warns before you create a cashlink, and suggests a backup after you sign a receipt or create a link until one is copied',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-10-14',
    items: [
      'Support NimBooks: the landing page now has a support card with the donation address and QR, a public supporters list and the total raised, and the changelog links straight to a prefilled donation - suggested by Wool',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-10-12',
    items: [
      'Analytics now tells Nimiq Pay\'s internal HTLC transfers apart from real payments: each round trip into a contract and back is matched and shown as a faded layer on the chart, Received and Sent count real payments only with the internal amount listed underneath, and "Hide internal" zooms the chart to your payments - reported by Paul Gertz',
      'The landing page metric now shows total visits beside the number of connected wallets',
      'The 10-second refresh now keeps everything current: new transactions appear within seconds instead of up to two minutes, and the statement, crypto tax and portfolio report update on their own without flicker',
      'A new landing page explains how every NimBooks feature works before you connect: tap any feature for a step-by-step guide, what happens behind the scenes, and a button that opens it in the sample wallet',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-10-11',
    items: [
      'Portfolio report: combine your wallet with up to 10 more Nimiq addresses into one branded PDF with liquid and staked NIM, value in your display currency, a grand total and the time it was generated. Your Nimiq Pay balance is included. Unlocked for wallets staking 1,000 NIM or more with ImpactZero, the validator that keeps NimBooks running. Works inside Nimiq Pay too, through your phone\'s print screen - asked for by Wool',
      'Nimiq Pay CSV exports now say plainly that the download link holds this wallet\'s export, so it opens in any browser on any device without connecting a wallet',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-10-10',
    items: [
      'Analytics gains an HTLC rollover filter: a "No HTLC" toggle in Analytics lets Nimiq Pay users filter out the app\'s recurring internal balance maintenance transfers from Received, Sent, and net flow charts so volume reflects real payments instead of multi-million contract churn - suggested by Paul Gertz',
      'Live community metric on the landing page: a public metric badge in the hero displays unique connected wallets and real-time books kept across Nimiq Pay and Nimiq Hub',
      'Statement balances you can trust: the current-year and all-time closing balance now comes straight from your live on-chain state (liquid + staked) instead of replayed transaction history, so funds that predate the November 2024 proof-of-stake migration are finally included, and past-year statements carry an honest note about what visible history can and cannot show - reported by xFratta',
      'Load older history: wallets with more than 1000 transactions gain a button in the statement view that pages back through the full chain history (in slow, rate-friendly batches with a progress readout) so the year picker, statements, tax FIFO and analytics can reach years the first load never showed, with a heads-up that very active wallets take a minute - asked for by xFratta after his pool wallet hid every year before 2026',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-10-09',
    items: [
      'Standard Nimiq Design System makeover: typography upgraded to Mulish and Fira Code, signature pill-shaped buttons with radial gold gradients and cubic-bezier lift, Nimiq Darkerblue theme alignment, and live identicons (Iqons) across all wallet addresses',
      'Tax-year statements now separate internal staking and unstaking from real payments to others, preventing staking deposits from inflating sent amounts, and show opening (Jan 1) and closing (Dec 31) balances for each year directly',
      'Historical PoW transaction timestamps normalized: pre-2025 transactions recorded in Unix seconds are safely converted to milliseconds across History, Statements, and Tax views so early chain history renders its true date instead of January 1970 - found by Wool',
      'Crypto tax reporting in your display currency: FIFO realized gains and staking income now compute directly in your chosen currency (GBP, EUR, USD, and more), pairing historical daily closes with live FX rates and exporting custom Koinly and summary CSVs in that currency',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-10-07',
    items: [
      'The books do taxes now: the Export tab carries a FIFO crypto-tax card that pairs every historical transaction with its day\'s USD price and computes realized gains per calendar year, staking rewards read as income in the same view, and swap or escrow flows stay neutral so they never pose as sales',
      'Statement and history exports gain tax-software formats: the same books export as Koinly, CoinTracking or CryptoTaxCalculator CSVs, and a gains summary CSV sits beside them',
      'A year whose price coverage has gaps says so on its row, and sales whose cost basis is missing (coins bought before tracking began) are disclosed instead of silently counted',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-09-28',
    items: [
      'The feedback line at the top of the changelog now points at the inbox directly: a tap on nimbooks@subimpact.net opens a fresh email, so a bug report never has to leave the page to start',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-09-25',
    items: [
      'The send sheet in demo mode now says so before you type: a small "Demo preview: sending is disabled" banner sits at the top of the form, so nobody fills in a recipient and amount before noticing the flow is read-only - found by Faadil Boussari, who tested the demo on a phone and told us exactly where the confusion set in',
      'A small punctuation tidy in the hero line: the tagline now reads cleanly with a plain dash everywhere it appears',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-09-18',
    items: [
      'The feedback line moves out of the release notes and into its own spot: it now sits at the very top of the changelog, above every version, so it is always there no matter which release you are reading',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-09-15',
    items: [
      'A quiet reopen inside Nimiq Pay keeps the multi-chain panel too: the silently restored session now brings the EVM balances back with it',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-09-14',
    items: [
      'A guided tour walks you through the sample wallet: a small coach card points at your balance, sending, receiving, payment requests, history, receipts, staking and exports - and it offers itself again every time you open the sample wallet',
      'Signing failures now say what actually happened: if the wallet declines a receipt signature, the message from the wallet is shown instead of a raw error code - found by Harley NSpace, who was also the one to hit a payment failure while trying to pay a request (20B NIM, declined)',
      'Payment failures get the same treatment: when a wallet declines a payment, its own reason appears in the banner instead of a raw error code',
      'The MCP kit got a trust pass after Harsh Yadav\'s review: payment checks now say when the request amount could not be verified, validator rewards are folded into summaries and statements the way the books do, and the fence page names every host the server talks to',
      'The dock gets its bearings: every tab in the bottom bar now carries a small line icon above its label, lit amber when active, so the app reads at a glance on a phone',
      'Opening NimBooks inside Nimiq Pay no longer asks you to sign in again on every open: a saved session comes back silently, the wallet is only asked once per visit, and a wallet that takes a moment to answer keeps your books on screen instead of sending you to the connect screen',
      'The cashlink shelf shows every link you have made, not just the newest five, and every row refreshes from the chain when the sheet opens',
      'Your statements and CSV exports now carry a shape check at the door: a shared export link can only be minted from one, so the short-link server is never a file host',
      'Unstaking that repeats a withdrawn leg waits for the chain to confirm the balance moved before offering it again - no double signatures in the settling window',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-09-13',
    items: [
      'The books get an AI door: a small MCP chip sits beside the version badge and opens the setup page for nimbooks-mcp, the local assistant server that can read your books and draft requests but can never spend a Luna',
      'Cashlink safety pass: the link key is verified on your device before a single NIM moves, a link that is still funding can never be mistaken for a claimed one, and deleting a link asks first and is only offered for finished links',
      'Cashlinks you fund in a browser now carry the same on-chain cashlink tag the Nimiq Hub itself uses, so other Nimiq apps recognize them as cashlinks',
      'Statement download links are short and scannable again: your export waits behind a random link on the NimBooks server, never a third party, and deletes itself after 48 hours, with copy, open and the QR back in the modal',
      'Unstaking bounces double-taps, and a cashlink message that cannot fit the link format is refused up front instead of corrupting silently',
      'History and the CSV name cashlink rows for what they are instead of printing the raw on-chain tag',
      'Backups carry your cashlinks, keys included, and keep the heavy history caches out so the file stays small: store it as safely as you store your wallet',
      'Error messages that still claimed staking needs Nimiq Pay now point to both ways in: Nimiq Pay or a signed-in Nimiq Hub',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-09-12',
    items: [
      'Cashlinks, anywhere: send NIM as a claimable link with the money inside, created and funded right in NimBooks on Nimiq Pay or in a browser, with the link, QR and share sheet in your hands, live status, and one-tap revert if it never gets claimed',
      'Staking opens to the browser: sign in with the Nimiq Hub on desktop and stake, unstake, retire and withdraw from right here. The app builds the transaction, the Hub signs it, and the same confirming cards walk it to the chain',
      'The signing library behind browser staking downloads once, the first time you open a staking surface in a Hub session, and Nimiq Pay users never load it',
      'Validator icons now load instantly, even offline: the picker bakes small logo thumbnails into the list it saves, so cached opens show real icons right away and no longer re-download the big logo payload, with the monogram chip kept as a last resort',
      'ImpactZero now leads the validator picker: 0% fees, pinned first, and a brand-new validator stays selectable while its score is still building',
      'Stake and unstake amounts take typed round numbers: the slider now pairs with a field, so setting exactly 100 or 1,000 NIM is a quick type instead of a careful drag (thanks to Bjorn van der Schaaf for the suggestion)',
    ],
  },
  {
    version: '1.13.1',
    date: '2026-09-11',
    items: [
      'Quick actions on Overview: send NIM or receive it with a QR code without leaving the dashboard, using the same Pay/Hub wallet adapter as invoices, with demo mode safely read-only',
      'Coming back from a transaction link keeps you signed in: tapping a tx hash and pressing back no longer drops you at the connect screen inside Nimiq Pay, and you land back on the tab you were on',
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
      'Stake NIM from inside Nimiq Pay even while your funds are in transit. NimBooks lets Pay’s wallet fund your stake straight from HTLC swap contracts, so your NIM never needs to rest to start earning',
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

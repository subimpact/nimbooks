// What NimBooks does, explained. This is the one source of truth for the
// landing page: the phone cards, the phone explainer sheets and the desktop
// explorer all read from FEATURES.
//
// Every claim is checked against the shipped app (the screen or the code it
// names). If a feature changes, change it here and the landing follows.
// Copy rules: UK English, short sentences, no em-dashes, and no jargon without
// a one-line explanation.

/** The app views a sample-wallet entry can open on (mirrors App.tsx's View). */
export type FeatureView = 'dashboard' | 'history' | 'receipts' | 'request' | 'export'

export interface FeatureStep {
  title: string
  body: string
}

export interface FeatureTry {
  /** The view the sample wallet opens on. */
  view: FeatureView
  /** A `data-learn` anchor on the screen to scroll to and highlight. */
  target?: string
  /** A panel to open once the screen is up. */
  open?: 'stake'
}

export interface FeatureDef {
  slug: string
  title: string
  oneLiner: string
  /** An emoji, shown on the phone cards and in the desktop list. */
  icon: string
  /** Where the feature works, e.g. "Nimiq Pay and browser". */
  availability: string
  /** Three or four steps. */
  steps: FeatureStep[]
  /** Two to four bullets: what is on chain, what stays on the device, what never leaves the wallet. */
  behindTheScenes: string[]
  /** One to three honest limits. */
  goodToKnow: string[]
  tryView: FeatureTry
}

/** A sample-wallet entry from the landing. `tour` keeps the guided tour offer. */
export interface SampleEntry extends FeatureTry {
  tour: boolean
}

const PAY_AND_BROWSER = 'Nimiq Pay and browser'

export const FEATURES: FeatureDef[] = [
  {
    slug: 'staking',
    title: 'Staking',
    oneLiner: 'See what your NIM earns, stake it with a validator, and follow every reward.',
    icon: '🌱',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Start from the Earn card',
        body: 'The first card on Overview shows what your NIM earns a year, or could earn if you staked it. See the maths opens a calculator; Start earning (or the leaf icon in the top bar) opens the Stake panel.',
      },
      {
        title: 'Pick a validator',
        body: 'A validator is a node that secures the network and pays rewards to the NIM staked with it. The list is live from Nimiq\'s public validator data. ImpactZero, the validator that keeps NimBooks running, is pinned first.',
      },
      {
        title: 'Stake',
        body: 'A first stake needs at least 100 NIM. Confirm it in your wallet, and the panel waits until it is on chain.',
      },
      {
        title: 'Unstake in three steps',
        body: 'Unstake starts a cooldown. When it has cooled down, complete the unstake, then withdraw. The balance banner has both buttons.',
      },
    ],
    behindTheScenes: [
      'On chain: stakes, unstakes and rewards. Staking is a transaction to the staking contract.',
      'In Nimiq Pay: your wallet signs and sends the staking transactions.',
      'In a browser: NimBooks builds the staking transactions, and the Nimiq Hub signs them.',
    ],
    goodToKnow: [
      "Rewards arrive as daily totals, and today's appear tomorrow.",
      'Unstaking takes up to about a day. It takes longer if the validator is jailed, which means it is removed from the network for a time after misbehaving.',
      'To switch validator, unstake, wait out the cooldown, then stake again.',
    ],
    tryView: { view: 'dashboard', open: 'stake' },
  },
  {
    slug: 'balance',
    title: 'Balance in 37 currencies',
    oneLiner: 'Your NIM balance, with its value in the currency you pick.',
    icon: '💰',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Read Total value',
        body: 'The top card adds up your NIM and EVM assets at the current price, in your display currency.',
      },
      {
        title: 'Read the NIM balance',
        body: 'It counts available NIM, staked NIM and NIM in swap contracts (HTLCs). An HTLC is a swap contract that holds NIM until it is claimed or refunded.',
      },
      {
        title: 'Change the currency',
        body: 'Tap the currency chip with the flag and pick from 37 currencies.',
      },
      {
        title: 'See EVM assets',
        body: 'Inside Nimiq Pay, an EVM assets card lists native coins and USDT (a dollar-pegged token) on five Ethereum-compatible chains: Polygon, Base, Arbitrum, Optimism and Ethereum.',
      },
    ],
    behindTheScenes: [
      'On chain: your NIM balance, read from public Nimiq services.',
      'Prices: fiat values come from the CoinGecko price feed.',
      'Stays in your wallet: nothing. Reading a balance never asks you to sign.',
    ],
    goodToKnow: [
      'Funds in swap contracts show as in transit. They are still yours.',
      'Analytics and the tax report use your chosen currency. Statements stay in USD.',
      'The EVM panel only appears inside Nimiq Pay.',
    ],
    tryView: { view: 'dashboard', target: 'total' },
  },
  {
    slug: 'history',
    title: 'History and labels',
    oneLiner: 'Every transaction, labelled, with the note it carried.',
    icon: '📋',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Open History',
        body: 'Your transactions run newest first, read from the chain.',
      },
      {
        title: 'Read the labels',
        body: 'Stake, unstake, swap, HTLC, vesting, reward and Cashlink rows carry a tag. Plain payments need none. "What are these types?" explains each one.',
      },
      {
        title: 'Open a row',
        body: 'Most rows link to the transaction on the Nimiq explorer. A note that came with the payment shows under the row.',
      },
      {
        title: 'Load more',
        body: 'History shows a page at a time. Load more reveals the rest.',
      },
    ],
    behindTheScenes: [
      'On chain: most rows are real transactions. Rewards are daily totals per validator, from a staking index.',
      'Nimiq Pay relay hops: some Nimiq Pay transfers go through a relay account. NimBooks merges those hops in, so History matches what the wallet did.',
      'On this device: a two-minute copy of your transaction list, so a quick refresh does not read the whole chain again.',
    ],
    goodToKnow: [
      "Rewards show one row per day per validator. Today's rewards appear tomorrow. Rewards go back to January 2025, when the public rewards data starts.",
      'Only the latest 1,000 transactions load at first. Older history loads from the Export tab.',
      'Failed transactions are marked failed and left out of statements and tax.',
    ],
    tryView: { view: 'history' },
  },
  {
    slug: 'analytics',
    title: 'Analytics',
    oneLiner: 'Daily net flow, top counterparties and your balance over time.',
    icon: '📈',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Pick a period',
        body: '7 days, 30 days or All. The stats and the chart follow your choice.',
      },
      {
        title: 'Read the daily net flow',
        body: "Each bar is what came in minus what went out that day. Tap a bar to open that day's transactions.",
      },
      {
        title: 'Hide the internal layer',
        body: 'Nimiq Pay sends NIM into a contract and back again. Those round trips show as faded bars. Hide internal takes them off the chart and out of the internal figures.',
      },
      {
        title: 'Check who you deal with',
        body: 'Top senders and top recipients list the five biggest counterparties, each with its share. The balance line shows your balance day by day.',
      },
    ],
    behindTheScenes: [
      'On chain: the figures come from the transactions NimBooks has loaded.',
      'Round trips: a transfer out to a contract and back is matched and netted, so Received and Sent count real payments.',
      'Stays on this device: the charts are drawn in your browser. Nothing is uploaded.',
    ],
    goodToKnow: [
      'Staking rewards and staking moves are not in the net flow. They show in History and in the statement.',
      'The balance line does not include staking rewards.',
      'Analytics only counts the history NimBooks has loaded. Older years need Load older history on the Export tab.',
    ],
    tryView: { view: 'dashboard', target: 'analytics' },
  },
  {
    slug: 'send-receive',
    title: 'Send and receive',
    oneLiner: 'Send NIM with a note, or show your address as a QR code.',
    icon: '💸',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Tap Send NIM',
        body: "It sits under Quick actions on the Overview. Enter the amount and the recipient's Nimiq address. The amount shows in your currency too.",
      },
      {
        title: 'Add a note (optional)',
        body: 'A note of up to 64 bytes, about 64 plain letters, travels on chain with the payment.',
      },
      {
        title: 'Confirm in your wallet',
        body: 'Nimiq Pay asks you to confirm. In a browser, the Nimiq Hub signs and sends the payment. Payments are final once they are on chain.',
      },
      {
        title: 'Receive',
        body: 'Tap Receive NIM for your address as a QR code, with a copy button. Ask for a specific amount to make a payment request.',
      },
    ],
    behindTheScenes: [
      'On chain: the payment and its note. Both are public and permanent.',
      'Stays in your wallet: your keys. NimBooks asks the wallet to sign and never sees the key.',
      'In a browser: the Nimiq Hub signs in a pop-up, or on its own page on a phone.',
    ],
    goodToKnow: [
      'Payments cannot be reversed once they are on chain.',
      'The sample wallet is read-only. The send sheet opens, but it will not send.',
      'On a phone browser, the Hub takes you to its own page to sign, then brings you back.',
    ],
    tryView: { view: 'dashboard', target: 'quick-actions' },
  },
  {
    slug: 'requests',
    title: 'Payment requests',
    oneLiner: 'A payment link with an amount and a reference. It marks itself paid when the money lands.',
    icon: '📨',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Open the Request tab',
        body: 'Enter the amount in NIM. Add a short note if you like, and pick an expiry: none, 1 hour, 24 hours or 7 days.',
      },
      {
        title: 'Share the link or QR',
        body: 'Create the request, then use Share link or QR. The payer opens the link in Nimiq Pay or signs in with the Nimiq Hub.',
      },
      {
        title: 'The payer pays',
        body: 'The payment carries the request reference in its note. A full payment settles the request.',
      },
      {
        title: 'Watch it turn Paid',
        body: 'NimBooks finds the payment by its reference and marks the request Paid. You can also mark it by hand.',
      },
    ],
    behindTheScenes: [
      'On chain: the payment, with the reference (nimbooks:invoice and the request id) in its note.',
      'On this device: your requests, kept in this browser or in Nimiq Pay, not on a server.',
      "Stays in your wallet: the payer's keys. The payer confirms the payment in their own wallet.",
    ],
    goodToKnow: [
      'Only a full payment settles a request. An underpayment stays open.',
      'NimBooks checks for payments while it is open, and again each time you open it.',
      'The payment page offers Nimiq Pay and the Nimiq Hub only. An expired request can still be paid from its link.',
    ],
    tryView: { view: 'request' },
  },
  {
    slug: 'receipts',
    title: 'Signed receipts',
    oneLiner: 'A signed proof of payment that anyone can check on a public page.',
    icon: '🧾',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Find the payment',
        body: 'In History, tap Sign receipt on a plain payment. Rewards, staking deposits and relay hops cannot be signed.',
      },
      {
        title: 'Sign it',
        body: 'Your wallet signs the transaction details (sender, recipient, amount, time and note) with your key.',
      },
      {
        title: 'Share the verification link',
        body: 'Find the receipt under Receipts, then tap Share verification link.',
      },
      {
        title: 'Anyone can check it',
        body: 'The check page is nimbooks.subimpact.net/#/verify. It needs no account and no wallet.',
      },
    ],
    behindTheScenes: [
      'Off chain: the signature. The payment itself is on chain, and the signature only vouches for it.',
      'On chain: the check reads the transaction back from the Nimiq chain, by its hash.',
      'Stays in your wallet: your key. NimBooks only ever gets the signature and the public key (the part of a key that anyone may see).',
    ],
    goodToKnow: [
      'The check confirms the signer is the sender or the recipient, and that the amount, the time (within a minute) and the note match the chain. A transaction that failed, or does not exist, fails it.',
      'The signature is not on-chain: a receipt is kept on the device that signed it and inside its link. Back up from Export to keep it through a reset; a link you shared keeps working either way.',
      'The sample wallet is read-only. It includes one receipt signed in advance.',
    ],
    tryView: { view: 'receipts' },
  },
  {
    slug: 'cashlinks',
    title: 'Cashlinks',
    oneLiner: 'Put NIM inside a link. Whoever has the link can claim it.',
    icon: '🔗',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Open the Send sheet',
        body: 'Tap Send NIM, then Send a claimable link instead.',
      },
      {
        title: 'Set the amount',
        body: 'Enter the amount and an optional note. NimBooks makes a fresh key for the link in your browser.',
      },
      {
        title: 'Fund the link',
        body: "Your wallet approves the payment into the link's address. Nimiq Pay asks you to approve it, and the Nimiq Hub asks you to confirm it.",
      },
      {
        title: 'Share the link or QR',
        body: "Send it to the person who should claim it. They open it on the Nimiq Hub's cashlink page to claim the NIM.",
      },
    ],
    behindTheScenes: [
      "On chain: the funding and the claim. The link's address holds the NIM until someone claims it or you revert it.",
      "On this device: the link's key, on a local shelf of up to 20 links, so you can revert later. It never goes to a server.",
      'Stays in your wallet: your wallet keys. The link has its own key, and only that key moves its funds.',
    ],
    goodToKnow: [
      'Anyone with the link can claim the NIM. Share it only with the person you mean.',
      'Revert returns unclaimed NIM to your wallet. Once someone has claimed it, the NIM is theirs.',
      'The sample wallet is read-only, so it cannot make a link. Hub sign-in on a phone browser cannot make one either.',
    ],
    tryView: { view: 'dashboard', target: 'quick-actions' },
  },
  {
    slug: 'statements',
    title: 'Yearly statements',
    oneLiner: 'Opening and closing balance, what came in, what went out and the fees, for each year.',
    icon: '📅',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Open the Export tab',
        body: 'The Tax-year statement card sits below the Portfolio report.',
      },
      {
        title: 'Pick a year',
        body: 'Choose a year or All time. The years listed come from the history NimBooks has loaded.',
      },
      {
        title: 'Read the totals',
        body: 'Opening balance (1 January), received, sent to others, network fees, staking and unstaking (kept apart from payments), rewards, net change and closing balance (31 December).',
      },
      {
        title: 'Download it',
        body: 'Download the statement as a CSV spreadsheet file, or copy it. Inside Nimiq Pay you get a link instead.',
      },
    ],
    behindTheScenes: [
      "On chain: each day's totals come from your transactions. Staking deposits count as internal, not as payments sent.",
      "Prices: USD values use CoinGecko's closing price for each day, in UTC time.",
      'Stays on this device: the statement is built in your browser or Pay.',
    ],
    goodToKnow: [
      "The current year's closing balance is your live balance, available plus staked. It includes funds from before November 2024.",
      'Past years are rebuilt from visible history, so funds from before that history are not included.',
      'Failed transactions are left out.',
    ],
    tryView: { view: 'export', target: 'statement' },
  },
  {
    slug: 'tax',
    title: 'Crypto tax',
    oneLiner: 'Realised gains per year, first in first out, plus staking income, in your currency.',
    icon: '🧮',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Open Crypto tax (FIFO)',
        body: 'It sits on the Export tab, under the statement. FIFO means first in, first out: each sale uses your oldest NIM first.',
      },
      {
        title: 'Read gains and income',
        body: 'Gain is what a sale brought in, minus what those coins cost. Income is staking rewards, valued on the day you received them.',
      },
      {
        title: 'Pick a format',
        body: 'Choose Koinly, CoinTracking or CryptoTaxCalculator for the ledger, a CSV spreadsheet file. The gains summary is a separate CSV download.',
      },
      {
        title: 'Check the notes',
        body: 'A year marked incomplete, or a note under the card, shows where the figures have gaps.',
      },
    ],
    behindTheScenes: [
      'On chain: your transfers. Staking and unstaking are not sales, and swaps and contract moves stay neutral.',
      'Prices: daily NIM prices, from DefiLlama for older history and CoinGecko for the last year, in your reporting currency.',
      'Stays on this device: the sums run in your browser or Pay. Nothing goes to a tax service.',
    ],
    goodToKnow: [
      'These are figures for your records, not tax advice. Check them with a professional.',
      'Coins bought before the visible history have no cost basis, so their sales are flagged rather than counted as gains.',
      'A day with no price leaves out the transactions on that day.',
    ],
    tryView: { view: 'export', target: 'tax' },
  },
  {
    slug: 'exports',
    title: 'Exports and backup',
    oneLiner: 'Download your history as CSV, or copy it. Back up your NimBooks data as text.',
    icon: '📤',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Download CSV',
        body: 'On the Export tab, Download CSV saves your transactions. Copy CSV puts the same file on your clipboard.',
      },
      {
        title: 'Inside Nimiq Pay, use the link',
        body: 'Nimiq Pay cannot save files, so NimBooks shows a download link, with a QR code when the file is small enough to scan. Open either on any device to get the file.',
      },
      {
        title: 'Back up your data',
        body: 'Back up my data gives you a text copy of your receipts, payment requests, staking log and preferences. Keep it somewhere safe.',
      },
      {
        title: 'Restore',
        body: 'Paste a backup into Restore from backup. It fills in what is missing and never overwrites what is already on the device.',
      },
    ],
    behindTheScenes: [
      'On this device: the backup is built from your browser or Pay storage. It is not sent anywhere.',
      "On NimBooks' server: a short download link keeps the CSV for 48 hours, then deletes it.",
      'The long link: it carries the file in its own address, and the server stores nothing.',
    ],
    goodToKnow: [
      'The backup is plain text, not encrypted. It holds your cashlink keys, so keep it as carefully as your wallet.',
      'Download links expire after 48 hours. Very long exports are too big for a QR code, so copy the link instead.',
      'Backups leave out prices and transaction history. Those come back from the chain on their own.',
    ],
    tryView: { view: 'export', target: 'export' },
  },
  {
    slug: 'portfolio',
    title: 'Portfolio PDF',
    oneLiner: 'One report for your wallet and up to 10 more Nimiq addresses, with a grand total.',
    icon: '📄',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'Add addresses (optional)',
        body: 'Add up to 10 more Nimiq addresses, each with an optional label.',
      },
      {
        title: 'Read the totals',
        body: 'Each address shows its available NIM (not staked) and its staked NIM, with values in your currency. The grand total adds them all up.',
      },
      {
        title: 'Save as PDF',
        body: "Tap Save as PDF. Inside Nimiq Pay, your phone's print screen opens: choose Save as PDF as the printer. In a browser, your browser's print dialog opens.",
      },
      {
        title: 'Unlock it by staking',
        body: 'Reports unlock when you stake 1,000 NIM or more with ImpactZero. The sample wallet is unlocked.',
      },
    ],
    behindTheScenes: [
      'On chain: available and staked NIM for each address, read from the chain.',
      'On this device: your extra addresses and their labels, kept in this browser or Pay.',
      'Stays in your wallet: your keys. A report only reads balances.',
    ],
    goodToKnow: [
      "Funds Nimiq Pay holds for an extra address are not included. Your own wallet's Nimiq Pay balance is.",
      'Only active stake with ImpactZero unlocks reports. Stakes with other validators do not count.',
      'The PDF is made by your browser or phone print step, so nothing is uploaded to make it.',
    ],
    tryView: { view: 'export', target: 'portfolio' },
  },
  {
    slug: 'mcp',
    title: 'MCP for AI assistants',
    oneLiner: 'Ask an AI assistant about your books. It can read them, but it never sends anything.',
    icon: '🤖',
    availability: 'Your computer, with Node.js 20 or newer',
    steps: [
      {
        title: 'Open the setup page',
        body: 'MCP is a standard way for AI assistants to use tools. Go to /mcp/ on NimBooks, or tap the MCP chip in the top bar.',
      },
      {
        title: 'Start the server',
        body: 'Run npx -y nimbooks-mcp in a terminal. npx, a Node tool, fetches the package from npm (the Node package registry) the first time.',
      },
      {
        title: 'Connect your assistant',
        body: 'Copy the config for your assistant from the setup page and restart it. Six tools appear.',
      },
      {
        title: 'Ask a question',
        body: 'For example: how much came in last month, and from whom? Or ask it to draft a request for 25 NIM.',
      },
    ],
    behindTheScenes: [
      'On chain: it reads the public Nimiq chain, public staking rewards data and CoinGecko prices. Three hosts in all.',
      'On your computer: the server runs locally. A backup file, if you give one, is opened read-only.',
      'Never leaves your wallet: no keys and no signing. The server holds no key material at all.',
    ],
    goodToKnow: [
      'It cannot send, sign or mark anything as paid. A drafted payment request is only a link.',
      "It never calls NimBooks' own server. Set a default address with the --address option, or name one in each question.",
      'The sample wallet has no assistant. Try it opens the sample wallet at the top bar, where the MCP chip is.',
    ],
    tryView: { view: 'dashboard', target: 'mcp' },
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    oneLiner: 'Reads public chain data. Your keys stay in your wallet, and there is no account.',
    icon: '🔒',
    availability: PAY_AND_BROWSER,
    steps: [
      {
        title: 'It runs where you are',
        body: 'NimBooks runs in your browser or inside Nimiq Pay. There is no login and no account to create.',
      },
      {
        title: 'It reads public data',
        body: 'Balances and transactions come from public Nimiq services. Prices come from public price feeds.',
      },
      {
        title: 'Your wallet signs',
        body: 'Payments, stakes and receipts go to your wallet, which asks you to confirm. A cashlink is the one exception: its own key claims or reverts it when you ask.',
      },
      {
        title: 'Little leaves the device',
        body: "Your books stay in your browser or Pay. The server keeps two things only: a copy of a short export link, for 48 hours, and, if you agree, a record that counts your wallet.",
      },
    ],
    behindTheScenes: [
      'On this device: receipts, payment requests, the staking log, the cashlink shelf and your settings.',
      "On NimBooks' server, for wallets that agreed to be counted: a SHA-256 hash of the address (a one-way fingerprint), a masked form (first and last four characters), the wallet app, the device type, when it first and last connected, and how many visits.",
      "Each counted visit also sends the builder a chat alert on NimBooks' own Matrix server with the masked address, the wallet app and the device type.",
      'Never leaves your wallet: your keys. NimBooks never sees a key.',
    ],
    goodToKnow: [
      'The chain is public. Anyone can look up the transactions your books show.',
      "Counting is your choice: the connect screen has a Don't count me link, and Export, Backup & restore changes it later, which also deletes your wallet's record. The record keeps the hash and the masked form, not the full address, but anyone who already knows an address could work out its hash, so treat it as pseudonymous, not anonymous.",
      'A shared request or receipt link can go through a link shortener, which can read the link.',
    ],
    tryView: { view: 'export', target: 'backup' },
  },
]

/** The feature a slug names, or undefined for an unknown slug. */
export function featureBySlug(slug: string | null | undefined): FeatureDef | undefined {
  if (!slug) return undefined
  return FEATURES.find((f) => f.slug === slug)
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'
import {
  connectWallet,
  connectHub,
  connectDemoAccount,
  disconnectWallet,
  isDemoMode,
  canStake,
  stakeNim,
  unstakeDeactivate,
  unstakeRetire,
  unstakeRemove,
  getCurrentBlock,
  getDeviceId,
  getLanguage,
  signReceipt,
  type WalletAccount,
} from './lib/wallet'
import {
  getNimiqBalance,
  getHtlcHoldings,
  getStakingHolding,
  getVestingHoldings,
  getNimiqTransactionHistory,
  waitForTxMined,
  getEvmBalances,
  getAllFiatRates,
  getValidators,
  clearTxCache,
  formatLuna,
  formatUnits,
  formatFiat,
  formatValidatorFee,
  formatValidatorReward,
  formatValidatorReliability,
  isLabelledTxKind,
  txLabel,
  decodeMemo,
  explorerTxUrl,
  loadCurrency,
  saveCurrency,
  CURRENCIES,
  STAKING_CONTRACT,
  type CurrencyCode,
  type FiatRates,
  type NimiqTx,
  type EvmBalance,
  type HtlcHolding,
  type StakingActionKind,
  type StakingHolding,
  type ValidatorInfo,
  type VestingHolding,
} from './lib/chain'
import {
  appendStakingAction,
  loadStakingLog,
  markStakingActionConfirmed,
  removeStakingAction,
  type StakingAction,
} from './lib/stakingLog'
import { encodeReceipt, type SignedReceipt } from './lib/receipt'
import {
  EXPIRY_OPTIONS,
  MAX_MEMO_CHARS,
  formatLunaExact,
  invoiceStatus,
  invoiceUrl,
  loadInvoices,
  newInvoiceId,
  parseInvoiceMemo,
  parseNimToLuna,
  saveInvoices,
  upsertInvoice,
  type StoredInvoice,
} from './lib/invoice'
import { getRestakeRewardTxs, restakeWindow } from './lib/stakingEvents'
import { isInNimiqPay, isMobileDevice, NIMIQ_PAY_APP_URL } from './lib/device'
import { buildDownloadLink } from './lib/downloadLink'
import { exportBackup, importBackup, validateBackup } from './lib/backup'
import { APP_VERSION_LABEL, CHANGELOG } from './lib/changelog'
import QrCode from './QrCode'
import Analytics, { type AnalyticsPeriod } from './Analytics'
import {
  availableStatementYears,
  buildStatementCsv,
  computeStatement,
  getDailyNimPrices,
  type Statement,
} from './lib/statement'

type View = 'dashboard' | 'history' | 'receipts' | 'request' | 'export'

const RATES_KEY = 'nimbooks:rates'
// The Nimiq Pay host's device identifier, cached so the prompt is asked once.
// chain.ts reads the same key to scope per-device preferences.
const DEVICE_ID_KEY = 'nimbooks:deviceId'

// chain.ts owns this key and writes { asset: { rates: {usd,myr,eur,…}, at } }.
// Read that schema for the no-flash initial state.
interface RateCache {
  [asset: string]: { rates?: Partial<FiatRates>; at?: number }
}

function readRates(): RateCache {
  try {
    return JSON.parse(localStorage.getItem(RATES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

type RateAsset = 'nim' | 'usdt' | 'eth' | 'pol'

// EVM balances cost 5 chains × up to 2 viem calls, and the 10s auto-refresh
// was paying that every tick — which is also why the EVM card blinked out
// mid-read. They move far slower than that; 60s is plenty for a balance sheet.
const EVM_CACHE_TTL = 60 * 1000
const evmBalanceCache = new Map<string, { at: number; balances: EvmBalance[] }>()

const ZERO_RATES: FiatRates = { usd: 0, myr: 0, eur: 0, sgd: 0, gbp: 0 }

// Overlay whatever the cache holds onto the placeholder rates: a cache written
// before a currency was added carries only the older keys.
function mergeRates(base: FiatRates, cached?: Partial<FiatRates>): FiatRates {
  if (!cached) return base
  const out = { ...base }
  for (const c of CURRENCIES) {
    const v = cached[c.code]
    if (typeof v === 'number') out[c.code] = v
  }
  return out
}

function cleanAddr(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function sanitizeCsvCell(val: unknown): string {
  const str = String(val ?? '')
  // CSV formula injection guard: prefix =, +, -, @, tab, CR with a single quote
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str
}

function isValidReceipt(r: unknown): r is SignedReceipt {
  if (!r || typeof r !== 'object') return false
  const x = r as Record<string, unknown>
  return (
    typeof x.app === 'string' &&
    typeof x.txHash === 'string' &&
    typeof x.sender === 'string' &&
    typeof x.recipient === 'string' &&
    typeof x.amount === 'string' &&
    typeof x.timestamp === 'number' &&
    typeof x.publicKey === 'string' &&
    typeof x.signature === 'string'
  )
}

// The pending-unstake marker is per address, not per device: a shared WebView
// must not show one account's pending retire on another's balance.
function pendingUnstakeKeyFor(address: string | null | undefined): string | null {
  return address ? `nimbooks:pendingUnstake:${address.replace(/\s+/g, '')}` : null
}

// A submitted tx is not a mined tx: one that never makes it into a block is
// dropped when its validity window passes, and nothing on chain records the
// attempt. Every stake/unstake submit therefore starts a short verification
// poll, and this is the state the panel renders off.
type TxVerify = 'checking' | 'confirmed' | 'expired' | 'unknown'
// Long enough to confirm a healthy tx (Nimiq mines in seconds), short enough
// that a dead one surfaces while the user is still looking at the panel. The
// interval matches the auto-refresh cadence — nimiqwatch 429s on faster polls.
const TX_VERIFY_TIMEOUT_MS = 90_000
const TX_VERIFY_INTERVAL_MS = 10_000

// Nimiq PoS: one epoch is 43,200 blocks at ~1 block/second (~12h). A retire is
// only valid a full reporting epoch after the deactivation took effect, which
// is what gates step 2 of the unstake flow.
const BLOCKS_PER_EPOCH = 43_200
const SECONDS_PER_BLOCK = 1

// Wording for the locally-recorded staking legs (lib/stakingLog.ts). Past
// tense: each row records an action that was submitted, not a state the stake
// is currently in — the balance banner reports the state.
const STAKING_ACTION_LABEL: Record<StakingActionKind, string> = {
  deactivate: 'deactivated',
  retire: 'retired',
  withdraw: 'withdrawn',
}

// Nimiq's minimum stake is 10,000,000 Luna (getPolicyConstants). A first stake
// below it is rejected by the protocol, and a partial unstake that would leave
// a staker record below it is rejected the same way.
const MIN_STAKE_NIM = 100
const MIN_STAKE_LUNA = MIN_STAKE_NIM * 100000
const MIN_STAKE_COPY = 'Nimiq needs at least 100 NIM to open a stake.'
const MIN_REMAINDER_COPY = 'Your stake must stay ≥ 100 NIM'

// The public RPC rate-limits bursts and our own fetches time out; the 10s
// auto-refresh then retries and usually succeeds. Neither is a broken wallet,
// so neither belongs in the red alarm banner — and neither should reach the
// user as "RPC HTTP 429" or "The operation was aborted".
const NODE_BUSY_COPY = "Nimiq's public node is busy — retrying…"

// Shown when the Pay host reports no consensus yet. Deliberately a dim note,
// never a gate: NimBooks reads the chain over its own RPC, so a syncing host
// only affects what the *wallet* can sign — the books still load. One constant
// so the connect screen and the Overview can never word it differently.
const PAY_SYNCING_COPY = 'Nimiq Pay is still syncing — your wallet may look empty for a moment.'

function isTransientChainError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /\b429\b|too many requests|rate limit|abort|timed? ?out|timeout|network ?error|failed to fetch/i.test(
    msg
  )
}

// "submitted" only ever means "handed to the network" — don't claim more than
// the verification poll has actually established.
function txVerifyLabel(state: TxVerify | null): string {
  if (state === 'confirmed') return 'confirmed on chain ✓'
  if (state === 'unknown') return 'submitted — could not confirm, check History'
  return 'submitted — confirming…'
}

export default function App() {
  const [account, setAccount] = useState<WalletAccount | null>(null)
  // Nimiq Pay's sync state at connect time. `null` = not asked / not applicable
  // (Hub, demo, browser). Never gates the UI — see the note it renders.
  const [payConsensus, setPayConsensus] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [hubConnecting, setHubConnecting] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(30)
  const [nimBalance, setNimBalance] = useState<string | null>(null)
  const [nimTxs, setNimTxs] = useState<NimiqTx[]>([])
  // Staking rewards, synthesized as History rows (one per UTC day per
  // validator) from the v2 events API — the tx index doesn't carry them.
  const [rewardTxs, setRewardTxs] = useState<NimiqTx[]>([])
  const [htlcHoldings, setHtlcHoldings] = useState<HtlcHolding[]>([])
  // `address:txCount:newestHash` of the last successful HTLC + vesting sweep.
  // Both are pure functions of the tx list, so an unchanged key means the
  // holdings below are still current and the sweeps can be skipped entirely.
  const contractSweepRef = useRef<string | null>(null)
  const [stakingHolding, setStakingHolding] = useState<StakingHolding | null>(null)
  // Chain head, refreshed alongside the balances. Unstake steps are gated on
  // block height, not wall clock — 0 means "not known yet".
  const [currentBlock, setCurrentBlock] = useState<number>(0)
  const [vestingHoldings, setVestingHoldings] = useState<VestingHolding[]>([])
  const [evmBalances, setEvmBalances] = useState<EvmBalance[]>([])
  // Full rate table per asset — one entry per display currency, so switching
  // currency is instant and costs no extra request.
  const [fiat, setFiat] = useState<Record<RateAsset, FiatRates>>({
    nim: ZERO_RATES,
    usdt: { ...ZERO_RATES, usd: 1 },
    eth: ZERO_RATES,
    pol: ZERO_RATES,
  })
  const [currency, setCurrency] = useState<CurrencyCode>(loadCurrency)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DEVICE_ID_KEY)
    } catch {
      return null
    }
  })
  const [lang, setLang] = useState<string>('en')
  const [receipts, setReceipts] = useState<SignedReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [signingHash, setSigningHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showReceiptHelp, setShowReceiptHelp] = useState(false)
  const [showTypeHelp, setShowTypeHelp] = useState(false)
  const [visibleTxCount, setVisibleTxCount] = useState(50)
  const [statementYear, setStatementYear] = useState<string>('all')
  const [statement, setStatement] = useState<Statement | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  // Real-HTTPS download link for WebViews that can't save files (see downloadLink.ts).
  const [downloadLink, setDownloadLink] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  // Backup/restore modal: which half is showing, plus the two text buffers.
  const [backupMode, setBackupMode] = useState<'backup' | 'restore' | null>(null)
  const [backupJson, setBackupJson] = useState('')
  const [restoreText, setRestoreText] = useState('')
  const [invoices, setInvoices] = useState<StoredInvoice[]>([])
  const [amountInput, setAmountInput] = useState('')
  const [memoInput, setMemoInput] = useState('')
  const [expiryIdx, setExpiryIdx] = useState(0)
  const [shownQrId, setShownQrId] = useState<string | null>(null)
  const [stakeOpen, setStakeOpen] = useState(false)
  const [unstakeOpen, setUnstakeOpen] = useState(false)
  const [confirmUnstakeOpen, setConfirmUnstakeOpen] = useState(false)
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [unstaking, setUnstaking] = useState(false)
  const [unstakeError, setUnstakeError] = useState<string | null>(null)
  const [unstakeHash, setUnstakeHash] = useState<string | null>(null)
  const [unstakeVerify, setUnstakeVerify] = useState<TxVerify | null>(null)
  // The hash the verification poll is allowed to report on — a second submit
  // supersedes the first, and a stale poll must not overwrite its result.
  const unstakeVerifyRef = useRef<string | null>(null)
  // A retire-stake tx is submitted but only takes effect at the next election
  // block (~12h). Until the staker record reflects it, show it as pending.
  const [pendingUnstake, setPendingUnstake] = useState<{
    amountNim: number
    hash: string
    submittedAt: number
  } | null>(null)
  // Persist across reloads: the retire tx takes effect at the next election
  // block, which can be hours away — the pending state must survive a
  // WebView refresh. Scoped per address so a second account in the same
  // WebView never inherits the first one's pending marker.
  const pendingUnstakeKey = useMemo(
    () => pendingUnstakeKeyFor(account?.nimiqAddress),
    [account?.nimiqAddress]
  )
  // Loads once the account is known, not on mount — the key doesn't exist yet
  // before that. Re-runs on account switch, and clears when the new address
  // has no marker, so a pending retire never bleeds across accounts.
  useEffect(() => {
    if (!pendingUnstakeKey) return
    try {
      const raw = localStorage.getItem(pendingUnstakeKey)
      setPendingUnstake(raw ? JSON.parse(raw) : null)
    } catch {
      /* corrupt — ignore */
    }
  }, [pendingUnstakeKey])
  // Staking transactions are absent from the public address index, so the ones
  // this wallet sent are recorded locally and rendered as History rows from
  // here (see lib/stakingLog.ts). Address-scoped and reloaded on switch, like
  // the pending marker above.
  const [stakingLog, setStakingLog] = useState<StakingAction[]>([])
  useEffect(() => {
    const addr = account?.nimiqAddress
    setStakingLog(addr ? loadStakingLog(addr) : [])
  }, [account?.nimiqAddress])
  const [validators, setValidators] = useState<ValidatorInfo[]>([])
  const [validatorsLoading, setValidatorsLoading] = useState(false)
  const [validatorsError, setValidatorsError] = useState<string | null>(null)
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null)
  const [stakeAmount, setStakeAmount] = useState('')
  const [staking, setStaking] = useState(false)
  const [stakeError, setStakeError] = useState<string | null>(null)
  const [stakeHash, setStakeHash] = useState<string | null>(null)
  const [stakeVerify, setStakeVerify] = useState<TxVerify | null>(null)
  const stakeVerifyRef = useRef<string | null>(null)

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  const receiptsKey = useMemo(
    () => (account?.nimiqAddress ? `nimbooks:receipts:${account.nimiqAddress}` : 'nimbooks:receipts'),
    [account?.nimiqAddress]
  )

  // Soft failures (stale rates, a rate-limited node) go to the auto-dismissing
  // toast; only a failure that actually leaves the app unusable earns the red
  // banner, which on the connect screen also pushes the hero around.
  const reportSoftFailure = useCallback((e: unknown, fallback: string) => {
    setToast(isTransientChainError(e) ? NODE_BUSY_COPY : fallback)
  }, [])

  const fetchRates = useCallback(async () => {
    try {
      const all = await getAllFiatRates()
      setFiat({ nim: all.nim, usdt: all.usdt, eth: all.eth, pol: all.pol })
    } catch (e) {
      console.warn('Rate fetch failed:', e)
      reportSoftFailure(e, 'Live rates unavailable — showing cached values.')
    }
  }, [reportSoftFailure])

  useEffect(() => {
    setLang(getLanguage() ?? navigator.language.split('-')[0] ?? 'en')
    // Load rates from localStorage cache immediately (no flash of $0)
    const cached = readRates()
    setFiat((p) => ({
      nim: mergeRates(ZERO_RATES, cached.nim?.rates),
      usdt: mergeRates(p.usdt, cached.usdt?.rates),
      eth: mergeRates(ZERO_RATES, cached.eth?.rates),
      pol: mergeRates(ZERO_RATES, cached.pol?.rates),
    }))
    // Fetch fresh rates (single consolidated request)
    fetchRates()
  }, [fetchRates])

  // USD is the accounting currency: the CSV export and the tax-year statement
  // stay in USD whatever the user picked for display (see buildCsv).
  const rates = useMemo(
    () => ({ nim: fiat.nim.usd, usdt: fiat.usdt.usd, eth: fiat.eth.usd, pol: fiat.pol.usd }),
    [fiat]
  )
  // Display rates — the currency chosen by tapping the total value.
  const shown = useMemo(
    () => ({
      nim: fiat.nim[currency] ?? 0,
      usdt: fiat.usdt[currency] ?? 0,
      eth: fiat.eth[currency] ?? 0,
      pol: fiat.pol[currency] ?? 0,
    }),
    [fiat, currency]
  )

  const pickCurrency = useCallback((code: CurrencyCode) => {
    setCurrency(code)
    saveCurrency(code)
    setCurrencyOpen(false)
  }, [])

  // Toasts auto-dismiss after 4s (tap still dismisses immediately)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Load receipts scoped to the connected account
  useEffect(() => {
    if (!account?.nimiqAddress) return
    try {
      const saved = localStorage.getItem(receiptsKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          setReceipts(parsed.filter(isValidReceipt))
        }
      }
    } catch {
      setReceipts([])
    }
  }, [receiptsKey, account?.nimiqAddress])

  // Load payment requests scoped to the connected account
  useEffect(() => {
    if (!account?.nimiqAddress) return
    setInvoices(loadInvoices(account.nimiqAddress))
  }, [account?.nimiqAddress])

  // Auto-reconcile: a received transaction tagged `nimbooks:invoice:<id>`
  // marks that request paid without the user lifting a finger.
  useEffect(() => {
    if (!account?.nimiqAddress || invoices.length === 0 || nimTxs.length === 0) return
    let changed = false
    const next = invoices.map((inv) => {
      // `unpaidByUser` is the one thing that outranks the chain here: the
      // tagged tx never stops matching, so without it "Mark unpaid" would be
      // undone by this effect on its very next run.
      if (inv.paid || inv.unpaidByUser || inv.role !== 'payee') return inv
      const payee = inv.payee.replace(/\s+/g, '').toUpperCase()
      const match = nimTxs.find((t) => {
        if (t.executionResult === false) return false
        if (parseInvoiceMemo(decodeMemo(t.data)) !== inv.id) return false
        if (t.recipient.replace(/\s+/g, '').toUpperCase() !== payee) return false
        // Underpayments stay open — only a full payment settles the request.
        return /^\d+$/.test(String(t.value)) && BigInt(t.value) >= BigInt(inv.amountNim)
      })
      if (!match) return inv
      changed = true
      return { ...inv, paid: true, paidTxHash: match.hash, paidAt: match.timestamp ?? Date.now() }
    })
    if (changed) {
      setInvoices(next)
      saveInvoices(account.nimiqAddress, next)
    }
  }, [nimTxs, invoices, account?.nimiqAddress])

  const createInvoice = () => {
    if (!account?.nimiqAddress) return
    const luna = parseNimToLuna(amountInput)
    if (!luna) {
      setError('Enter an amount above 0 with at most 5 decimals (max 2,000,000,000 NIM).')
      return
    }
    const memo = memoInput.trim().slice(0, MAX_MEMO_CHARS)
    const expiry = EXPIRY_OPTIONS[expiryIdx]?.ms ?? null
    const now = Date.now()
    const invoice: StoredInvoice = {
      app: 'nimbooks',
      v: 1,
      id: newInvoiceId(),
      payee: account.nimiqAddress.replace(/\s+/g, '').toUpperCase(),
      amountNim: luna,
      ...(memo ? { memo } : {}),
      createdAt: now,
      ...(expiry ? { expiresAt: now + expiry } : {}),
      role: 'payee',
    }
    setInvoices(upsertInvoice(account.nimiqAddress, invoice))
    setAmountInput('')
    setMemoInput('')
    setShownQrId(invoice.id)
    setToast('Payment request created ✓')
  }

  const shareInvoice = async (invoice: StoredInvoice) => {
    const url = invoiceUrl(invoice)
    const amount = formatLunaExact(invoice.amountNim)
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'NimBooks payment request',
          text: `Payment request: ${amount} NIM${invoice.memo ? ` — ${invoice.memo}` : ''}`,
          url,
        })
        return
      }
    } catch (e) {
      // Share sheet cancelled — do NOT fall through to clipboard
      if (e instanceof Error && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast('Payment link copied!')
    } catch {
      setError('Could not copy link — open the request and copy it from the address bar.')
    }
  }

  const updateInvoices = (next: StoredInvoice[]) => {
    setInvoices(next)
    saveInvoices(account?.nimiqAddress, next)
  }

  const togglePaid = (id: string) => {
    updateInvoices(
      invoices.map((i) =>
        i.id === id
          ? i.paid
            ? { ...i, paid: false, paidAt: undefined, paidTxHash: undefined, unpaidByUser: true }
            : // Marking it paid again hands reconciliation back to the chain.
              { ...i, paid: true, paidAt: Date.now(), unpaidByUser: undefined }
          : i
      )
    )
  }

  const deleteInvoice = (id: string) => {
    updateInvoices(invoices.filter((i) => i.id !== id))
  }

  const connect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const acc = await connectWallet()
      // Recorded even when the connect turns up nothing: "still syncing" is
      // exactly the explanation for an empty result on this screen.
      setPayConsensus(acc.consensus ?? null)
      if (!acc.nimiqAddress && !acc.evmAddress) {
        setError('No wallet found. Open this app inside Nimiq Pay, or use the browser login below.')
        return
      }
      setAccount(acc)
      await refresh(acc)
    } catch (e) {
      setError('Connection failed: ' + (e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const connectWithHub = async () => {
    setHubConnecting(true)
    setError(null)
    try {
      const acc = await connectHub()
      setPayConsensus(acc.consensus ?? null)
      setAccount(acc)
      await refresh(acc)
    } catch (e) {
      setError('Browser login failed: ' + (e as Error).message)
    } finally {
      setHubConnecting(false)
    }
  }

  const connectDemo = async () => {
    setConnecting(true)
    setError(null)
    try {
      // Public mainnet address with real human activity — read-only demo mode.
      // (NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX: seeded story wallet —
      //  client payments, staking rewards, cooled-down unstaking. Funded + curated
      //  for the Sep 16 competition demo; read-only in app, keys held by owner.)
      const acc = connectDemoAccount('NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX')
      setPayConsensus(acc.consensus ?? null)
      setAccount(acc)
      await refresh(acc)
      setToast('Demo mode — read-only sample wallet.')
    } catch (e) {
      setError('Demo load failed: ' + (e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const refresh = async (acc: WalletAccount) => {
    setLoading(true)
    setError(null)
    try {
      if (acc.nimiqAddress) {
        const addr = acc.nimiqAddress
        // The balance is a single RPC call (~300ms); the history walk pages
        // through up to 1000 txs and takes seconds. Awaiting both together
        // left the flagship tile showing "…" for the whole walk, so the
        // balance is fired independently and lands as soon as it answers.
        void getNimiqBalance(addr)
          .then(setNimBalance)
          .catch((e) => {
            console.warn('Balance lookup failed:', e)
            reportSoftFailure(e, 'Balance unavailable right now — retrying.')
          })
        // Full history via cursor pagination (up to 1000 txs) — the 50-tx
        // cap silently truncated "accountant-ready" statements.
        const txs = await getNimiqTransactionHistory(addr, 1000)
        setNimTxs(txs)
        // Staker record and chain head come before the contract sweeps below:
        // the unstake banner is gated on both, and the sweeps are up to 20
        // paced RPC calls that would leave it waiting for nothing it needs.
        let freshHolding: StakingHolding | null = null
        try {
          freshHolding = await getStakingHolding(addr)
          setStakingHolding(freshHolding)
        } catch (e) {
          console.warn('Staking holding lookup failed:', e)
          setStakingHolding(null)
        }
        // Chain head — needed to tell whether a retire is already valid. Comes
        // from the Pay provider when there is one, otherwise the public RPC
        // (see wallet.getCurrentBlock). Best effort: an unknown height keeps
        // the previous one and the 10s auto-refresh picks it up next pass.
        const head = await getCurrentBlock()
        if (head !== null) setCurrentBlock(head)
        // Pending unstake resolution: the marker clears when the staker record
        // shows the retire took effect (inactive balance appeared, or active
        // dropped by the pending amount) — the chain flip is the only real
        // signal. A delayed election block must not silently drop the banner,
        // so the time bound is a generous 72h (6 epochs) backstop for a marker
        // that got stuck, nothing more.
        setPendingUnstake((prev) => {
          if (!prev) return prev
          const resolved =
            (freshHolding && Number(freshHolding.inactive) > 0) ||
            (freshHolding && Number(freshHolding.active) < prev.amountNim * 100000) ||
            Date.now() - prev.submittedAt > 72 * 60 * 60 * 1000
          if (resolved) {
            try {
              // Keyed off the account being refreshed, not the `account`
              // state — on first connect the state isn't set yet.
              const key = pendingUnstakeKeyFor(addr)
              if (key) localStorage.removeItem(key)
            } catch {
              /* ignore */
            }
            return null
          }
          return prev
        })
        // Swapped and vesting NIM sit outside the basic account, where the
        // plain balance can't see them — add each up separately.
        // Best effort: a failed lookup must not take the balance view down.
        //
        // Both sweeps are derived purely from the tx list (up to 10 paced RPC
        // calls each), so they can only change when that list does. Keying on
        // it turns the 10s auto-refresh from ~20 calls a tick into zero, and
        // stops "Locked in swaps" blinking out while the sweep re-runs.
        const sweepKey = `${addr}:${txs.length}:${txs[0]?.hash ?? ''}`
        if (contractSweepRef.current !== sweepKey) {
          let swept = true
          try {
            setHtlcHoldings(await getHtlcHoldings(addr, txs))
          } catch (e) {
            console.warn('HTLC holdings lookup failed:', e)
            swept = false
            setHtlcHoldings([])
          }
          try {
            setVestingHoldings(await getVestingHoldings(addr, txs))
          } catch (e) {
            console.warn('Vesting holdings lookup failed:', e)
            swept = false
            setVestingHoldings([])
          }
          // Only a clean sweep is worth remembering — a failed one must retry
          // on the next tick rather than cache its empty result.
          if (swept) contractSweepRef.current = sweepKey
        }
        // Reward income lives in a separate v2 API (the tx index has no
        // staking activity at all). Additive and already failure-tolerant —
        // a non-staker simply has none.
        try {
          const { fromMs, toMs } = restakeWindow()
          setRewardTxs(await getRestakeRewardTxs(addr, fromMs, toMs))
        } catch (e) {
          console.warn('Restake events lookup failed:', e)
          setRewardTxs([])
        }
      }
      if (acc.evmAddress) {
        const cached = evmBalanceCache.get(acc.evmAddress)
        if (cached && Date.now() - cached.at < EVM_CACHE_TTL) {
          setEvmBalances(cached.balances)
        } else {
          const evm = await getEvmBalances(acc.evmAddress)
          evmBalanceCache.set(acc.evmAddress, { at: Date.now(), balances: evm })
          setEvmBalances(evm)
        }
      }
    } catch (e) {
      // A rate-limited or timed-out refresh is not a broken connection: the
      // 10s auto-refresh is already retrying, so it stays out of the red
      // banner. Anything else is a real failure and keeps it.
      if (isTransientChainError(e)) setToast(NODE_BUSY_COPY)
      else setError('Refresh failed: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // One ledger for everything that counts as a transaction: indexed txs plus
  // the synthesized reward rows, newest first. History, the CSV and the
  // statement all read this, so they can never disagree about income.
  // (The balance trajectory in Analytics is the exception — see below.)
  const allTxs = useMemo(() => {
    if (rewardTxs.length === 0) return nimTxs
    return [...nimTxs, ...rewardTxs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  }, [nimTxs, rewardTxs])

  // History adds one more source on top: the staking actions this wallet sent.
  // They are real mined transactions, but no address list returns them (see
  // lib/stakingLog.ts), so without this the user unstakes and History shows
  // nothing. Deliberately *not* folded into `allTxs`: the CSV, the tax
  // statement and the balance trajectory all read that, and moving NIM between
  // your own staking buckets is not a fiat flow those should report.
  const historyTxs = useMemo(() => {
    const own = account?.nimiqAddress
    if (!own || stakingLog.length === 0) return allTxs
    // Should the index ever start returning these, the indexed row wins — it
    // carries the block data, and two rows would share a React key.
    const indexed = new Set(allTxs.map((t) => t.hash))
    const rows: NimiqTx[] = stakingLog
      .filter((a) => !indexed.has(a.hash))
      .map((a) => ({
        hash: a.hash,
        sender: own,
        recipient: STAKING_CONTRACT,
        value: String(Math.round(a.amountNim * 100000)),
        fee: '0',
        timestamp: a.at,
        executionResult: true,
        synthetic: a.kind,
      }))
    if (rows.length === 0) return allTxs
    return [...allTxs, ...rows].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  }, [allTxs, stakingLog, account?.nimiqAddress])

  // Luna locked in pending swaps — sits outside the basic account balance.
  const lockedLuna = useMemo(
    () => htlcHoldings.reduce((sum, h) => sum + (Number(h.balance) || 0), 0),
    [htlcHoldings]
  )
  // Delegated NIM, including the buckets on their way back out: inactive is
  // cooling down and retired is withdrawable, but both are still the user's.
  const stakedLuna =
    (Number(stakingHolding?.active) || 0) +
    (Number(stakingHolding?.inactive) || 0) +
    (Number(stakingHolding?.retired) || 0)
  const vestedLuna = useMemo(
    () => vestingHoldings.reduce((sum, v) => sum + (Number(v.balance) || 0), 0),
    [vestingHoldings]
  )
  const offBalanceLuna = lockedLuna + stakedLuna + vestedLuna
  const totalNimLuna = (Number(nimBalance) || 0) + offBalanceLuna

  const totalFiat = useMemo(() => {
    let total = 0
    if (nimBalance !== null)
      total += (((Number(nimBalance) || 0) + offBalanceLuna) / 100000) * shown.nim
    for (const b of evmBalances) {
      const val = Number(b.balance) / 10 ** b.decimals
      if (!Number.isFinite(val)) continue
      if (b.symbol === 'USDT') total += val * shown.usdt
      else if (b.symbol === 'POL') total += val * shown.pol
      else total += val * shown.eth
    }
    return Number.isFinite(total) ? total : 0
  }, [nimBalance, offBalanceLuna, evmBalances, shown])

  // Flag/label for the chip on the Total value tile. Falls back to the first
  // entry so a stale saved code can never blank the chip.
  const cur = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0]

  // --- Staking (Nimiq Pay) ---

  // The validator list is a 1.4 MB payload — 13× the whole gzipped bundle —
  // so it is fetched only when something actually renders from it, never just
  // because a wallet connected:
  //   - the stake panel is open (the picker needs the full list), or
  //   - this wallet has a delegation (the balance card resolves its name).
  // A connected non-staker who never opens the panel now pays nothing.
  // Cached 10 min in chain.ts, so reopening the panel is free.
  useEffect(() => {
    if (!account?.nimiqAddress || validators.length > 0) return
    if (!stakeOpen && !stakingHolding?.delegation) return
    let cancelled = false
    setValidatorsLoading(true)
    setValidatorsError(null)
    ;(async () => {
      try {
        const list = await getValidators()
        if (!cancelled) setValidators(list)
      } catch (e) {
        if (cancelled) return
        console.warn('Validator list failed:', e)
        setValidatorsError('Validator list unavailable right now — try again shortly.')
      } finally {
        if (!cancelled) setValidatorsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account?.nimiqAddress, stakeOpen, validators.length, stakingHolding?.delegation])

  // Escape closes whichever overlay is open — one handler for all of them, so
  // a new modal never ships without the key. (DetailSheet brings its own.)
  // The unstake confirmation sits on top of the stake modal, so it takes the
  // key first: one press should peel one layer, not the whole stack.
  useEffect(() => {
    const anyOpen =
      stakeOpen ||
      currencyOpen ||
      changelogOpen ||
      confirmUnstakeOpen ||
      !!downloadLink ||
      !!backupMode
    if (!anyOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmUnstakeOpen) {
        setConfirmUnstakeOpen(false)
        return
      }
      setStakeOpen(false)
      setCurrencyOpen(false)
      setChangelogOpen(false)
      setDownloadLink(null)
      setBackupMode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stakeOpen, currencyOpen, changelogOpen, confirmUnstakeOpen, downloadLink, backupMode])

  // A staker's delegation is fixed when the record is created, so an existing
  // stake locks the picker to that validator — adding stake can't move it.
  const hasStaker = !!stakingHolding
  const lockedDelegation = stakingHolding?.delegation ? cleanAddr(stakingHolding.delegation) : null
  const activeSelection = lockedDelegation ?? selectedValidator
  // Only a first stake needs a choice; adding to a staker reuses its delegation.
  const validatorChosen = hasStaker || !!selectedValidator
  const currentValidator = useMemo(
    () => validators.find((v) => cleanAddr(v.address) === lockedDelegation) ?? null,
    [validators, lockedDelegation]
  )
  const stakeAmountNim = Number(stakeAmount)
  // A first stake creates the staker record, and the protocol refuses to create
  // one below the 100 NIM minimum — the tx is rejected and never mines. Adding
  // to an existing record has no minimum.
  const stakeAmountValid =
    Number.isFinite(stakeAmountNim) &&
    stakeAmountNim > 0 &&
    (hasStaker || stakeAmountNim >= MIN_STAKE_NIM)
  // Slider ceiling: the liquid NIM balance (basic account) after parked HTLC
  // funds — staking spends only what the wallet is holding as spendable NIM.
  const stakeMaxLuna = Math.max(0, (Number(nimBalance) || 0) - lockedLuna)
  const stakeMaxNim = stakeMaxLuna / 100000

  const openStake = () => {
    setStakeError(null)
    setStakeHash(null)
    setStakeVerify(null)
    // A first stake can't be smaller than the minimum, and the slider floor is
    // set there — so open on that value rather than on a 0 the panel would
    // only reject (and which would leave a tap on the floor doing nothing).
    if (!stakingHolding && stakeMaxNim >= MIN_STAKE_NIM && !(stakeAmountNim >= MIN_STAKE_NIM)) {
      setStakeAmount(String(MIN_STAKE_NIM))
    }
    setStakeOpen(true)
  }

  // Watch a submitted stake tx until it shows up on chain. Fire-and-forget:
  // the panel stays usable while it runs, and a tx that never lands turns into
  // an error instead of a hash the user keeps waiting on.
  const verifyStakeTx = (hash: string) => {
    stakeVerifyRef.current = hash
    setStakeVerify('checking')
    void (async () => {
      const result = await waitForTxMined(hash, {
        intervalMs: TX_VERIFY_INTERVAL_MS,
        timeoutMs: TX_VERIFY_TIMEOUT_MS,
      })
      if (stakeVerifyRef.current !== hash) return // superseded by a newer submit
      setStakeVerify(result)
      if (result !== 'expired') return
      // 'unknown' is not a failure — the RPC never answered, so say only that.
      setStakeError(
        'Stake transaction was not mined — it never reached the chain. Please try again.'
      )
      setToast('Stake transaction was not mined ✗')
    })()
  }

  const submitStake = async () => {
    // No staker record yet → this transaction creates one, and that is the
    // only moment the validator can be chosen (and the only one with a
    // minimum amount).
    const firstStake = !stakingHolding
    if (!stakeAmountValid) {
      setStakeError(
        firstStake && stakeAmountNim > 0 && stakeAmountNim < MIN_STAKE_NIM
          ? MIN_STAKE_COPY
          : 'Enter an amount above 0.'
      )
      return
    }
    if (firstStake && !selectedValidator) {
      setStakeError('Choose a validator first.')
      return
    }
    setStaking(true)
    setStakeError(null)
    setStakeHash(null)
    setStakeVerify(null)
    try {
      const result = await stakeNim(firstStake ? selectedValidator : null, stakeAmountNim)
      if (!result.ok) {
        setStakeError(result.error)
        return
      }
      setStakeHash(result.hash)
      verifyStakeTx(result.hash)
      setStakeAmount('')
      clearTxCache() // the stake tx must show up on the next History load
      if (account) await refresh(account)
    } finally {
      setStaking(false)
    }
  }

  // Active stake can be retired into the cooldown right away; inactive is
  // cooling down; retired has finished cooling and can be withdrawn 1:1.
  // All three are "un-stakeable" from the user's perspective — the flows are
  // just different transactions.
  const retireableLuna = Number(stakingHolding?.active || 0)
  const inactiveLuna = Number(stakingHolding?.inactive || 0)
  const retiredLuna = Number(stakingHolding?.retired || 0)
  const maxUnstakeableLuna = retireableLuna + inactiveLuna + retiredLuna
  const unstakeMaxNim = maxUnstakeableLuna / 100000

  // Anything in flight out of stake, whichever way we can know about it. The
  // pre-election limbo is only knowable from the local marker (no chain field
  // and no event exposes a submitted retire), but everything after the
  // election block is readable straight off the staker record — so a lost or
  // never-written marker still gets a banner instead of silence.
  const unstakeActivity = useMemo(() => {
    if (pendingUnstake) {
      return {
        kind: 'pending' as const,
        amountNim: pendingUnstake.amountNim,
        hash: pendingUnstake.hash,
        submittedAt: pendingUnstake.submittedAt,
      }
    }
    const inactive = Number(stakingHolding?.inactive || 0)
    const retired = Number(stakingHolding?.retired || 0)
    if (inactive > 0) {
      // The retire tx only becomes valid one full reporting epoch after the
      // deactivation takes effect. Sending it before that is rejected outright
      // — the tx never mines and the state never moves, so the button has to
      // stay away until the chain head passes that height.
      const inactiveFrom = stakingHolding?.inactiveFrom || 0
      const retireValidAt = inactiveFrom > 0 ? inactiveFrom + BLOCKS_PER_EPOCH : 0
      const retireReady = retireValidAt > 0 && currentBlock >= retireValidAt
      return {
        kind: 'cooling' as const,
        amountNim: inactive / 100000,
        retireValidAt,
        retireReady,
      }
    }
    // `retired > 0` already means the retire took effect — withdraw needs no
    // further height gate.
    if (retired > 0) return { kind: 'ready' as const, amountNim: retired / 100000 }
    return null
  }, [pendingUnstake, stakingHolding, currentBlock])

  // Unstake timing (protocol): retire-stake takes effect at the NEXT election
  // block (epoch boundary, ~12h), then the reporting window (1 epoch, ~12h)
  // must pass before the funds become withdrawable. Worst case ≈ 2 epochs
  // (~24h); typical ≈ 1–2 epochs depending on where in the epoch you are.
  const unstakeEstimate = useMemo(() => {
    const now = Date.now()
    const epochMs = 12 * 60 * 60 * 1000
    // Next election block is at most one epoch away; add the reporting window.
    const worstMs = 2 * epochMs
    const worst = new Date(now + worstMs)
    return {
      worstLabel: worst.toLocaleDateString(lang, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      worstMs,
    }
  }, [lang])

  // Same watch for the unstake side, plus the pending marker: a retire that
  // never mined must not leave a banner counting down to an election block it
  // will never reach. Only a definitive "not found" clears it — an RPC that
  // never answered leaves the banner and its 72h backstop alone.
  //
  // `action` also records the leg in the local staking log, which is the only
  // place History can learn about it: submit writes the row unconfirmed so it
  // shows immediately, the poll flips it to confirmed, and a tx that never
  // reached the chain takes its row with it.
  const verifyUnstakeTx = (
    hash: string,
    action?: { kind: StakingActionKind; amountNim: number }
  ) => {
    const addr = account?.nimiqAddress
    if (action && addr) {
      const entry: StakingAction = { ...action, hash, at: Date.now(), confirmed: false }
      appendStakingAction(addr, entry)
      setStakingLog((prev) => [entry, ...prev.filter((a) => a.hash !== hash)])
    }
    unstakeVerifyRef.current = hash
    setUnstakeVerify('checking')
    void (async () => {
      const result = await waitForTxMined(hash, {
        intervalMs: TX_VERIFY_INTERVAL_MS,
        timeoutMs: TX_VERIFY_TIMEOUT_MS,
      })
      // The log update is keyed by hash, so it runs even when a newer submit
      // has taken over the panel's verification state — one unstake can send
      // two transactions (withdraw then deactivate), and the first one's row
      // must still resolve. 'unknown' leaves the row as submitted-not-confirmed.
      if (action && addr) {
        if (result === 'confirmed') {
          markStakingActionConfirmed(addr, hash)
          setStakingLog((prev) =>
            prev.map((a) => (a.hash === hash ? { ...a, confirmed: true } : a))
          )
        } else if (result === 'expired') {
          removeStakingAction(addr, hash)
          setStakingLog((prev) => prev.filter((a) => a.hash !== hash))
        }
      }
      if (unstakeVerifyRef.current !== hash) return // superseded by a newer submit
      setUnstakeVerify(result)
      if (result !== 'expired') return
      setPendingUnstake(null)
      try {
        if (pendingUnstakeKey) localStorage.removeItem(pendingUnstakeKey)
      } catch {
        /* ignore */
      }
      setUnstakeError(
        'Unstake transaction was not mined — it never reached the chain. Please try again.'
      )
      setToast('Unstake transaction was not mined ✗')
    })()
  }

  const submitUnstake = async () => {
    const amountNim = Number(unstakeAmount)
    if (!Number.isFinite(amountNim) || amountNim <= 0) {
      setUnstakeError('Enter an amount above 0.')
      return
    }
    if (amountNim * 100000 > maxUnstakeableLuna) {
      setUnstakeError(
        `You can unstake up to ${formatLuna(String(maxUnstakeableLuna), lang)} NIM.`
      )
      return
    }
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeHash(null)
    setUnstakeVerify(null)
    try {
      let remainingNim = amountNim
      // 1. Withdraw anything already fully cooled (retired → basic balance).
      //    `remove_stake` takes no amount: the protocol withdraws the whole
      //    retired balance or nothing (protocol.md — "Remove ALL retired
      //    funds; partial not allowed"). Asking for less than all of it used
      //    to send a tx for the smaller figure and get the full balance back.
      if (retiredLuna > 0 && remainingNim > 0) {
        const removeNim = retiredLuna / 100000
        const remove = await unstakeRemove(removeNim)
        if (!remove.ok) {
          setUnstakeError(remove.error)
          return
        }
        setUnstakeHash(remove.hash)
        verifyUnstakeTx(remove.hash, { kind: 'withdraw', amountNim: removeNim })
        if (removeNim > remainingNim) {
          setToast(
            "Withdrew your full retired balance (partial withdrawals aren't allowed on Nimiq)."
          )
        }
        // Clamped: withdrawing the whole retired balance can cover more than
        // was asked for, and the steps below only run on what's still owed.
        remainingNim = Math.max(0, remainingNim - removeNim)
      }
      // 2. Deactivate the rest of the ACTIVE stake (active → inactive). The
      //    protocol only retires *inactive* stake, so this — not retire — is
      //    the first step for live stake. `setActiveStake` sets an absolute
      //    balance, so pass what stays staked, not what leaves.
      if (remainingNim > 0 && retireableLuna > 0) {
        let deactivateLuna = Math.min(Math.round(remainingNim * 100000), retireableLuna)
        // A staker record may not sit below the 100 NIM minimum: leaving 40 NIM
        // active is rejected outright, so snap the deactivation down until the
        // remainder is exactly the minimum. Deactivating everything is fine —
        // that closes the record rather than shrinking it below the floor.
        const remainderLuna = retireableLuna - deactivateLuna
        let snapped = false
        if (remainderLuna > 0 && remainderLuna < MIN_STAKE_LUNA) {
          deactivateLuna = retireableLuna - MIN_STAKE_LUNA
          snapped = true
          if (deactivateLuna <= 0) {
            // The whole active balance is at or under the minimum — nothing
            // partial is legal here, only unstaking all of it.
            setUnstakeError(
              `${MIN_REMAINDER_COPY} — unstake the full ${formatLuna(String(retireableLuna), lang)} NIM instead.`
            )
            return
          }
          setToast(
            `${MIN_REMAINDER_COPY} — deactivating ${formatLuna(String(deactivateLuna), lang)} NIM instead.`
          )
        }
        const deactivateNim = deactivateLuna / 100000
        const deactivate = await unstakeDeactivate((retireableLuna - deactivateLuna) / 100000)
        if (!deactivate.ok) {
          setUnstakeError(deactivate.error)
          return
        }
        setUnstakeHash(deactivate.hash)
        // The deactivation only takes effect at the next election block (~12h)
        // — persist a pending marker so Overview/History can show it until the
        // staker record flips to inactive.
        const pending = { amountNim: deactivateNim, hash: deactivate.hash, submittedAt: Date.now() }
        setPendingUnstake(pending)
        try {
          if (pendingUnstakeKey) localStorage.setItem(pendingUnstakeKey, JSON.stringify(pending))
        } catch {
          /* storage full — in-memory only */
        }
        verifyUnstakeTx(deactivate.hash, { kind: 'deactivate', amountNim: deactivateNim })
        // When the amount was snapped to the minimum, the shortfall is staying
        // staked on purpose — it is not "still cooling down" (step 3), so it
        // must not be reported as such.
        remainingNim = snapped ? 0 : remainingNim - deactivateNim
      }
      // 3. Anything left is already cooling down (inactive). It still needs a
      //    retire transaction once the reporting window passes — that is the
      //    banner's finish action, not something this submit can send yet.
      if (remainingNim > 0) {
        setUnstakeError(
          `${formatLuna(String(remainingNim * 100000), lang)} NIM is already cooling down — finish it from the balance banner once the reporting window passes.`
        )
      }
      if (remainingNim < amountNim) {
        setUnstakeAmount('')
        clearTxCache()
        if (account) await refresh(account)
      }
    } finally {
      setUnstaking(false)
    }
  }

  // Step 2 of the unstake flow: inactive → retired, for the whole cooled-down
  // balance. Only valid once the deactivation took effect and the reporting
  // window passed — before that the provider rejects it and says so.
  const completeUnstake = async () => {
    if (inactiveLuna <= 0) return
    // Belt and braces: the banner already hides the button until the retire is
    // valid, but a click racing a refresh must not send a tx the chain will
    // reject (it would never mine, leaving the state untouched).
    const inactiveFrom = stakingHolding?.inactiveFrom || 0
    const retireValidAt = inactiveFrom > 0 ? inactiveFrom + BLOCKS_PER_EPOCH : 0
    if (retireValidAt > 0 && currentBlock < retireValidAt) return
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeHash(null)
    setUnstakeVerify(null)
    try {
      const retire = await unstakeRetire(inactiveLuna / 100000)
      if (!retire.ok) {
        setUnstakeError(retire.error)
        setToast(retire.error)
        return
      }
      setUnstakeHash(retire.hash)
      verifyUnstakeTx(retire.hash, { kind: 'retire', amountNim: inactiveLuna / 100000 })
      setToast('Retired — withdrawable after the reporting window ✓')
      clearTxCache()
      if (account) await refresh(account)
    } finally {
      setUnstaking(false)
    }
  }

  // Step 3: retired → basic balance, for the whole withdrawable balance.
  const withdrawRetired = async () => {
    if (retiredLuna <= 0) return
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeHash(null)
    setUnstakeVerify(null)
    try {
      const remove = await unstakeRemove(retiredLuna / 100000)
      if (!remove.ok) {
        setUnstakeError(remove.error)
        setToast(remove.error)
        return
      }
      setUnstakeHash(remove.hash)
      verifyUnstakeTx(remove.hash, { kind: 'withdraw', amountNim: retiredLuna / 100000 })
      setToast('Withdrawal submitted ✓')
      clearTxCache()
      if (account) await refresh(account)
    } finally {
      setUnstaking(false)
    }
  }

  const [countdown, setCountdown] = useState(10)
  const loadingRef = useRef(false)
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])
  // Auto-refresh: count down from 10s and refresh when it hits 0. Only for a
  // real connected wallet (demo mode stays manual to avoid pointless RPC load).
  useEffect(() => {
    if (!account?.nimiqAddress || isDemoMode()) return
    setCountdown(10)
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (!loadingRef.current) void refresh(account)
          return 10
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.nimiqAddress])

  const makeReceipt = async (tx: NimiqTx) => {
    if (!account?.nimiqAddress) return
    if (receipts.some((r) => r.txHash === tx.hash)) {
      setToast('Receipt already signed for this transaction.')
      return
    }
    try {
      setSigningHash(tx.hash)
      const receipt = await signReceipt(
        {
          app: 'nimbooks',
          v: 1,
          txHash: tx.hash,
          sender: tx.sender,
          recipient: tx.recipient,
          amount: tx.value,
          asset: 'NIM',
          timestamp: Math.floor((tx.timestamp ?? Date.now()) / 1000), // seconds in the signed payload
          memo: tx.data,
        },
        account.nimiqAddress // sign with the connected address — no address-selector step
      )
      if (!receipt) {
        setError('Signing cancelled — no signature returned.')
        return
      }
      // Fallback: if the returned public key doesn't bind to sender/recipient,
      // the receipt is still created but the verify page will flag it.
      const next = [receipt, ...receipts].slice(0, 50)
      setReceipts(next)
      try {
        localStorage.setItem(receiptsKey, JSON.stringify(next))
      } catch {
        /* storage full — keep in memory */
      }
      setToast('Receipt signed ✓')
    } catch (e) {
      console.error('signReceipt failed:', e)
      setError('Signing failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSigningHash(null)
    }
  }

  const shareReceipt = async (r: SignedReceipt) => {
    const enc = encodeReceipt(r)
    const url = `${window.location.origin}${window.location.pathname}#/verify/${enc}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NimBooks receipt', text: 'Verified payment receipt', url })
        return
      }
    } catch (e) {
      // User cancelled the share sheet — do NOT fall through to clipboard (would overwrite it)
      if (e instanceof Error && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast('Verification link copied!')
    } catch {
      setError('Could not copy link — long-press the URL in the address bar.')
    }
  }

  // Shared CSV row builder — one source of truth for export + copy.
  // Values stay in USD regardless of the display currency: an accountant's
  // ledger is denominated in one reporting currency, and every daily close in
  // lib/statement.ts is a USD close. The currency switcher is display only.
  const buildCsv = () => {
    if (!account?.nimiqAddress) return ''
    const own = account.nimiqAddress.replace(/\s+/g, '').toUpperCase()
    const rows = [
      ['timestamp', 'txHash', 'type', 'kind', 'sender', 'recipient', 'amountNIM', 'feeNIM', 'valueUSD_indicative', 'memo'],
      ...allTxs
        // Failed/reverted txs are not real transfers — exclude from statements
        .filter((t) => t.executionResult !== false)
        .map((t) => {
          const isOut = t.sender.replace(/\s+/g, '').toUpperCase() === own
          return [
            new Date(t.timestamp ?? Date.now()).toISOString(),
            t.hash,
            isOut ? 'sent' : 'received',
            txLabel(t, own),
            t.sender,
            t.recipient,
            (Number(t.value) / 100000).toFixed(5), // raw decimals — no locale separators (accounting-safe)
            (Number(t.fee) / 100000).toFixed(5),
            // No rate yet (cold cache, CoinGecko still in flight) means the
            // USD value is unknown, and an unknown value is blank — a column
            // of 0.000000 reads as "these transactions were worthless".
            rates.nim > 0 ? ((Number(t.value) / 100000) * rates.nim).toFixed(6) : '',
            decodeMemo(t.data) ?? '',
          ]
        }),
    ]
    return (
      '\uFEFF' + // UTF-8 BOM for Excel
      rows
        .map((r) => r.map((c) => `"${sanitizeCsvCell(c).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    )
  }

  // One source of truth for what each export is called and what it holds, so
  // the download, copy, and link paths can never drift apart.
  const csvExport = (kind: 'history' | 'statement'): { filename: string; csv: string } | null => {
    if (!account?.nimiqAddress) return null
    const tag = account.nimiqAddress.replace(/\s+/g, '').slice(0, 8)
    if (kind === 'history') {
      return { filename: `nimbooks-${tag}.csv`, csv: buildCsv() }
    }
    if (!statement) return null
    const label = statementYear === 'all' ? 'all-time' : statementYear
    return {
      filename: `nimbooks-statement-${label}-${tag}.csv`,
      csv: buildStatementCsv(statement, account.nimiqAddress),
    }
  }

  const downloadCsv = async (filename: string, csv: string) => {
    // Mobile-first: Web Share API with a real file (works in Android Chrome,
    // iOS Safari 15+, and most WebViews). Anchor-download silently no-ops in
    // many mobile WebViews (e.g. Nimiq Pay), so it is only a fallback.
    const file = new File([csv], filename, { type: 'text/csv;charset=utf-8' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return
      } catch (e) {
        // AbortError = user cancelled — that's fine, stop.
        if (e instanceof DOMException && e.name === 'AbortError') return
        // Anything else: fall through to the anchor download.
      }
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    // Keep the object URL alive long enough for slow mobile downloads; revoke
    // on pagehide as a safety net.
    const revoke = () => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    setTimeout(revoke, 10000)
    window.addEventListener('pagehide', revoke, { once: true })
    // No Nimiq Pay branch here: inside Pay both Export buttons render the
    // download-link route instead (getDownloadLink), so this function is only
    // ever reached on desktop/Hub, where the anchor works.
  }

  const exportCsv = () => {
    const e = csvExport('history')
    if (e) void downloadCsv(e.filename, e.csv)
  }

  const copyCsv = async () => {
    if (!account?.nimiqAddress) return
    try {
      await navigator.clipboard.writeText(buildCsv())
      setToast('CSV copied to clipboard!')
    } catch {
      setError('Could not copy CSV — use Download instead.')
    }
  }

  // Nimiq Pay's WebView cannot save files at all, so hand the user a real
  // HTTPS link (plus a QR for a second device) they can open in a browser
  // that does honour Content-Disposition.
  const getDownloadLink = async (kind: 'history' | 'statement') => {
    const e = csvExport(kind)
    if (!e || !e.csv) {
      setError('Nothing to export yet.')
      return
    }
    setLinkBusy(true)
    try {
      const link = await buildDownloadLink(e.csv, e.filename)
      if (!link) {
        // The link is the only working download route in Pay, so don't leave the
        // user empty-handed — put the CSV somewhere they can actually get at it.
        try {
          await navigator.clipboard.writeText(e.csv)
          setToast('CSV too large for a link — copied to clipboard instead ✓')
        } catch {
          setError('CSV too large for a link — use Copy CSV instead.')
        }
        return
      }
      setDownloadLink(link)
    } catch {
      setError('Could not build download link.')
    } finally {
      setLinkBusy(false)
    }
  }

  const disconnect = () => {
    disconnectWallet()
    setAccount(null)
    setPayConsensus(null)
    contractSweepRef.current = null
    setNimBalance(null)
    setNimTxs([])
    setRewardTxs([])
    setHtlcHoldings([])
    setStakingHolding(null)
    setVestingHoldings([])
    setEvmBalances([])
    setReceipts([])
    setError(null)
    setToast(null)
    setVisibleTxCount(50)
    setStatement(null)
    setStatementYear('all')
    setDownloadLink(null)
    setInvoices([])
    setAmountInput('')
    setMemoInput('')
    setShownQrId(null)
    setStakeOpen(false)
    setCurrencyOpen(false)
    setSelectedValidator(null)
    setStakeAmount('')
    setStakeError(null)
    setStakeHash(null)
    // Drop any in-flight verification: its result belongs to the old account.
    setStakeVerify(null)
    stakeVerifyRef.current = null
    setUnstakeHash(null)
    setUnstakeError(null)
    setUnstakeVerify(null)
    unstakeVerifyRef.current = null
    // The display currency is a device preference, not account data — it stays.
  }

  // Tax-year statement: recompute when txs / account / period change.
  // Prices load once (12h cache); the statement itself computes instantly.
  const statementYears = useMemo(() => availableStatementYears(allTxs), [allTxs])
  useEffect(() => {
    if (!account?.nimiqAddress || allTxs.length === 0) {
      setStatement(null)
      return
    }
    const own = account.nimiqAddress // narrowed; stable across the closure
    let cancelled = false
    setStatementLoading(true)
    ;(async () => {
      try {
        const prices = await getDailyNimPrices()
        if (cancelled) return
        setStatement(computeStatement(allTxs, own, statementYear, prices))
      } catch (e) {
        if (cancelled) return
        console.warn('Statement failed:', e)
        reportSoftFailure(e, 'Statement prices unavailable right now — try again shortly.')
        setStatement(null)
      } finally {
        if (!cancelled) setStatementLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account?.nimiqAddress, allTxs, statementYear, reportSoftFailure])

  const exportStatementCsv = () => {
    const e = csvExport('statement')
    if (e) void downloadCsv(e.filename, e.csv)
  }

  const requestDeviceId = async () => {
    if (deviceId) return
    try {
      const id = await getDeviceId()
      if (id) {
        setDeviceId(id)
        try {
          localStorage.setItem(DEVICE_ID_KEY, id)
        } catch {
          /* storage unavailable — session-only */
        }
        // Seed the now-available device-scoped key with what's on screen —
        // otherwise the first read falls back to the legacy key and rewrites it.
        saveCurrency(currency)
        setToast('Device preferences enabled — settings are saved to this device.')
      } else {
        setError('Device preferences unavailable — this works inside Nimiq Pay.')
      }
    } catch (e) {
      setError('Device preferences unavailable: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const openBackup = () => {
    const file = exportBackup()
    setBackupJson(JSON.stringify(file, null, 2))
    setBackupMode('backup')
  }

  const openRestore = () => {
    setRestoreText('')
    setBackupMode('restore')
  }

  const runRestore = () => {
    const file = validateBackup(restoreText)
    if (!file) {
      setError("That doesn't look like a NimBooks backup — paste the whole file, braces included.")
      return
    }
    const total = Object.keys(file.keys).length
    if (total === 0) {
      setError('That backup is empty — there was nothing stored when it was taken.')
      return
    }
    const { restored } = importBackup(file)
    if (restored === 0) {
      setError('Everything in that backup is already on this device — nothing to restore.')
      return
    }
    setBackupMode(null)
    setToast(`Restored ${restored} of ${total} items — reloading…`)
    // Currency, theme and the device ID are all read once at mount, so the
    // restored values only take effect on a fresh load. Delayed so the count
    // is actually readable before the page goes.
    setTimeout(() => window.location.reload(), 1200)
  }

  // Both headers carry the version badge, and the connect screen returns early —
  // so the modal is built once here and rendered in each tree.
  const changelogModal = changelogOpen && (
    <div className="modal-overlay" onClick={() => setChangelogOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Changelog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>NimBooks changelog</h2>
          <button className="btn-ghost" onClick={() => setChangelogOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        {CHANGELOG.map((entry) => (
          <div key={entry.version} className="changelog-entry">
            <div className="changelog-version">
              v{entry.version} <span className="changelog-date">{entry.date}</span>
            </div>
            <ul>
              {entry.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )

  const versionBadge = (
    <button
      className="version-badge"
      onClick={() => setChangelogOpen(true)}
      title="What's new in NimBooks"
      aria-label="Version and changelog"
    >
      {APP_VERSION_LABEL}
    </button>
  )

  if (!account) {
    // One path per device — see lib/device.ts for the detection rules.
    const inNimiqPay = isInNimiqPay()
    const isMobile = isMobileDevice()
    return (
      <div className="app">
        <header className="hero">
          <div className="hero-actions">
            {versionBadge}
            <button
              className="btn-ghost theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
          <div className="logo">📒</div>
          <h1>NimBooks</h1>
          <p className="tagline">The books for your Nimiq wallet.</p>
        </header>
        <main className="connect-panel">
          {inNimiqPay ? (
            <>
              <button className="btn-primary" onClick={connect} disabled={connecting || hubConnecting}>
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </button>
              <p className="hint">Connect your Nimiq wallet to start keeping the books.</p>
              {payConsensus === false && <p className="hint small dim">{PAY_SYNCING_COPY}</p>}
              <div className="connect-divider">or</div>
            </>
          ) : isMobile ? (
            <>
              <a
                className="btn-primary btn-link"
                href={NIMIQ_PAY_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Nimiq Pay →
              </a>
              <p className="hint">
                NimBooks runs inside the Nimiq Pay app — that's where your NIM wallet lives. Tap it
                on your phone.
              </p>
            </>
          ) : (
            <>
              <button className="btn-primary" onClick={connectWithHub} disabled={connecting || hubConnecting}>
                {hubConnecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
              </button>
              <p className="hint">
                Sign in with your Nimiq wallet right here in the browser — no app needed.
              </p>
            </>
          )}
          <button className="btn-ghost-lg" onClick={connectDemo} disabled={connecting || hubConnecting}>
            Try with a sample wallet
          </button>
          <ul className="feature-list">
            <li>Balance &amp; history with live fiat values — 37 currencies</li>
            {/* Staking is signed by the injected Pay provider, so the browser
                and mobile-web paths can read it but never send it — say so
                here rather than in the stake panel the user has yet to open. */}
            <li>Stake, unstake &amp; track rewards{!inNimiqPay && ' (in Nimiq Pay)'}</li>
            <li>Payment requests (invoices) that settle on-chain</li>
            <li>Signed receipts — verifiable proof of payment</li>
            <li>Tax-ready CSV statements &amp; exports</li>
          </ul>
          {error && <p className="error">{error}</p>}
          {/* Soft warnings (stale rates, a busy node) land in the toast, which
              this screen has no room for — a dim note carries them instead. */}
          {toast && !error && <p className="hint small">{toast}</p>}
        </main>
        {changelogModal}
      </div>
    )
  }

  const demoMode = isDemoMode()
  const inNimiqPay = isInNimiqPay()

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo small">📒</div>
        <h1>NimBooks</h1>
        {versionBadge}
        <button
          className="btn-ghost"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="btn-ghost"
          onClick={openStake}
          disabled={demoMode}
          title={demoMode ? 'Demo mode is read-only' : 'Stake'}
          aria-label="Stake"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.52-4.48 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
        </button>
        <button className="btn-ghost refresh-btn" onClick={() => refresh(account)} disabled={loading} title="Refresh" aria-label="Refresh">
          {loading ? (
            <span className="spin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </span>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          )}
          {!demoMode && account?.nimiqAddress && !loading && (
            <span className="refresh-countdown">{countdown}</span>
          )}
        </button>
        <button className="btn-ghost" onClick={disconnect} title="Disconnect wallet" aria-label="Disconnect wallet">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v10" />
            <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
          </svg>
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert" onClick={() => setError(null)}>
          {error} <span className="dismiss" aria-hidden="true">✕</span>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        <button
          className={view === 'dashboard' ? 'tab active' : 'tab'}
          aria-current={view === 'dashboard' ? 'page' : undefined}
          onClick={() => setView('dashboard')}
        >
          Overview
        </button>
        <button
          className={view === 'history' ? 'tab active' : 'tab'}
          aria-current={view === 'history' ? 'page' : undefined}
          onClick={() => setView('history')}
        >
          History
        </button>
        <button
          className={view === 'receipts' ? 'tab active' : 'tab'}
          aria-current={view === 'receipts' ? 'page' : undefined}
          onClick={() => setView('receipts')}
        >
          Receipts
        </button>
        <button
          className={view === 'request' ? 'tab active' : 'tab'}
          aria-current={view === 'request' ? 'page' : undefined}
          onClick={() => setView('request')}
        >
          Request
        </button>
        <button
          className={view === 'export' ? 'tab active' : 'tab'}
          aria-current={view === 'export' ? 'page' : undefined}
          onClick={() => setView('export')}
        >
          Export
        </button>
      </nav>

      <main>
        {view === 'dashboard' && (
          <section className="dashboard">
            <div className="stat-row">
              <div className="card total">
                <div className="total-header">
                  <span className="label">Total value</span>
                  {/* Visible affordance for the currency picker — the value
                      itself used to be the (invisible) button. */}
                  <button
                    type="button"
                    className="currency-chip"
                    onClick={() => setCurrencyOpen(true)}
                    title="Change display currency"
                  >
                    <img
                      className="chip-flag"
                      src={`/flags/flag-${cur.flag}.svg`}
                      alt=""
                      width={16}
                      height={16}
                    />
                    <span className="chip-code">{currency.toUpperCase()}</span>
                    {/* Inline SVG, not a Unicode chevron — the glyph tofus on
                        some Android builds. */}
                    <svg
                      className="chip-caret"
                      viewBox="0 0 10 6"
                      width={10}
                      height={6}
                      aria-hidden="true"
                    >
                      <path
                        d="M1 1l4 4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                <span className="value">{formatFiat(totalFiat, currency)}</span>
              </div>

              <div className="card nim-tile">
                <span className="label">NIM balance</span>
                {nimBalance === null ? (
                  <span className="value dim">…</span>
                ) : (
                  <>
                    <span className="value">{formatLuna(String(totalNimLuna), lang)} NIM</span>
                    <span className="sub">
                      ≈ {formatFiat((totalNimLuna / 100000) * shown.nim, currency, 4)}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Connected, but the wallet host hasn't caught up and there is
                nothing on screen yet — say why rather than let it read as an
                empty wallet. Nothing is gated on this. */}
            {payConsensus === false && totalNimLuna === 0 && allTxs.length === 0 && (
              <p className="hint small dim">{PAY_SYNCING_COPY}</p>
            )}

            {unstakeActivity && (
              <div className="pending-unstake-banner" role="status">
                <span className="pending-dot" aria-hidden="true" />
                <span className="banner-text">
                  {unstakeActivity.kind === 'pending' && (
                    <>
                      Deactivating {formatLuna(String(unstakeActivity.amountNim * 100000), lang)}{' '}
                      NIM — takes effect at the next election block (up to ~12h), then a
                      reporting window before it's withdrawable.
                    </>
                  )}
                  {unstakeActivity.kind === 'cooling' && (
                    <>
                      {formatLuna(String(unstakeActivity.amountNim * 100000), lang)} NIM is
                      cooling down — finish the unstake after the reporting window.
                    </>
                  )}
                  {unstakeActivity.kind === 'ready' && (
                    <>
                      {formatLuna(String(unstakeActivity.amountNim * 100000), lang)} NIM is
                      ready to withdraw — move it to your balance.
                    </>
                  )}
                </span>
                {unstakeActivity.kind === 'cooling' &&
                  (unstakeActivity.retireReady ? (
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => void completeUnstake()}
                      disabled={!canStake() || staking || unstaking}
                    >
                      {unstaking ? 'Submitting…' : 'Complete unstake'}
                    </button>
                  ) : (
                    // No button before the retire is valid — the chain would
                    // reject the tx, so a click here is a dead click.
                    <span className="banner-hint">
                      {unstakeActivity.retireValidAt > 0 && currentBlock > 0
                        ? `Complete unstake available in ~${Math.ceil(
                            ((unstakeActivity.retireValidAt - currentBlock) * SECONDS_PER_BLOCK) /
                              3600,
                          )}h`
                        : 'Complete unstake available after the reporting window'}
                    </span>
                  ))}
                {unstakeActivity.kind === 'ready' && (
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => void withdrawRetired()}
                    disabled={!canStake() || staking || unstaking}
                  >
                    {unstaking ? 'Submitting…' : 'Withdraw'}
                  </button>
                )}
              </div>
            )}

            {/* Swapped, staked and vesting funds are still the user's — break
                the total down so a 0 basic balance doesn't read as "no money".
                With nothing off-balance the tile above is the whole story. */}
            {nimBalance !== null && offBalanceLuna > 0 && (
              <div className="card">
                <span className="label">Balance details</span>
                <div className="balance-breakdown">
                  <div className="row">
                    <span>Available</span>
                    <span>{formatLuna(nimBalance, lang)} NIM</span>
                  </div>
                  {lockedLuna > 0 && (
                    <div className="row">
                      <span>Locked in swaps</span>
                      <span>{formatLuna(String(lockedLuna), lang)} NIM</span>
                    </div>
                  )}
                  {retireableLuna > 0 && (
                    <div className="row">
                      <span>
                        Staked
                        {currentValidator?.name && (
                          <span className="delegate-to">
                            {' '}
                            → {currentValidator.name}
                          </span>
                        )}
                        {!currentValidator?.name && lockedDelegation && (
                          <span className="delegate-to">
                            {' '}
                            → {lockedDelegation.slice(0, 12)}…
                          </span>
                        )}
                      </span>
                      <span>{formatLuna(String(retireableLuna), lang)} NIM</span>
                    </div>
                  )}
                  {inactiveLuna > 0 && (
                    <div className="row unstaking-row">
                      <span>Unstaking (cooling down)</span>
                      <span>{formatLuna(String(inactiveLuna), lang)} NIM</span>
                    </div>
                  )}
                  {retiredLuna > 0 && (
                    <div className="row unstaking-row">
                      <span>Ready to withdraw</span>
                      <span>{formatLuna(String(retiredLuna), lang)} NIM</span>
                    </div>
                  )}
                  {vestedLuna > 0 && (
                    <div className="row">
                      <span>Vesting</span>
                      <span>{formatLuna(String(vestedLuna), lang)} NIM</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {evmBalances.length > 0 && (
              <div className="card">
                <span className="label">EVM assets</span>
                {evmBalances
                  .filter((b) => Number.isFinite(Number(b.balance)) && Number(b.balance) > 0)
                  .map((b) => (
                    <div key={b.chainId + b.symbol} className="row">
                      <span>
                        {b.symbol} · {b.chainName}
                      </span>
                      <span>{formatUnits(b.balance, b.decimals, lang)}</span>
                    </div>
                  ))}
                {evmBalances.every((b) => !(Number.isFinite(Number(b.balance)) && Number(b.balance) > 0)) && (
                  <span className="sub">No EVM balances found</span>
                )}
              </div>
            )}

            <div className="card">
              <span className="label">Addresses</span>
              {account.nimiqAddress && (() => {
                const addr = account.nimiqAddress
                return (
                  <button
                    type="button"
                    className="addr"
                    title="Tap to copy full address"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(addr)
                        setToast('NIM address copied!')
                      } catch {
                        // Fallback for browsers without async clipboard (older mobile)
                        try {
                          const ta = document.createElement('textarea')
                          ta.value = addr
                          ta.style.position = 'fixed'
                          ta.style.opacity = '0'
                          document.body.appendChild(ta)
                          ta.select()
                          document.execCommand('copy')
                          document.body.removeChild(ta)
                          setToast('NIM address copied!')
                        } catch {
                          setError('Could not copy — long-press the address instead.')
                        }
                      }
                    }}
                  >
                    NIM: {addr}
                  </button>
                )
              })()}
              {account.evmAddress && (() => {
                const addr = account.evmAddress
                return (
                  <button
                    type="button"
                    className="addr"
                    title="Tap to copy full address"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(addr)
                        setToast('EVM address copied!')
                      } catch {
                        // Fallback for browsers without async clipboard (older mobile)
                        try {
                          const ta = document.createElement('textarea')
                          ta.value = addr
                          ta.style.position = 'fixed'
                          ta.style.opacity = '0'
                          document.body.appendChild(ta)
                          ta.select()
                          document.execCommand('copy')
                          document.body.removeChild(ta)
                          setToast('EVM address copied!')
                        } catch {
                          setError('Could not copy — long-press the address instead.')
                        }
                      }
                    }}
                  >
                    EVM: {addr}
                  </button>
                )
              })()}
            </div>

            {/* A wallet that has never transacted has nothing to chart, and a
                grid of zeros above an empty frame reads as "this app is
                broken". Say what to do instead. Gated on `loading` so it can't
                flash during the first fetch, and on consensus so a wallet that
                is merely still syncing isn't told its books are empty — that
                case already has its own note above. */}
            {!loading && payConsensus !== false && allTxs.length === 0 && (
              <div className="card empty-books">
                <svg
                  viewBox="0 0 24 24"
                  className="empty-books-glyph"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v13H5.5A1.5 1.5 0 0 0 4 18.5z" />
                  <path d="M4 18.5A1.5 1.5 0 0 0 5.5 20H19v-3" />
                  <path d="M8 8.5h7M8 12h4" />
                </svg>
                <h3>Your books start here</h3>
                <ul className="empty-books-steps">
                  <li>
                    <strong>Receive some NIM.</strong> Send NIM to your address above — it appears
                    here automatically, no import step.
                  </li>
                  <li>
                    <strong>Create a payment request.</strong> A link or QR your customer can pay,
                    reconciled against your history the moment it lands.
                    <button className="btn-secondary" onClick={() => setView('request')}>
                      New payment request
                    </button>
                  </li>
                  <li>
                    <strong>Stake 100 NIM to start earning.</strong> Delegate to a validator and
                    the rewards show up as income.
                    {canStake() ? (
                      <button className="btn-secondary" onClick={() => setStakeOpen(true)}>
                        Stake NIM
                      </button>
                    ) : (
                      ' (in Nimiq Pay)'
                    )}
                  </li>
                </ul>
              </div>
            )}

            {/* Raw indexed txs only: restaked rewards compound into the
                staking contract and never touch the basic balance, so feeding
                them to a trajectory anchored on the current basic balance
                would rewrite history by the reward total. */}
            <Analytics
              txs={nimTxs}
              currentBalanceNim={nimBalance}
              ownAddress={account.nimiqAddress ?? null}
              period={analyticsPeriod}
              onPeriodChange={setAnalyticsPeriod}
              onOpenHistory={() => setView('history')}
              lang={lang}
              nimRate={shown.nim}
              currency={currency}
            />
          </section>
        )}

        {view === 'history' && (
          <section className="history">
            <div className="section-head">
              <h2>NIM transactions</h2>
              <div className="help-toggles">
                <button className="btn-link-inline" onClick={() => setShowTypeHelp((v) => !v)}>
                  {showTypeHelp ? 'Hide' : 'What are these types?'}
                </button>
                <button className="btn-link-inline" onClick={() => setShowReceiptHelp((v) => !v)}>
                  {showReceiptHelp ? 'Hide' : 'What is a signed receipt?'}
                </button>
              </div>
            </div>
            {showTypeHelp && (
              <div className="card help-card">
                <p>
                  <strong>Basic transfer</strong> — a normal payment between two wallets. Money
                  moves straight from sender to recipient.
                </p>
                <p>
                  <strong>Swap (HTLC)</strong> — an atomic swap. Your wallet locks funds in a
                  contract; the counterparty claims them with a secret, or they refund to you
                  after the timeout. Nimiq Pay routes some transfers through these — while
                  locked, the funds are still yours. This is normal, not a drainer.
                </p>
                <p>
                  <strong>Stake / Unstake</strong> — you delegated NIM to a validator, or withdrew
                  it. Staked NIM lives in the staking contract rather than your basic balance —
                  NimBooks counts it in the balance card.
                </p>
                <p>
                  <strong>Vesting</strong> — time-locked funds that release on a schedule.
                </p>
                <p>
                  <strong>Reward</strong> — validator payouts on your stake. These are paid every
                  few minutes and restaked automatically, so NimBooks sums them into one row per
                  day per validator. They come from a separate staking index that closes each UTC
                  day, so today's rewards appear tomorrow, and the last 90 days are covered.
                </p>
              </div>
            )}
            {showReceiptHelp && (
              <div className="card help-card">
                <p>
                  A signed receipt is a shareable proof-of-payment. NimBooks signs the
                  transaction details with your wallet key, then anyone can verify them on a
                  public page: the signature is checked, the signer must be the sender or
                  recipient, and the transaction is cross-checked on the Nimiq chain.
                </p>
                <p className="hint small">
                  Forged, reverted, or non-existent transactions fail verification.
                </p>
              </div>
            )}
            {/* Only the pre-election limbo gets a synthetic History row — it
                has a tx hash and a submit time to show. Cooling/ready are
                states, not transactions, and the staker-record note below
                already reports them. */}
            {unstakeActivity?.kind === 'pending' && (
              <div className="tx pending-tx">
                <div className="tx-main">
                  <span className="out">
                    ▼ unstaking
                    <span className="tx-kind unstake"> · pending</span>
                  </span>
                  <span className="tx-amount">
                    {formatLuna(String(unstakeActivity.amountNim * 100000), lang)} NIM
                  </span>
                </div>
                <div className="tx-sub">
                  Deactivating · submitted{' '}
                  {new Date(unstakeActivity.submittedAt).toLocaleString(lang)} · takes effect at
                  the next election block (up to ~12h) ·{' '}
                  <span className="mono">{unstakeActivity.hash.slice(0, 10)}…</span>
                </div>
              </div>
            )}
            {stakingHolding && (Number(stakingHolding.active) > 0 || Number(stakingHolding.inactive) > 0 || Number(stakingHolding.retired) > 0) && (
              <p className="hint small stake-history-note">
                Stake and unstake transactions are not exposed by the public chain index, so
                only the unstake actions you sent from this device appear below (reward payouts
                do too, one row per day) — your staker record is live:{' '}
                <strong>
                  {formatLuna(stakingHolding.active, lang)} NIM active
                  {Number(stakingHolding.inactive) > 0 &&
                    ` · ${formatLuna(stakingHolding.inactive, lang)} NIM cooling down`}
                  {Number(stakingHolding.retired) > 0 &&
                    ` · ${formatLuna(stakingHolding.retired, lang)} NIM withdrawable`}
                </strong>
              </p>
            )}
            {loading && historyTxs.length === 0 && <p className="empty">Loading transactions…</p>}
            {!loading && historyTxs.length === 0 && (
              <p className="empty">No transactions found for this address.</p>
            )}
            {historyTxs.slice(0, visibleTxCount).map((tx) => {
              const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === account.nimiqAddress?.replace(/\s+/g, '').toUpperCase()
              const label = txLabel(tx, account.nimiqAddress ?? '')
              const memo = decodeMemo(tx.data)
              const demo = isDemoMode()
              // Two kinds of synthesized row, and they differ in exactly one
              // way that matters here: a staking action is a real transaction
              // the index just doesn't list, so its hash opens in the explorer;
              // a reward rollup has no hash at all.
              const stakingAction = tx.synthetic
                ? STAKING_ACTION_LABEL[tx.synthetic as StakingActionKind]
                : undefined
              const isReward = !!tx.synthetic && !stakingAction
              // Reward rows are a daily rollup of restaking events, so the
              // payer's name takes the place of the missing hash link.
              const validator = isReward
                ? (validators.find((v) => cleanAddr(v.address) === cleanAddr(tx.sender))?.name ??
                  `${tx.sender.slice(0, 14)}…`)
                : null
              // Recorded at submit; the verification poll flips it. Until then
              // the row must not claim more than "handed to the network".
              const stakingUnconfirmed =
                !!stakingAction && stakingLog.some((a) => a.hash === tx.hash && !a.confirmed)
              return (
                <div key={tx.hash} className="tx">
                  <div className="tx-main">
                    <span className={isOut ? 'out' : 'in'}>
                      {stakingAction ? `▼ ${stakingAction}` : isOut ? '▼ sent' : '▲ received'}
                      {stakingAction ? (
                        <span className={`tx-kind ${tx.synthetic}`}> · {tx.synthetic}</span>
                      ) : (
                        isLabelledTxKind(label) && (
                          <span className={`tx-kind ${label}`}> · {label}</span>
                        )
                      )}
                    </span>
                    <span className="tx-amount">{formatLuna(tx.value, lang)} NIM</span>
                  </div>
                  <div className="tx-sub">
                    {tx.timestamp ? new Date(tx.timestamp).toLocaleString(lang) : '—'} ·{' '}
                    {isReward ? (
                      <span className="tx-synthetic">{validator} · restaked, daily total</span>
                    ) : (
                      <a
                        className="tx-hash-link"
                        href={explorerTxUrl(tx.hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tx.hash.slice(0, 10)}…
                      </a>
                    )}
                    {stakingAction && (
                      <span className="tx-synthetic">
                        {' '}
                        · staking{stakingUnconfirmed ? ', confirming…' : ''}
                      </span>
                    )}
                    {tx.executionResult === false && <span className="tx-failed"> · failed</span>}
                  </div>
                  {memo && <div className="tx-memo">memo: {memo}</div>}
                  {!tx.synthetic && (
                    <button
                      className="btn-small"
                      onClick={() => makeReceipt(tx)}
                      disabled={
                        demo ||
                        receipts.some((r) => r.txHash === tx.hash) ||
                        signingHash === tx.hash
                      }
                      title={demo ? 'Demo mode is read-only — connect your wallet to sign receipts.' : undefined}
                    >
                      {signingHash === tx.hash
                        ? 'Signing…'
                        : receipts.some((r) => r.txHash === tx.hash)
                          ? '✓ Signed'
                          : demo
                            ? 'Sign receipt (demo)'
                            : 'Sign receipt'}
                    </button>
                  )}
                </div>
              )
            })}
            {historyTxs.length > visibleTxCount && (
              <button
                className="btn-ghost-lg"
                onClick={() => setVisibleTxCount((c) => c + 100)}
              >
                Load more ({historyTxs.length - visibleTxCount} remaining)
              </button>
            )}
          </section>
        )}

        {view === 'receipts' && (
          <section className="receipts">
            <h2>Signed receipts</h2>
            {receipts.length === 0 && (
              <p className="empty">
                No receipts yet. Go to History and tap "Sign receipt" on a transaction to create
                a shareable proof-of-payment.
              </p>
            )}
            {receipts.map((r) => (
              <div key={r.txHash} className="receipt">
                <div className="tx-main">
                  <span>
                    {formatLuna(r.amount, lang)} {r.asset}
                  </span>
                  <span className="ok">✓ signed</span>
                </div>
                <div className="tx-sub">
                  {r.txHash.slice(0, 12)}… · {new Date(r.timestamp * 1000).toLocaleDateString(lang)}
                </div>
                <button className="btn-small" onClick={() => shareReceipt(r)}>
                  Share verification link
                </button>
              </div>
            ))}
          </section>
        )}

        {view === 'request' && (
          <section className="request">
            <h2>Request payment</h2>
            <p className="hint">
              Create a payment request, share the link or QR, and NimBooks marks it paid as soon
              as the tagged transaction lands on-chain.
            </p>

            <div className="card invoice-form">
              <label className="label" htmlFor="invoiceAmount">
                Amount (NIM)
              </label>
              <input
                id="invoiceAmount"
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              {amountInput.trim() !== '' && !parseNimToLuna(amountInput) && (
                <span className="hint small warn">
                  Enter a positive amount with at most 5 decimals (max 2,000,000,000 NIM).
                </span>
              )}

              <label className="label" htmlFor="invoiceMemo">
                What for (optional)
              </label>
              <input
                id="invoiceMemo"
                className="input"
                type="text"
                maxLength={MAX_MEMO_CHARS}
                autoComplete="off"
                placeholder="Invoice #42"
                value={memoInput}
                onChange={(e) => setMemoInput(e.target.value)}
              />
              <span className="hint small">
                {memoInput.length}/{MAX_MEMO_CHARS} · travels in the request link; the payment
                itself carries the request reference.
              </span>

              <label className="label" htmlFor="invoiceExpiry">
                Expires
              </label>
              <select
                id="invoiceExpiry"
                className="select"
                value={expiryIdx}
                onChange={(e) => setExpiryIdx(Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((o, i) => (
                  <option key={o.label} value={i}>
                    {o.label}
                  </option>
                ))}
              </select>

              <button
                className="btn-primary"
                onClick={createInvoice}
                disabled={!account.nimiqAddress || !parseNimToLuna(amountInput)}
              >
                Create request
              </button>
            </div>

            <h2>Your requests</h2>
            {invoices.length === 0 && (
              <p className="empty">
                No payment requests yet. Create one above, then share the link — the payer settles
                it in one tap.
              </p>
            )}
            {invoices.map((inv) => {
              const st = invoiceStatus(inv)
              const stLabel = { pending: 'Open', paid: 'Paid', expired: 'Expired' }[st]
              return (
                <div key={inv.id} className="invoice-item">
                  <div className="tx-main">
                    <span className="tx-amount">{formatLunaExact(inv.amountNim)} NIM</span>
                    <span className={`invoice-pill ${st}`}>{stLabel}</span>
                  </div>
                  <div className="tx-sub">
                    {inv.role === 'payer' ? 'paid by you' : 'requested'} ·{' '}
                    {new Date(inv.createdAt).toLocaleDateString(lang)}
                    {inv.expiresAt &&
                      ` · ${st === 'expired' ? 'expired' : 'expires'} ${new Date(
                        inv.expiresAt
                      ).toLocaleDateString(lang)}`}
                  </div>
                  {inv.memo && <div className="tx-memo">{inv.memo}</div>}
                  {inv.paidTxHash && (
                    <div className="tx-sub">
                      <a
                        className="tx-hash-link"
                        href={explorerTxUrl(inv.paidTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {inv.paidTxHash.slice(0, 10)}…
                      </a>
                    </div>
                  )}
                  <div className="invoice-actions">
                    <button className="btn-small" onClick={() => shareInvoice(inv)}>
                      Share link
                    </button>
                    <button
                      className="btn-small"
                      onClick={() => setShownQrId(shownQrId === inv.id ? null : inv.id)}
                    >
                      {shownQrId === inv.id ? 'Hide QR' : 'QR'}
                    </button>
                    {inv.role === 'payee' && (
                      <button className="btn-small" onClick={() => togglePaid(inv.id)}>
                        {inv.paid ? 'Mark unpaid' : 'Mark paid'}
                      </button>
                    )}
                    <button className="btn-small danger" onClick={() => deleteInvoice(inv.id)}>
                      Delete
                    </button>
                  </div>
                  {shownQrId === inv.id && (
                    <div className="invoice-qr">
                      <QrCode value={invoiceUrl(inv)} size={180} />
                      <p className="hint small">Scan to open this payment request.</p>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {view === 'export' && (
          <section className="export">
            <h2>Export</h2>
            <p className="hint">
              Download your NIM transaction history as CSV — ready for your accountant or tax
              records.
            </p>
            {/* Pay's WebView can't save files at all, so the link route replaces
                the (silently dead) direct download there. Desktop/Hub users
                already get a real download and keep it. */}
            {inNimiqPay ? (
              <button
                className="btn-primary"
                onClick={() => void getDownloadLink('history')}
                disabled={allTxs.length === 0 || linkBusy}
              >
                {linkBusy ? 'Building link…' : `Download via link (${allTxs.length} transactions)`}
              </button>
            ) : (
              <button className="btn-primary" onClick={exportCsv} disabled={allTxs.length === 0}>
                Download CSV ({allTxs.length} transactions)
              </button>
            )}
            <button className="btn-secondary" onClick={copyCsv} disabled={allTxs.length === 0}>
              Copy CSV to clipboard
            </button>

            <div className="card statement-card">
              <span className="label">Tax-year statement</span>
              <p className="hint small">
                Daily closes at CoinGecko UTC prices, aggregated per day — received, sent, fees,
                rewards, and net NIM with USD values. Failed transactions excluded.
              </p>
              {statementYears.length > 0 && (
                <div className="statement-controls">
                  <label className="hint small" htmlFor="statementYear">
                    Period
                  </label>
                  <select
                    id="statementYear"
                    className="select"
                    value={statementYear}
                    onChange={(e) => setStatementYear(e.target.value)}
                  >
                    <option value="all">All time</option>
                    {statementYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {statementLoading && <p className="empty">Building statement…</p>}
              {!statementLoading && statement && (
                <>
                  <div className="statement-summary">
                    <div className="row">
                      <span>Received</span>
                      <span>
                        {statement.totals.receivedNim.toFixed(5)} NIM
                        {statement.totals.receivedUsd !== null &&
                          ` · $${statement.totals.receivedUsd.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="row">
                      <span>Sent + fees</span>
                      <span>
                        {(statement.totals.sentNim + statement.totals.feeNim).toFixed(5)} NIM
                        {/* feeUsd is accumulated per day at that day's close,
                            like sentUsd — so Received − (Sent + fees) is
                            exactly the Net below, to the cent. */}
                        {statement.totals.sentUsd !== null &&
                          ` · $${(statement.totals.sentUsd + (statement.totals.feeUsd ?? 0)).toFixed(2)}`}
                      </span>
                    </div>
                    <div className="row">
                      <span>Rewards</span>
                      <span>{statement.totals.rewardsNim.toFixed(5)} NIM</span>
                    </div>
                    <div className="row strong">
                      <span>Net</span>
                      <span>
                        {statement.totals.netNim.toFixed(5)} NIM
                        {statement.totals.netUsd !== null && ` · $${statement.totals.netUsd.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="row">
                      <span>Transactions</span>
                      <span>{statement.totals.txCount}</span>
                    </div>
                  </div>
                  <div className="statement-actions">
                    {inNimiqPay ? (
                      <button
                        className="btn-primary"
                        onClick={() => void getDownloadLink('statement')}
                        disabled={linkBusy}
                      >
                        {linkBusy ? 'Building link…' : `Download via link (${statement.period})`}
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={exportStatementCsv}>
                        Download statement CSV ({statement.period})
                      </button>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        if (!account?.nimiqAddress || !statement) return
                        try {
                          await navigator.clipboard.writeText(
                            buildStatementCsv(statement, account.nimiqAddress)
                          )
                          setToast('Statement CSV copied to clipboard!')
                        } catch {
                          setError('Could not copy statement — use Download instead.')
                        }
                      }}
                    >
                      Copy CSV
                    </button>
                  </div>
                </>
              )}
              {!statementLoading && !statement && allTxs.length === 0 && (
                <p className="hint small">No transactions loaded yet — statements appear here.</p>
              )}
            </div>

            <div className="card backup-card">
              <span className="label">Backup &amp; restore</span>
              <p className="hint small">
                Your books are yours — take them out any time. Receipts, payment requests, the
                staking log and your preferences live on this device only, so a cleared cache
                takes them with it.
              </p>
              <button className="btn-secondary" onClick={openBackup}>
                Back up my data
              </button>
              <button className="btn-secondary" onClick={openRestore}>
                Restore from backup
              </button>
            </div>

            <button className="btn-secondary" onClick={requestDeviceId}>
              {deviceId ? `Device: ${deviceId.slice(0, 12)}…` : 'Enable device preferences'}
            </button>
          </section>
        )}
      </main>

      {changelogModal}

      {downloadLink && (
        <div className="modal-overlay" onClick={() => setDownloadLink(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="CSV download link"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Download link</h2>
              <button className="btn-ghost" onClick={() => setDownloadLink(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="hint">
              Nimiq Pay can't save files directly — open this link in your phone's browser (or scan
              the QR with another device) to download the CSV.
            </p>
            <textarea
              className="input download-link"
              readOnly
              rows={3}
              value={downloadLink}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="CSV download link"
            />
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(downloadLink)
                  setToast('Download link copied — open it in your browser to save the file ✓')
                } catch {
                  setError('Could not copy the link — select it above and copy manually.')
                }
              }}
            >
              Copy link
            </button>
            {/* The whole CSV rides in the URL, so long exports outgrow what a
                camera can resolve. Show the QR only while it stays scannable. */}
            {downloadLink.length <= 1200 ? (
              <div className="invoice-qr">
                <QrCode value={downloadLink} size={220} label="Scan to download CSV" />
                <p className="hint small">Scan to download CSV</p>
              </div>
            ) : (
              <p className="hint small">
                This export is too long for a scannable QR code — copy the link instead.
              </p>
            )}
            <p className="hint small">
              The link carries the CSV itself, compressed. Nothing is stored on a server.
            </p>
          </div>
        </div>
      )}

      {/* Text in, text out — no download, no clipboard permission, no host
          file API. That is the one route that works identically in Pay's
          WebView, in Safari and on desktop. */}
      {backupMode && (
        <div className="modal-overlay" onClick={() => setBackupMode(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={backupMode === 'backup' ? 'Back up your data' : 'Restore from backup'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{backupMode === 'backup' ? 'Back up your data' : 'Restore from backup'}</h2>
              <button className="btn-ghost" onClick={() => setBackupMode(null)} aria-label="Close">
                ✕
              </button>
            </div>

            {backupMode === 'backup' ? (
              <>
                <p className="hint">
                  Your books are yours — take them out any time. Copy this and keep it somewhere
                  safe; paste it back into Restore on any device to bring them along.
                </p>
                <textarea
                  className="input download-link"
                  readOnly
                  rows={8}
                  value={backupJson}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Backup data"
                />
                <button
                  className="btn-primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(backupJson)
                      setToast('Backup copied — paste it somewhere safe ✓')
                    } catch {
                      setError('Could not copy — select the text above and copy it manually.')
                    }
                  }}
                >
                  Copy backup
                </button>
                <p className="hint small">
                  Receipts, payment requests, the staking log and your preferences. Prices and
                  transaction history are left out — those come back from the chain on their own.
                </p>
              </>
            ) : (
              <>
                <p className="hint">
                  Paste a backup below. Anything already on this device is kept as-is — a restore
                  fills in what's missing, it never overwrites your current books.
                </p>
                <textarea
                  className="input download-link"
                  rows={8}
                  value={restoreText}
                  onChange={(e) => setRestoreText(e.target.value)}
                  placeholder='{"app":"nimbooks","version":1,…}'
                  aria-label="Backup data to restore"
                />
                <button className="btn-primary" onClick={runRestore} disabled={!restoreText.trim()}>
                  Restore
                </button>
                <p className="hint small">
                  NimBooks reloads afterwards so the restored preferences take effect.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {currencyOpen && (
        <div className="modal-overlay" onClick={() => setCurrencyOpen(false)}>
          <div
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label="Display currency"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Display currency</h2>
              <button className="btn-ghost" onClick={() => setCurrencyOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="currency-grid" role="radiogroup" aria-label="Display currency">
              {CURRENCIES.map((c) => (
                // Buttons rather than <input type="radio">: tapping the tile
                // that is already selected has to dismiss the sheet too, and a
                // radio fires no change event for that.
                <button
                  key={c.code}
                  type="button"
                  role="radio"
                  aria-checked={c.code === currency}
                  className={c.code === currency ? 'currency-tile selected' : 'currency-tile'}
                  onClick={() => pickCurrency(c.code)}
                >
                  <span className="currency-flag" aria-hidden="true">
                    <img
                      src={`/flags/flag-${c.flag}.svg`}
                      alt=""
                      loading="lazy"
                      width={28}
                      height={28}
                    />
                  </span>
                  <span className="currency-code">{c.label}</span>
                </button>
              ))}
            </div>
            <p className="hint small">
              Display only — CSV exports and the tax-year statement stay in USD.
            </p>
          </div>
        </div>
      )}

      {stakeOpen && (
        <div className="modal-overlay" onClick={() => setStakeOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Stake NIM"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Stake NIM</h2>
              <button className="btn-ghost" onClick={() => setStakeOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="stake-status">
              <span className="label">Your stake</span>
              {stakingHolding && stakedLuna > 0 ? (
                <>
                  <span className="value">{formatLuna(String(stakedLuna), lang)} NIM</span>
                  <span className="sub">
                    →{' '}
                    {currentValidator?.name ??
                      (lockedDelegation ? `${lockedDelegation.slice(0, 12)}…` : 'unknown validator')}
                  </span>
                  {currentValidator && currentValidator.reliability === null && (
                    <p className="hint small warn">
                      This validator is not producing rewards right now.
                    </p>
                  )}
                </>
              ) : (
                <span className="value dim">No active stake</span>
              )}
            </div>

            {!inNimiqPay ? (
              <>
                <p className="hint">
                  Staking is signed by your wallet, so it runs in the Nimiq Pay app. Open NimBooks
                  there to delegate your NIM.
                </p>
                <a
                  className="btn-primary btn-link"
                  href={NIMIQ_PAY_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Nimiq Pay →
                </a>
              </>
            ) : (
              <>
                <span className="label stake-section">Validator</span>
                {hasStaker && (
                  <p className="hint small">
                    Your stake is already delegated — adding to it keeps the same validator.
                  </p>
                )}
                {validatorsLoading && validators.length === 0 && (
                  <p className="empty">Loading validators…</p>
                )}
                {validatorsError && <p className="hint small warn">{validatorsError}</p>}
                {validators.length > 0 && (
                  <div className="option-list validator-list" role="radiogroup" aria-label="Validator">
                    {validators.map((v) => {
                      const addr = cleanAddr(v.address)
                      const fee = formatValidatorFee(v.fee)
                      const reliability = formatValidatorReliability(v.reliability)
                      const reward = formatValidatorReward(v.annualReward)
                      return (
                        <button
                          key={addr}
                          type="button"
                          role="radio"
                          aria-checked={activeSelection === addr}
                          disabled={hasStaker || v.reliability === null}
                          onClick={() => setSelectedValidator(addr)}
                          className={[
                            'option-row',
                            activeSelection === addr ? 'selected' : '',
                            v.reliability === null ? 'inactive' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className="option-dot" aria-hidden="true" />
                          {/* Logos ride along on the payload we already paid
                              for. Decorative: the name below is the label. */}
                          {v.logo && (
                            <img
                              className="validator-logo"
                              src={v.logo}
                              alt=""
                              aria-hidden="true"
                              width={28}
                              height={28}
                              loading="lazy"
                              style={v.accentColor ? { background: v.accentColor } : undefined}
                            />
                          )}
                          <span className="option-main">
                            <strong>{v.name}</strong>
                            <span className="option-meta">
                              {reward ? reward : 'yield n/a'}
                              {fee ? ` · fee ${fee}` : ''}
                              {reliability ? ` · reliability ${reliability}` : ''}
                            </span>
                            {v.reliability === null && (
                              <span className="badge inactive">
                                inactive — not producing rewards
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                <label className="label stake-section" htmlFor="stakeAmount">
                  Amount (NIM)
                </label>
                {stakeMaxNim > 0 ? (
                  <>
                    <div className="stake-slider-row">
                      <input
                        id="stakeAmount"
                        className="stake-slider"
                        type="range"
                        // A first stake can't legally be smaller than the
                        // minimum, so the slider doesn't offer it — unless the
                        // wallet can't reach it, where the floor would lock
                        // the slider to a value it can't fund.
                        min={!hasStaker && stakeMaxNim >= MIN_STAKE_NIM ? MIN_STAKE_NIM : 0}
                        max={stakeMaxNim}
                        step={0.1}
                        value={Math.min(stakeAmountNim, stakeMaxNim)}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        aria-label="Stake amount"
                      />
                      <span className="stake-slider-value">
                        {stakeAmountValid ? stakeAmountNim.toLocaleString(lang) : '0'} NIM
                        {stakeMaxNim > 0 && (
                          <span className="stake-pct">
                            {' '}
                            ({Math.round((stakeAmountNim / stakeMaxNim) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="hint small">
                      {stakeAmountValid
                        ? `≈ ${formatFiat(stakeAmountNim * shown.nim, currency)} · ${Math.round(
                            stakeAmountNim * 100000
                          ).toLocaleString(lang)} Luna`
                        : !hasStaker && stakeMaxNim < MIN_STAKE_NIM
                          ? `${MIN_STAKE_COPY} This wallet holds ${formatLuna(String(stakeMaxLuna), lang)} NIM.`
                          : `Available to stake: ${formatLuna(String(stakeMaxLuna), lang)} NIM`}
                    </span>
                  </>
                ) : (
                  <div className="stake-empty">
                    <p className="hint small">
                      {hasStaker
                        ? `Your ${formatLuna(String(retireableLuna), lang)} NIM is already staked — staked NIM can't be re-staked. To stake more, send NIM to this address first:`
                        : 'No spendable NIM in this wallet to stake. Send NIM to this address first:'}
                    </p>
                    <p className="mono stake-empty-addr">{account?.nimiqAddress}</p>
                    <button
                      className="btn-small"
                      onClick={() => {
                        if (account?.nimiqAddress) {
                          navigator.clipboard?.writeText(account.nimiqAddress).catch(() => {})
                        }
                      }}
                    >
                      Copy address
                    </button>
                  </div>
                )}

                {stakeError && <p className="hint small warn">{stakeError}</p>}
                {stakeHash && stakeVerify !== 'expired' && (
                  <p className="hint small ok">
                    Stake {txVerifyLabel(stakeVerify)}{' '}
                    <span className="mono">{stakeHash.slice(0, 20)}…</span>
                  </p>
                )}

                <button
                  className="btn-primary stake-submit"
                  onClick={submitStake}
                  disabled={!canStake() || staking || !stakeAmountValid || !validatorChosen}
                >
                  {staking ? 'Submitting…' : hasStaker ? 'Add to stake' : 'Stake'}
                </button>
                {hasStaker && (
                  <>
                    <button
                      className="btn-ghost unstake-toggle"
                      onClick={() => setUnstakeOpen((v) => !v)}
                      disabled={!canStake() || staking || unstaking}
                    >
                      {unstakeOpen ? 'Hide unstake' : 'Unstake'}
                    </button>
                    {unstakeOpen && (
                      <div className="unstake-box">
                        <span className="label stake-section">Unstake (NIM)</span>
                        <div className="stake-slider-row">
                          <input
                            id="unstakeAmount"
                            className="stake-slider"
                            type="range"
                            min={0}
                            max={unstakeMaxNim}
                            step={0.1}
                            value={Math.min(Number(unstakeAmount), unstakeMaxNim)}
                            onChange={(e) => setUnstakeAmount(e.target.value)}
                            aria-label="Unstake amount"
                          />
                          <span className="stake-slider-value">
                            {unstakeAmount ? Number(unstakeAmount).toLocaleString(lang) : '0'} NIM
                            {unstakeMaxNim > 0 && (
                              <span className="stake-pct">
                                {' '}
                                ({Math.round((Number(unstakeAmount) / unstakeMaxNim) * 100)}%)
                              </span>
                            )}
                          </span>
                        </div>
                        <span className="hint small">
                          {inactiveLuna > 0
                            ? `${formatLuna(String(inactiveLuna), lang)} NIM cooling down — finish it from the balance banner after the reporting window.`
                            : 'Unstake deactivates active stake into a cooldown; after the reporting window you retire it, then withdraw it.'}
                          {retiredLuna > 0 &&
                            ` ${formatLuna(String(retiredLuna), lang)} NIM already withdrawable.`}
                        </span>
                        {unstakeError && <p className="hint small warn">{unstakeError}</p>}
                        {unstakeHash && unstakeVerify !== 'expired' && (
                          <p className="hint small ok">
                            Unstake {txVerifyLabel(unstakeVerify)}{' '}
                            <span className="mono">{unstakeHash.slice(0, 20)}…</span>
                          </p>
                        )}
                        <button
                          className="btn-primary stake-submit"
                          onClick={() => setConfirmUnstakeOpen(true)}
                          disabled={!canStake() || unstaking || !(Number(unstakeAmount) > 0)}
                        >
                          {unstaking ? 'Submitting…' : 'Unstake'}
                        </button>
                        {confirmUnstakeOpen && (
                          <div className="confirm-overlay" onClick={() => setConfirmUnstakeOpen(false)}>
                            <div
                              className="confirm-dialog"
                              role="dialog"
                              aria-modal="true"
                              aria-label="Confirm unstake"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <h3 className="confirm-title">Confirm unstake</h3>
                              <p className="confirm-amount">
                                {Number(unstakeAmount).toLocaleString(lang)} NIM
                              </p>
                              <p className="hint small">
                                Your stake stops earning at the next election block (~12h). It
                                becomes withdrawable after the reporting window — by{' '}
                                <strong>{unstakeEstimate.worstLabel}</strong> at the latest
                                (up to ~24h, depending on where the epoch boundary falls — and
                                longer if your validator is jailed).
                              </p>
                              <p className="hint small">
                                You'll need two more transactions once it has cooled down —
                                both are one tap from the balance banner.
                              </p>
                              <div className="confirm-actions">
                                <button
                                  className="btn-ghost"
                                  onClick={() => setConfirmUnstakeOpen(false)}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="btn-primary"
                                  onClick={() => {
                                    setConfirmUnstakeOpen(false)
                                    void submitUnstake()
                                  }}
                                >
                                  Confirm unstake
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <p className="hint small">Switching validator is coming soon.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

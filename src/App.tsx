import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import './App.css'
import HeroBackground from './HeroBackground'
import Iqon from './Iqon'
import HistoryProgress from './components/HistoryProgress'
import { warmLightClient } from './lib/lightHistory'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'
import {
  connectWallet,
  connectHub,
  connectDemoAccount,
  disconnectWallet,
  getConnectedAccount,
  getHubRedirectError,
  getSavedSessionView,
  hasRestorableSession,
  restoreWalletSession,
  saveSessionView,
  isDemoMode,
  canSend,
  canStake,
  prepareHubStaking,
  stopHubStakingPrep,
  sendNim,
  errorText,
  TxOutcomeUnknownError,
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
  CASHLINK_ACTIVE_LIMIT,
  loadCashlinks,
  removeCashlink,
  saveCashlink,
  updateCashlink,
  type StoredCashlink,
} from './lib/cashlinkStore'
import {
  cashlinkCoreReady,
  cashlinkShareUrl,
  isCashlinkMemo,
  newCashlink,
  prepareCashlinkCore,
  sweepCashlink,
  FUNDING_DATA,
  type CashlinkResultView,
} from './lib/cashlink'
import {
  getNimiqBalance,
  getHtlcHoldings,
  getHtlcInTransit,
  getRemoteAccountBalance,
  getContractAccount,
  getNimiqTransactions,
  getStakingHolding,
  peekCachedValidators,
  getVestingHoldings,
  getNimiqTransactionHistory,
  refreshTransactionHead,
  fetchStakingHolding,
  sameStakingHolding,
  sameTxList,
  getNimiqExtendedTransactionHistory,
  historyHitCap,
  findSentTx,
  encodeMemo,
  waitForTxMined,
  getEvmBalances,
  getAllFiatRates,
  getValidators,
  clearTxCache,
  formatLuna,
  formatUnits,
  formatFiat,
  currencySymbol,
  hasRate,
  WALLET_CURRENCIES,
  TAX_CURRENCIES,
  formatValidatorFee,
  formatValidatorReward,
  formatValidatorReliability,
  isPinnedValidator,
  isLabelledTxKind,
  txLabel,
  decodeMemo,
  explorerTxUrl,
  loadCurrency,
  saveCurrency,
  CURRENCIES,
  PINNED_VALIDATOR_ADDRESS,
  STAKING_CONTRACT,
  timestampToMs,
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
import { planUnstake } from './lib/unstakePlan'
import { readFxCached, type PriceChainResult } from './lib/prices'
import { isArchivedContract, ownFundedContracts, syncContractArchive } from './lib/payContracts'
import { isValidNimiqAddress } from './lib/portfolio'
import Portfolio from './Portfolio'
import { isGrantedAddress, stakeGateStatus } from './lib/stakeGate'
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
  invoiceMemo,
  invoiceRoute,
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
import { buildStakeLink, parseStakeLink, type StakeLinkIntent } from './lib/stakeLink'
import { DEMO_WALLET_ADDRESS, seedDemoData } from './lib/demoData'
import { getAllRestakeRewardTxs } from './lib/stakingEvents'
import {
  isInNimiqPay,
  isMobileDevice,
  isNimiqPayUserAgent,
  isPhoneOrTablet,
  NIMIQ_PAY_APP_URL,
  payDeepLink,
  siteLink,
} from './lib/device'
import { dialogFocus } from './lib/dialogFocus'
import { shortenUrl } from './lib/shorten'
import { buildDownloadLink, buildShortExportLink } from './lib/downloadLink'
import { exportBackup, importBackup, validateBackup } from './lib/backup'
import { APP_VERSION_LABEL, CHANGELOG } from './lib/changelog'
import QrCode from './QrCode'
import { DONATION_ADDRESS, DONATION_MEMO } from './lib/support'
import Analytics, { type AnalyticsPeriod } from './Analytics'
import InfoIcon from './InfoIcon'
import Confetti from './Confetti'
import TourHost from './TourHost'
import Landing, { PhoneQr } from './Landing'
import type { SampleEntry } from './lib/features'
import { COUNT_NOTICE, consentFromLanding, getCountConsent, setCountConsent, type CountConsent } from './lib/connectCount'
import { markBackedUp, markUnbackedChange, needsBackup } from './lib/backupNudge'
import { typicalRate, compoundsFor, projectStake } from './lib/yieldCalc'
import { payoutScheduleLabel, restakeGainNim, restakeReminder, stakeTerms } from './lib/earnTerms'
import { rewardsByValidator, rewardsSince, stakeNudge as pickStakeNudge, trailingYield } from './lib/earnInsights'
import { splitHtlcFlows } from './lib/htlcFlows'
import {
  HISTORY_FILTERS,
  filterHistory,
  groupRewardsByMonth,
  hasInternalTransfers,
  historyCounts,
  historyDirection,
  historySummary,
  type HistoryCtx,
  type HistoryFilter,
} from './lib/historyFilter'
import EarnCard from './EarnCard'
import YieldCalculator from './YieldCalculator'
import { setUiMode, useUiMode } from './lib/uiMode'

// The "New look (beta)": the whole beta shell (the house shadcn layout, the
// overview and the yield calculator) lives behind a dynamic import from
// App.tsx, so classic sessions (the default) never download Tailwind, Radix or
// the kit. The classic screen inside is the Suspense fallback while the chunk
// loads.
const BetaShell = lazy(() => import('./beta').then((m) => ({ default: m.BetaShell })))
const BetaOverview = lazy(() => import('./beta').then((m) => ({ default: m.BetaOverview })))
const BetaYieldCalculator = lazy(() =>
  import('./beta').then((m) => ({ default: m.BetaYieldCalculator }))
)
import {
  advanceNext,
  dismissOffer,
  FEEDBACK_TELEGRAM_URL,
  offerTour,
  skipTour,
  startTour,
  type TourRuntimeState,
} from './lib/tour'
import {
  availableStatementYears,
  buildStatementCsv,
  computeStatement,
  getDailyNimPrices,
  liveClosingBalanceNim,
  type Statement,
} from './lib/statement'
import { computeFifoGains, getAllDailyNimPrices, type TaxReport } from './lib/tax'
import { buildTaxTransactionsCsv, buildTaxSummaryCsv, TAX_FORMAT_LABELS, type TaxFormat } from './lib/taxCsv'

type View = 'dashboard' | 'history' | 'receipts' | 'request' | 'export'

const VIEWS: View[] = ['dashboard', 'history', 'receipts', 'request', 'export']

function isView(value: string | null): value is View {
  return !!value && (VIEWS as string[]).includes(value)
}

/**
 * Scrolls to a `data-learn` anchor and lights it briefly. The screen is still
 * filling in when the sample wallet lands (statements and portfolio data arrive
 * above the anchor and push it down), so the anchor is re-checked for a few
 * seconds and put back if it drifted. A touch, a wheel or a key press ends that,
 * so the reader keeps control of the page.
 */
function scrollToLearnTarget(target: string): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const started = Date.now()
  let timer = 0
  let anchored = false
  const stop = () => {
    window.clearTimeout(timer)
    window.removeEventListener('wheel', stop)
    window.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', stop)
  }
  window.addEventListener('wheel', stop, { passive: true })
  window.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', stop)
  const settle = () => {
    const el = document.querySelector<HTMLElement>(`[data-learn="${target}"]`)
    if (!el) {
      if (Date.now() - started < 3000) timer = window.setTimeout(settle, 100)
      else stop()
      return
    }
    if (!anchored) {
      anchored = true
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
      el.classList.add('learn-flash')
      window.setTimeout(() => el.classList.remove('learn-flash'), 2200)
      timer = window.setTimeout(settle, 800)
      return
    }
    // Content above the anchor has landed: put the anchor back at the top.
    if (Math.abs(el.getBoundingClientRect().top) > 24) el.scrollIntoView({ block: 'start', behavior: 'auto' })
    if (Date.now() - started < 3500) timer = window.setTimeout(settle, 250)
    else stop()
  }
  settle()
}

const RATES_KEY = 'nimbooks:rates'
// The Nimiq Pay host's device identifier, cached so the prompt is asked once.
// chain.ts reads the same key to scope per-device preferences.
const DEVICE_ID_KEY = 'nimbooks:deviceId'

// Written by lib/prices.ts: { asset: { rates: {usd,myr,eur,…}, at } } - the
// per-asset rate cache the UI preloads from, plus 'nimbooks:fx' for the
// USD->currency table.
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

// No rates is NOT zero rates: an unknown price must never render as $0.00,
// so the placeholder is an empty table and every code reads unknown (NaN)
// until a price arrives. formatFiat and the "Price unavailable" tile take
// it from there.
const NO_RATES: FiatRates = { usd: NaN }

// Picker sections: "Popular" is the Nimiq Wallet's own set in its order; the
// rest of the 148 follow A to Z by code. Built once at module scope.
const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))
const POPULAR_CURRENCIES: typeof CURRENCIES = WALLET_CURRENCIES.map(
  (code) => CURRENCY_BY_CODE.get(code)
).filter((c): c is NonNullable<typeof c> => !!c)
const OTHER_CURRENCIES: typeof CURRENCIES = CURRENCIES.filter(
  (c) => !WALLET_CURRENCIES.includes(c.code)
)
OTHER_CURRENCIES.sort((a, b) => a.code.localeCompare(b.code))

// Neutral round badge for currencies without a flag file (used in the picker
// tiles and the currency chip): the 3-letter code inside a circle, no new
// image files. Style in App.css under .currency-badge.

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

const STAKE_INTENT_KEY = 'nimbooks:stakeIntent'
const STAKE_LINK_MAX_LUNA = 21_000_000_000 * 100_000

// The link intent is public data (amount + validator) kept for one tab while a
// wallet is still connecting. It is cleared the moment the panel consumes it,
// and on disconnect, so a reload or a later wallet never reopens it.
function loadStoredStakeIntent(): StakeLinkIntent | null {
  try {
    const raw = sessionStorage.getItem(STAKE_INTENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StakeLinkIntent>
    const amountLuna =
      typeof parsed.amountLuna === 'number' &&
      Number.isSafeInteger(parsed.amountLuna) &&
      parsed.amountLuna > 0 &&
      parsed.amountLuna <= STAKE_LINK_MAX_LUNA
        ? parsed.amountLuna
        : null
    const validator =
      typeof parsed.validator === 'string' && isValidNimiqAddress(parsed.validator)
        ? parsed.validator.replace(/\s+/g, '').toUpperCase()
        : null
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === 'string').slice(0, 6)
      : []
    return { amountLuna, validator, warnings }
  } catch {
    return null
  }
}

function saveStoredStakeIntent(intent: StakeLinkIntent): void {
  try {
    sessionStorage.setItem(STAKE_INTENT_KEY, JSON.stringify(intent))
  } catch {
    /* storage full or blocked: the panel still opens in this page load */
  }
}

function clearStoredStakeIntent(): void {
  try {
    sessionStorage.removeItem(STAKE_INTENT_KEY)
  } catch {
    /* nothing to clear */
  }
}

// The "Open in Nimiq Pay" hand-off for a phone browser holding a stake link:
// the plain miniapp URL loses the route (nimpay.app drops the fragment), so a
// waiting link goes through the nimiqpay:// scheme, which carries the whole
// site URL, exactly as the invoice page hands off a payment request.
function payHandoffHref(intent: StakeLinkIntent | null): string {
  if (!intent) return NIMIQ_PAY_APP_URL
  const link = buildStakeLink({
    amountNim: intent.amountLuna !== null ? formatLunaExact(String(intent.amountLuna)) : null,
    validator: intent.validator,
  })
  return payDeepLink(link.slice(link.indexOf('#')))
}

function shortStakeAddress(address: string): string {
  const clean = address.replace(/\s+/g, '').toUpperCase()
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ... ${clean.slice(-4)}`
}

function stakeLinkNoticeText(
  amountLabel: string | null,
  validatorLabel: string | null,
  warnings: string[]
): string {
  let notice: string
  if (amountLabel && validatorLabel) {
    notice = `Opened from a link: ${amountLabel} with ${validatorLabel}. Check both before you confirm.`
  } else if (amountLabel) {
    notice = `Opened from a link: ${amountLabel}. Check it before you confirm.`
  } else if (validatorLabel) {
    notice = `Opened from a link: ${validatorLabel}. Check it before you confirm.`
  } else {
    notice = 'Opened from a link. Check the amount and validator before you confirm.'
  }
  if (warnings.length > 0) notice += ' ' + warnings.join(' ')
  return notice
}

// A link validator's outcome against the live list, shared by the first open
// and the pending list arrival. The holding is the link's own staker lookup,
// not the connect refresh's record that lands after the history walk.
function linkValidatorOutcome(
  validator: string,
  holding: StakingHolding | null,
  list: ValidatorInfo[],
  warnings: string[]
): { label: string; selected: string | null; warnings: string[] } {
  const next = [...warnings]
  const linked = list.find((v) => cleanAddr(v.address) === validator) ?? null
  if (!linked) {
    next.push('That validator is not in the live validator list, so it was not selected.')
    return { label: shortStakeAddress(validator), selected: null, warnings: next }
  }
  const label = `${linked.name} (${shortStakeAddress(linked.address)})`
  if (holding) {
    const current = holding.delegation ? cleanAddr(holding.delegation) : null
    if (current === validator) {
      next.push(`Your stake is already with ${linked.name}, so the link's validator matches it.`)
    } else {
      next.push(
        'Your stake is already delegated, so the link\'s validator was not selected. Adding stake stays with your current validator; switching needs an unstake first.'
      )
    }
    return { label, selected: null, warnings: next }
  }
  if (linked.reliability === null && !isPinnedValidator(linked.address)) {
    next.push(`${linked.name} is not producing rewards right now, so it was not selected.`)
    return { label, selected: null, warnings: next }
  }
  return { label, selected: cleanAddr(linked.address), warnings: next }
}

// The storage a session preference lives in for the connected account: per tab
// in demo mode (the sample address must never reach localStorage), on-device
// otherwise.
function demoStore(): Storage {
  return isDemoMode() ? window.sessionStorage : window.localStorage
}

// Nimiq caps a basic transaction's data field at 64 bytes, and the memo travels
// there as UTF-8 — so the limit is bytes, not characters (one emoji is four).
const MAX_TX_MEMO_BYTES = 64

function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length
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
// Pay contract archive retry backoff after a failed (usually rate-limited) pass.
const ARCHIVE_BACKOFF_MIN_MS = 15_000
const ARCHIVE_BACKOFF_MAX_MS = 2 * 60_000
const TX_VERIFY_INTERVAL_MS = 10_000
// Longest a confetti piece can be on screen (0.15s delay + 1.6s fall, see
// Confetti.tsx) plus a beat, after which the burst unmounts itself and leaves
// the success screen clean. It does not close anything.
const CONFETTI_MS = 2_600

// One page of History. Kept beside the filter state so "reset on filter
// change" and the initial render cannot drift apart.
const INITIAL_VISIBLE_TX = 50

// History's chips, in order, and the copy each empty filter shows. The labels
// are the short chip names; the summary line below the chips carries the units.
const HISTORY_FILTER_LABEL: Record<HistoryFilter, string> = {
  all: 'All',
  received: 'Received',
  sent: 'Sent',
  rewards: 'Rewards',
  staking: 'Staking',
  pay: 'Pay transfers',
  cashlinks: 'Cashlinks',
}

const HISTORY_EMPTY: Record<HistoryFilter, string> = {
  all: 'No transactions in the history loaded on this device.',
  received: 'No received payments in the history loaded on this device.',
  sent: 'No sent payments in the history loaded on this device.',
  rewards: 'No rewards in the history loaded on this device.',
  staking: 'No staking transactions in the history loaded on this device.',
  pay: 'No Nimiq Pay transfers in the history loaded on this device.',
  cashlinks: 'No cashlinks in the history loaded on this device.',
}

// "1 transaction" / "2 transactions", so a one-day rewards month does not read
// "1 days".
function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

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
  stake: 'staked',
}

// Nimiq's minimum stake is 10,000,000 Luna (getPolicyConstants). A first stake
// below it is rejected by the protocol, and a partial unstake that would leave
// a staker record below it is rejected the same way.
const MIN_STAKE_NIM = 100
const MIN_STAKE_LUNA = MIN_STAKE_NIM * 100000
const MIN_STAKE_COPY = 'Nimiq needs at least 100 NIM to open a stake.'
// Hub signing warm-up retry while a staking surface is open.
const HUB_PREP_RETRY_MS = 5000
const MIN_REMAINDER_COPY = 'Your stake must stay ≥ 100 NIM'

// The public RPC rate-limits bursts and our own fetches time out; the 10s
// auto-refresh then retries and usually succeeds. Neither is a broken wallet,
// so neither belongs in the red alarm banner — and neither should reach the
// user as "RPC HTTP 429" or "The operation was aborted".
const NODE_BUSY_COPY = "Nimiq's public node is busy, retrying…"

// Shown when the Pay host reports no consensus yet. Deliberately a dim note,
// never a gate: NimBooks reads the chain over its own RPC, so a syncing host
// only affects what the *wallet* can sign — the books still load. One constant
// so the connect screen and the Overview can never word it differently.
const PAY_SYNCING_COPY = 'Nimiq Pay is still syncing. Your wallet may look empty for a moment.'

function isTransientChainError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /\b429\b|too many requests|rate limit|abort|timed? ?out|timeout|network ?error|failed to fetch/i.test(
    msg
  )
}

// Unstaking leaves in three legs, and each one is worded exactly once here: the
// confirming step, the completed card, the banner modal's head and the toast all
// read from this table, so the same transaction can never be called two
// different things in two places.
type UnstakeLegKind = Exclude<StakingActionKind, 'stake'>
interface UnstakeLegCopy {
  // Head of the window the leg finishes in — it echoes the button that started
  // it, so the banner modal reads as the same action the user tapped.
  window: string
  // Completed card headline, confirmed on chain and merely submitted.
  done: string
  pending: string
  // Row label in the amount block.
  row: string
  // What happens next, once the chain has confirmed the leg.
  next: string
  // Shown only when the leg's window was closed before the poll answered.
  toast: string
}
const UNSTAKE_LEG: Record<UnstakeLegKind, UnstakeLegCopy> = {
  deactivate: {
    window: 'Unstake',
    done: 'Stake deactivated',
    pending: 'Deactivation submitted',
    row: 'Deactivated',
    next: 'It takes effect at the next election block, then a reporting window before it is withdrawable. The balance banner guides you through the rest.',
    toast: 'Unstake confirmed: your stake is cooling down ✓',
  },
  retire: {
    window: 'Complete unstake',
    done: 'Stake retired',
    pending: 'Retire submitted',
    row: 'Retired',
    next: 'It is withdrawable after the reporting window, and the balance banner carries the Withdraw button once it is.',
    toast: 'Retired. Withdrawable after the reporting window ✓',
  },
  withdraw: {
    window: 'Withdraw',
    done: 'Withdrawn',
    pending: 'Withdrawal submitted',
    row: 'Withdrawn',
    next: 'It is back in your balance, and the transaction is in your History.',
    toast: 'Withdrawn: the NIM is back in your balance ✓',
  },
}
// remove_stake takes the whole retired balance or nothing, so asking to unstake
// less than all of it still moves all of it. The card says so rather than a
// toast, which the panel's own overlay would cover.
const FULL_WITHDRAW_NOTE =
  "Partial withdrawals aren't allowed on Nimiq, so this takes your full retired balance."

/**
 * Fold a typed amount back into the value an amount slider is holding.
 *
 * The parser is `parseNimToLuna` — the one the send sheet and the invoice form
 * already use — so a typed stake is held to exactly the rules a sent amount is:
 * positive, at most 5 decimals, inside the supply cap. Anything it rejects
 * leaves the committed amount where it was, which is what keeps NaN, negatives
 * and finer-than-a-Luna figures off the slider and away from submit. What it
 * accepts is clamped to the ceiling, so a number larger than the wallet can
 * fund lands on the maximum instead of arming a submit the chain would refuse.
 *
 * @param maxLuna the slider's ceiling, in Luna (integer) — clamping in Luna
 *   rather than NIM keeps the float division out of the committed value.
 * @param current the amount to keep when the input isn't a number yet.
 */
function commitTypedAmount(raw: string, maxLuna: number, current: string): string {
  // Empty and a typed zero are the same state — no amount — and the panel's
  // existing hints already speak for it.
  if (/^0*\.?0*$/.test(raw.trim())) return ''
  const luna = parseNimToLuna(raw)
  if (!luna) return current
  const ceiling = Math.max(0, Math.floor(maxLuna))
  return formatLunaExact(String(Number(luna) > ceiling ? ceiling : luna))
}

/**
 * The figure beside an amount slider, typed rather than dragged.
 *
 * Landing on exactly 100 or 1,000 NIM by dragging a slider whose range is the
 * whole wallet is a careful, fiddly thing; typing it is one gesture. The slider
 * stays the control — it keeps its label and its own aria-label — and this is
 * the same value made editable: both read the panel's state, so a drag writes
 * the field and a keystroke moves the thumb.
 *
 * While the field has focus it shows the user's literal keystrokes.
 * Reformatting between them would fight the caret — type the fourth digit of
 * 1000 and a separator appears under your cursor — so locale formatting waits
 * until blur, when the edit is over.
 */
function SliderAmountField({
  id,
  ariaLabel,
  value,
  lang,
  onCommit,
}: {
  id: string
  ariaLabel: string
  value: string
  lang: string
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft !== null ? draft : value === '' ? '' : Number(value).toLocaleString(lang)
  return (
    <input
      id={id}
      className="stake-amount-input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder="0"
      aria-label={ariaLabel}
      value={shown}
      onFocus={(e) => {
        // Edit the number, not its formatting: the separators step aside for
        // the duration, and the whole figure starts selected so a round number
        // replaces it in one go.
        const el = e.currentTarget
        setDraft(value)
        requestAnimationFrame(() => el.select())
      }}
      onChange={(e) => {
        // Digits and a single decimal point survive; anything else is dropped
        // rather than parsed. That gets a grouping separator out of the way —
        // typing "1,000" arrives as 1000, which is the whole point of the
        // field — without having to guess whether a comma meant thousands or a
        // fraction in the user's locale.
        const cleaned = e.target.value.replace(/[^\d.]/g, '')
        const [whole, ...rest] = cleaned.split('.')
        const next = rest.length > 0 ? `${whole}.${rest.join('')}` : whole
        setDraft(next)
        onCommit(next)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        // Enter ends the edit and normalises; it does not submit. Staking is a
        // deliberate second act, and the confirm dialog is where it happens.
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export default function App() {
  // A Hub login on a mobile browser returns as a full-page redirect, and
  // main.tsx has already picked the answer off the URL — so the session can
  // exist before this component's first render.
  const [account, setAccount] = useState<WalletAccount | null>(getConnectedAccount)
  // Inside Nimiq Pay, tapping a transaction hash loads the block explorer in
  // the same WebView, so pressing back re-boots NimBooks with its in-memory
  // connection gone. A session saved at connect time (lib/wallet.ts) is brought
  // back silently here; until it answers the app shows a reconnecting line
  // rather than the connect screen the user did nothing to deserve.
  const [restoring, setRestoring] = useState(
    () => !getConnectedAccount() && hasRestorableSession()
  )
  // Nimiq Pay's sync state at connect time. `null` = not asked / not applicable
  // (Hub, demo, browser). Never gates the UI — see the note it renders.
  const [payConsensus, setPayConsensus] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [hubConnecting, setHubConnecting] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(30)
  const [nimBalance, setNimBalance] = useState<string | null>(null)
  const [nimTxs, setNimTxs] = useState<NimiqTx[]>([])
  // History of the wallet's *remote* HTLC relay address (Nimiq Pay's
  // accounts[1]). The relay hops are the user's real transactions but never
  // appear on the basic address list, so they are merged into History and
  // classified (see txLabel `remote` handling) instead of being hidden.
  const [remoteTxs, setRemoteTxs] = useState<NimiqTx[]>([])
  // The archived histories of the user's *settled* Pay contracts (pruned to an
  // empty basic account — see lib/payContracts.ts) plus the contracts Pay is
  // currently still keeping live. Nimiq Pay recycles its Pay contract
  // constantly, so one remote address covers only the latest chapter; without
  // these, everything paid or staked out of earlier contracts is invisible.
  const [archiveTxs, setArchiveTxs] = useState<NimiqTx[]>([])
  const [liveContracts, setLiveContracts] = useState<string[]>([])
  // refresh is a callback, so it reads the mirrors here rather than the state;
  // both are written alongside their state on every sync.
  const liveContractsRef = useRef<string[]>([])
  const archiveFinalsRef = useRef<Set<string>>(new Set())
  // Archive pass scheduling (see the sync in refresh): one pass at a time, an
  // unfinished one re-runs when due, a failing one backs off.
  const archiveBusyRef = useRef(false)
  const archivePendingRef = useRef(false)
  const archiveNextAtRef = useRef(0)
  const archiveBackoffRef = useRef(ARCHIVE_BACKOFF_MIN_MS)
  // Staking rewards, synthesized as History rows (one per UTC day per
  // validator) from the v2 events API — the tx index doesn't carry them.
  const [rewardTxs, setRewardTxs] = useState<NimiqTx[]>([])
  // False while a chunk of the rewards history failed to load: the statement
  // and tax cards then say the total may be short instead of staying silent.
  // Back to true once a refresh succeeds with every chunk loaded.
  const [rewardsComplete, setRewardsComplete] = useState(true)
  // When this account was last seen, read once when it connects and held in
  // state for the session, so the Earn card can show what was earned since
  // then. Written right back every load and on page hide, so the NEXT visit
  // compares against this one. Demo mode keeps both markers per tab
  // (sessionStorage) and never writes the sample address to localStorage.
  // null = first visit: there is nothing to compare against.
  const [previousVisitMs, setPreviousVisitMs] = useState<number | null>(null)
  // Payment hashes the user has already declined to stake ('Not now'), newest
  // last, capped at 50. Read per address alongside the visit marker above.
  const [nudgeDismissed, setNudgeDismissed] = useState<string[]>([])
  const [htlcHoldings, setHtlcHoldings] = useState<HtlcHolding[]>([])
  // Luna sitting in HTLC contracts this address funded (Luna, 0 when none),
  // discovered by scanning the tx history. Nimiq Pay routes everything through
  // a relay address whose basic balance is 0, so without this the user's real
  // money is invisible — see getHtlcInTransit.
  const [htlcInTransit, setHtlcInTransit] = useState(0)
  // Balance of the wallet's *remote account* — the HTLC Nimiq Pay stores the
  // user's funds in, named outright by `listAccounts()`. `null` means "no such
  // account, or not read yet" (Hub, demo, or a failed lookup), which is what
  // sends the totals below back to the history scan above.
  const [remoteAccountLuna, setRemoteAccountLuna] = useState<number | null>(null)
  // `address:txCount:newestHash` of the last successful HTLC + vesting sweep.
  // Both are pure functions of the tx list, so an unchanged key means the
  // holdings below are still current and the sweeps can be skipped entirely.
  const contractSweepRef = useRef<string | null>(null)
  const [stakingHolding, setStakingHolding] = useState<StakingHolding | null>(null)
  // Portfolio access grant for this wallet (see lib/stakeGate.ts). The cleanup
  // runs on address change and on disconnect, so a late lookup for a previous
  // wallet is dropped and the flag falls back to false.
  const [grantedAccess, setGrantedAccess] = useState(false)
  useEffect(() => {
    const addr = account?.nimiqAddress
    if (!addr) return
    let live = true
    isGrantedAddress(addr).then((ok) => {
      if (live) setGrantedAccess(ok)
    })
    return () => {
      live = false
      setGrantedAccess(false)
    }
  }, [account?.nimiqAddress])
  // Chain head, refreshed alongside the balances. Unstake steps are gated on
  // block height, not wall clock — 0 means "not known yet".
  const [currentBlock, setCurrentBlock] = useState<number>(0)
  const [vestingHoldings, setVestingHoldings] = useState<VestingHolding[]>([])
  const [evmBalances, setEvmBalances] = useState<EvmBalance[]>([])
  // Full rate table per asset - one entry per display currency, so switching
  // currency is instant and costs no extra request. Unknown prices are NaN,
  // never 0: zero is a real rate, NaN is "the price service has nothing yet"
  // and renders as "Price unavailable" instead of a lying $0.00.
  const [fiat, setFiat] = useState<Record<RateAsset, FiatRates>>({
    nim: NO_RATES,
    usdt: { ...NO_RATES, usd: 1 },
    eth: NO_RATES,
    pol: NO_RATES,
  })
  // USD -> display-currency table from the FX ladder (see lib/prices.ts).
  // Asset price times its currency rate is what the tables above hold.
  const [fxTable, setFxTable] = useState<FiatRates>({})
  // Where the price on screen came from and when the NIM price was observed:
  // null until the chain has answered anything (cache included).
  const [priceStatus, setPriceStatus] = useState<
    { asOf: number | null; priceSource: string; fxSource: string } | null
  >(null)
  const [currency, setCurrency] = useState<CurrencyCode>(loadCurrency)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  // Picker search: empty matches nothing and shows the two sections.
  const [currencyQuery, setCurrencyQuery] = useState('')
  // Fresh query every time the sheet opens.
  useEffect(() => {
    if (currencyOpen) setCurrencyQuery('')
  }, [currencyOpen])
  const currencyQueryLower = currencyQuery.trim().toLowerCase()
  // Filters by code and by English name, case-insensitive ("peso" finds
  // ARS, CLP, COP, DOP, MXN, PHP, UYU).
  const currencyMatches = currencyQueryLower
    ? CURRENCIES.filter(
        (c) => c.code.includes(currencyQueryLower) || c.name.toLowerCase().includes(currencyQueryLower)
      )
    : null
  // Tile reused by the two sections and the search results. Currencies
  // without a flag file show a neutral code badge instead of an image.
  const currencyTile = (c: typeof CURRENCIES[number]) => (
    <button
      key={c.code}
      type="button"
      role="radio"
      aria-checked={c.code === currency}
      className={c.code === currency ? 'currency-tile selected' : 'currency-tile'}
      onClick={() => pickCurrency(c.code)}
    >
      <span className="currency-visual" aria-hidden="true">
        {c.flag ? (
          <img
            className="currency-flag-img"
            src={`/flags/flag-${c.flag}.svg`}
            alt=""
            loading="lazy"
            width={28}
            height={28}
          />
        ) : (
          <span className="currency-badge">{c.label}</span>
        )}
      </span>
      <span className="currency-code">{c.label}</span>
      <span className="currency-name">{c.name}</span>
    </button>
  )
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
  // The address whose first history read has landed this session. The first
  // read for a different address (or none yet) paints "Loading…" instead of a
  // $0.00 that only means "not answered yet"; later heartbeats never do.
  const [historyReadyAddress, setHistoryReadyAddress] = useState<string | null>(null)
  const [signingHash, setSigningHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() => {
    // A redirect login that came back refused or cancelled has nowhere else to
    // report itself — the connect screen renders before any handler runs.
    const failed = getHubRedirectError()
    return failed ? 'Browser login failed: ' + failed : null
  })
  const [toast, setToast] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showReceiptHelp, setShowReceiptHelp] = useState(false)
  const [showTypeHelp, setShowTypeHelp] = useState(false)
  const [visibleTxCount, setVisibleTxCount] = useState(INITIAL_VISIBLE_TX)
  // History's filter is a view preference, not a stored one: it lasts while the
  // tab is mounted and resets to All when the connected account changes (see
  // the effect below), so a new wallet never opens on the old one's filter.
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  // Months are collapsed by default; this only records the months the user
  // explicitly opened or closed, so the newest stays expanded until they say
  // otherwise. Keyed by 'YYYY-MM'.
  const [rewardMonthToggles, setRewardMonthToggles] = useState<Record<string, boolean>>({})
  // The same stored preference as Analytics' Hide internal switch, so the two
  // screens always agree. Read the way Analytics reads it ('true' = hide).
  const [hideInternalHistory, setHideInternalHistory] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nimbooks:analytics:filterHtlc') === 'true'
    } catch {
      return false
    }
  })
  const [statementYear, setStatementYear] = useState<string>('all')
  const [statement, setStatement] = useState<Statement | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  // On-demand older-history walk. Session-only on purpose: the chain loader
  // deliberately keeps the capped list out of localStorage (a 44k-tx window
  // would blow the 5MB quota), so this does not survive a reload either.
  const [extendedLoading, setExtendedLoading] = useState(false)
  const [extendedProgress, setExtendedProgress] = useState<{ fetched: number; elapsedSec: number } | null>(null)
  const [extendedHistory, setExtendedHistory] = useState<NimiqTx[] | null>(null)
  const [extendedConfirmOpen, setExtendedConfirmOpen] = useState(false)
  const [taxReport, setTaxReport] = useState<TaxReport | null>(null)
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxFormat, setTaxFormat] = useState<TaxFormat>('koinly')
  // Real-HTTPS download link for WebViews that can't save files (see downloadLink.ts).
  const [downloadLink, setDownloadLink] = useState<string | null>(null)
  // Is the link above the short /s/ form (payload in our KV, gone in 48h) or
  // the long /export/ one (payload in the URL, stored nowhere)? The modal has
  // to say which, because only one of them leaves anything behind.
  const [downloadShortLink, setDownloadShortLink] = useState(false)
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
  // Overview quick actions. Send walks the same adapter path as the invoice
  // page (wallet.sendNim): 'sending' is waiting on the wallet's signature,
  // 'locating' is recovering the hash from history, which only Nimiq Pay needs.
  const [sendOpen, setSendOpen] = useState(false)
  // Cashlink sheet: create a claimable link and present it (link, QR, share).
  const [cashlinkOpen, setCashlinkOpen] = useState(false)
  const [cashlinkAmount, setCashlinkAmount] = useState('')
  const [cashlinkMessage, setCashlinkMessage] = useState('')
  const [cashlinkBusy, setCashlinkBusy] = useState(false)
  const [cashlinkError, setCashlinkError] = useState<string | null>(null)
  const [cashlinkSignerReady, setCashlinkSignerReady] = useState(false)
  const [cashlinkResult, setCashlinkResult] = useState<CashlinkResultView | null>(null)
  const [cashlinkHistory, setCashlinkHistory] = useState<StoredCashlink[]>([])
  const [cashlinkRevertTarget, setCashlinkRevertTarget] = useState<{
    address: string
    secret: string
    valueLuna: number
  } | null>(null)
  const [cashlinkRevertBusy, setCashlinkRevertBusy] = useState(false)
  // Removing a shelf row deletes the link's private key from this device, so
  // it asks first — same overlay pattern as the revert confirmation.
  const [cashlinkRemoveTarget, setCashlinkRemoveTarget] = useState<StoredCashlink | null>(null)
  // Hard guards against a double-tap racing the disabled attribute: both
  // paths move money, so a second entry must bounce before React re-renders.
  const cashlinkSubmittingRef = useRef(false)
  const cashlinkRevertBusyRef = useRef(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendMemo, setSendMemo] = useState('')
  // 'unconfirmed' is the Pay "outcome unknown" limbo: a submit may already be
  // on the chain, so the sheet can never invite a retry — sendBusy keeps it
  // out of the button, and closeSend clears the form like the other
  // post-send states. sendUnconfirmedChecked flips to true once the
  // background chain lookup finished without finding it, which switches the
  // card's copy from "checking" to "check History first".
  const [sendState, setSendState] = useState<
    'idle' | 'sending' | 'locating' | 'sent' | 'unconfirmed'
  >('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendUnconfirmedChecked, setSendUnconfirmedChecked] = useState(false)
  const [sendHash, setSendHash] = useState<string | null>(null)
  // Confetti for a payment that actually landed — held as the hash it belongs
  // to, so a burst is always traceable to one transaction (see celebrateSend).
  // The sheet never closes itself: this only draws, Done still does the rest.
  const [sendCelebrate, setSendCelebrate] = useState<string | null>(null)
  const sendCelebrateTimer = useRef<number | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  // The global toast sits in the page flow, under the modal overlay — so a copy
  // from inside the Receive sheet confirms on the button itself as well.
  const [addrCopied, setAddrCopied] = useState(false)
  const [stakeOpen, setStakeOpen] = useState(false)
  const [unstakeOpen, setUnstakeOpen] = useState(false)
  const [confirmUnstakeOpen, setConfirmUnstakeOpen] = useState(false)
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [unstaking, setUnstaking] = useState(false)
  // Same hard guard as the cashlink paths: all three unstake submits move
  // money, so a double-tap must bounce before React re-renders the button.
  const unstakingRef = useRef(false)
  const [unstakeError, setUnstakeError] = useState<string | null>(null)
  const [unstakeVerify, setUnstakeVerify] = useState<TxVerify | null>(null)
  // What the unstake actually sent, captured at submit time — the confirming
  // step and the completed card render from this, not from the form or the
  // staker record (both move the moment the transaction goes out). One submit
  // can send two legs (withdraw then deactivate); the verification tracks the
  // last one, which is also the card's headline.
  const [unstakeSubmitted, setUnstakeSubmitted] = useState<{
    legs: { kind: UnstakeLegKind; amountNim: number; hash: string }[]
    // Which window owns the beats: the stake panel for an unstake started
    // there, a modal of its own for the balance banner's two finishing steps.
    source: 'panel' | 'banner'
    // Submit-time asides that used to be toasts — they belong on the card,
    // because the sheet's overlay sits above where the toast renders.
    notes: string[]
  } | null>(null)
  // The banner's legs have no panel to live in, so they get one.
  const [unstakeModalOpen, setUnstakeModalOpen] = useState(false)
  // The hash the verification poll is allowed to report on — a second submit
  // supersedes the first, and a stale poll must not overwrite its result.
  const unstakeVerifyRef = useRef<string | null>(null)
  // Leg 1 of a chained unstake, once it is out: a withdraw that has been signed
  // and broadcast but has not mined yet. The staker record keeps its retired
  // balance until it does, so `retiredLuna > 0` cannot tell "not withdrawn" from
  // "withdrawn, still settling" — and the retry the popup blocker sends the user
  // on (leg 2 needs its own click) would sign the same withdraw again. Cleared
  // the moment the chain answers either way.
  const withdrawSubmittedRef = useRef<{
    hash: string
    retiredLuna: number
    amountNim: number
  } | null>(null)
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
  // "New look (beta)" opt-in: classic stays the default. The mode swaps the
  // two ported screens in place (no reload) and flips the toggle and badge.
  const uiBeta = useUiMode() === 'beta'
  useEffect(() => {
    const addr = account?.nimiqAddress
    setStakingLog(addr ? loadStakingLog(addr) : [])
  }, [account?.nimiqAddress])
  const [validators, setValidators] = useState<ValidatorInfo[]>([])
  const [validatorsLoading, setValidatorsLoading] = useState(false)
  const [validatorsError, setValidatorsError] = useState<string | null>(null)
  const validatorLogosRefreshedRef = useRef(false)
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [stakeAmount, setStakeAmount] = useState('')
  const [staking, setStaking] = useState(false)
  const [stakeError, setStakeError] = useState<string | null>(null)
  const [stakeVerify, setStakeVerify] = useState<TxVerify | null>(null)
  const stakeVerifyRef = useRef<string | null>(null)
  // What was actually signed, captured at submit time: the confirming and
  // confirmed cards render from this rather than from the form. The amount
  // field resets the moment the tx goes out, and a first stake has no staker
  // record to look its validator up in yet — neither survives long enough.
  const [stakeSubmitted, setStakeSubmitted] = useState<{
    hash: string
    amountNim: number
    validator: string
  } | null>(null)
  // Confetti burst on a confirmed stake: fires once per hash and ends with the
  // burst. The panel never closes itself — the confirmed card waits for Done,
  // exactly like the send sheet.
  const [stakeCelebrate, setStakeCelebrate] = useState<string | null>(null)
  const stakeCelebrateTimer = useRef<number | null>(null)
  // A stake link's intent, kept until a wallet and its own staker record are
  // ready. The notice is the link-opened panel's phishing guard: it stays on
  // screen for as long as that panel does, then clears with it.
  const [stakeLinkIntent, setStakeLinkIntent] = useState<StakeLinkIntent | null>(null)
  const [stakeLinkNotice, setStakeLinkNotice] = useState<string | null>(null)
  const stakeLinkConsumedRef = useRef(false)
  // The link's own staker lookup starts as soon as an account is connected:
  // the connect refresh reads the same record, but only after the whole history
  // walk, which is seconds on a busy wallet. `pending` guards the one start.
  const stakeLinkLookupRef = useRef<string | null>(null)
  const [stakeLinkLookup, setStakeLinkLookup] = useState<{
    address: string
    status: 'pending' | 'ok' | 'failed'
    holding: StakingHolding | null
  } | null>(null)
  // A named validator is applied once the list arrives, without holding the
  // panel back for the ~1.4 MB download. Closing the panel cancels it.
  const [stakeLinkPendingValidator, setStakeLinkPendingValidator] = useState<string | null>(null)
  // A failed link lookup leaves the panel unable to tell a first stake from an
  // added one. The link amount must still show, so the slider does not clamp
  // it to the first-stake minimum until the record is actually known.
  const [stakeLinkStakerUnknown, setStakeLinkStakerUnknown] = useState(false)
  const stakeLinkNoticeBaseRef = useRef<{ amountLabel: string | null; warnings: string[] } | null>(
    null
  )
  const stakeLinkHoldingRef = useRef<StakingHolding | null>(null)
  // One-shot override for openStake so a link can use its own staker lookup
  // without changing the click handler's signature.
  const stakeLinkOpenHasStakerRef = useRef<boolean | null>(null)

  // Capture at boot: the hash is the link's payload. Save only the public
  // intent, then take the route off the URL so a reload or Back does not
  // trigger it again.
  useEffect(() => {
    const fromHash = parseStakeLink(window.location.hash)
    if (fromHash) {
      saveStoredStakeIntent(fromHash)
      setStakeLinkIntent(fromHash)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      return
    }
    const stored = loadStoredStakeIntent()
    if (stored) setStakeLinkIntent(stored)
  }, [])

  // Onboarding tour state machine (see lib/tour.ts). The App owns setView, so
  // TourHost asks it to navigate via onNavigate when a route step is entered.
  const [tour, setTour] = useState<TourRuntimeState>({ phase: 'idle', stepIndex: 0 })
  // Sample-wallet entries from the landing's explainers (lib/features.ts). An entry
  // that names a screen skips the tour offer once, and the screen is applied when
  // the account lands (see the learn effect after openStake).
  const skipTourOfferRef = useRef(false)
  const learnEntryRef = useRef<SampleEntry | null>(null)

  // Public metrics for the landing hero: real wallets and their visits since the
  // tracker started (sample-wallet sessions are not visits)
  const [publicStats, setPublicStats] = useState<{ uniqueWallets: number; totalConnections: number; since: string | null; pay: number; hub: number } | null>(null)
  useEffect(() => {
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.uniqueWallets === 'number') {
          const visits = data.totalConnections
          setPublicStats({
            uniqueWallets: data.uniqueWallets,
            totalConnections: Number.isFinite(visits) && visits >= 0 ? visits : 0,
            since: typeof data.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.since) ? data.since : null,
            pay: Number.isFinite(data.pay) && data.pay >= 0 ? data.pay : 0,
            hub: Number.isFinite(data.hub) && data.hub >= 0 ? data.hub : 0,
          })
        }
      })
      .catch(() => {})
  }, [])

  // Public wallet count: a real wallet is counted only once its owner has seen
  // the notice and not opted out (lib/connectCount). The sample wallet carries
  // no one's data, so it is always counted (as demo, apart from real visits).
  const [countConsent, setCountConsentState] = useState<CountConsent | null>(getCountConsent)
  // Receipts and cashlink keys exist only on this device: after one is made,
  // suggest a backup until one is copied (lib/backupNudge).
  const [backupDue, setBackupDue] = useState(needsBackup)
  const noteUnbacked = () => {
    markUnbackedChange()
    setBackupDue(true)
  }
  const chooseCount = (v: CountConsent) => {
    setCountConsent(v)
    setCountConsentState(v)
    // Opting out also deletes this wallet's record on the server, so a wallet
    // counted before the choice doesn't stay counted. Opting back in counts it
    // again on the spot (the effect below re-runs once the ref is cleared).
    trackedWalletRef.current = null
    const addr = account?.provider !== 'demo' ? account?.nimiqAddress : undefined
    if (v === 'no' && addr) {
      fetch('/api/forget-wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      }).catch(() => {})
    }
  }
  const trackedWalletRef = useRef<string | null>(null)
  useEffect(() => {
    if (!account) return
    if (account.provider !== 'demo' && countConsent !== 'yes') return
    const addr = account.nimiqAddress || (account.provider === 'demo' ? 'demo' : '')
    if (!addr || trackedWalletRef.current === addr) return
    trackedWalletRef.current = addr
    const platform = isInNimiqPay() ? 'pay' : isMobileDevice() ? 'mobile' : 'desktop'
    fetch('/api/track-connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: addr, provider: account.provider, platform }),
    }).catch(() => {})
  }, [account, countConsent])
  // While the walkthrough runs, the dashboard is a passive showroom: none of
  // its controls should open anything under the spotlight.
  const tourActive = tour.phase === 'active'
  const tourNext = useCallback(() => {
    setTour((t) => {
      const next = advanceNext(t)
      // When the tour finishes (Done), land back on the Overview dashboard —
      // never leave the user stranded on the last routed view (Export).
      if (next.phase === 'completed') setView('dashboard')
      return next
    })
  }, [])
  const tourStart = useCallback(() => {
    // The tour narrates the Overview dashboard — always start the walkthrough
    // there, regardless of where the offer card was accepted.
    setView('dashboard')
    setTour((t) => startTour(t))
  }, [])
  const tourSkip = useCallback(() => setTour((t) => skipTour(t)), [])
  const tourDismiss = useCallback(() => setTour((t) => dismissOffer(t)), [])

  // The tour lives in the sample wallet (demo mode): it offers on EVERY entry
  // so judges and curious users can always replay it, and a real connected
  // wallet never sees it. Nothing is persisted. Leaving the sample wallet
  // resets the walkthrough state so the next entry offers again.
  useEffect(() => {
    // On the connect screen (no account, not demo): park the tour at idle so
    // the next sample-wallet entry gets a fresh offer, including after a
    // completed or dismissed run.
    if (!account && !isDemoMode()) {
      if (tour.phase !== 'idle') setTour((t) => (t.phase === 'idle' ? t : { phase: 'idle', stepIndex: 0 }))
      return
    }
    // The sample wallet must be fully loaded (connect done, first refresh
    // done) before the offer appears — otherwise the dashboard reflows as
    // data lands and the spotlight's coordinates go stale.
    if (connecting || loading) return
    if (!isDemoMode()) return
    if (tour.phase !== 'idle') return
    if (sendOpen || stakeOpen || cashlinkOpen || changelogOpen) return
    // A learn-page entry that named a screen takes its one-shot skip here.
    if (skipTourOfferRef.current) {
      skipTourOfferRef.current = false
      return
    }
    setTour((t) => offerTour(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.nimiqAddress, connecting, loading, sendOpen, stakeOpen, cashlinkOpen, changelogOpen])

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

  // Last-visit marker, per address (`nimbooks:last-visit:<address>`): read
  // once when the account connects and written straight back, so the NEXT
  // visit sees this session's start. `pagehide` and a hidden tab update too,
  // so a wallet left running in Pay's WebView for hours still marks its last
  // real moment of use. Demo mode reads the same key from sessionStorage and
  // pretends the previous visit was 7 days ago when there is none, so the
  // sample wallet always has rewards to show. First visit shows nothing.
  useEffect(() => {
    if (!account?.nimiqAddress) return
    const flat = account.nimiqAddress.replace(/\s+/g, '')
    const store = demoStore()
    const key = `nimbooks:last-visit:${flat}`
    let prev: number | null = null
    try {
      const raw = store.getItem(key)
      if (raw !== null) {
        const n = Number(raw)
        if (Number.isFinite(n) && n > 0) prev = n
      }
    } catch {
      /* storage unavailable - treated as a first visit */
    }
    if (prev === null && isDemoMode()) prev = Date.now() - 7 * 24 * 60 * 60 * 1000
    setPreviousVisitMs(prev)
    try {
      store.setItem(key, String(Date.now()))
    } catch {
      /* storage full - the next visit compares against nothing */
    }
  }, [account?.nimiqAddress])

  // Page hide keeps the marker honest: the next visit compares against the
  // last time the wallet was actually in use, not when it was connected.
  useEffect(() => {
    if (!account?.nimiqAddress) return
    const flat = account.nimiqAddress.replace(/\s+/g, '')
    const key = `nimbooks:last-visit:${flat}`
    const mark = () => {
      try {
        demoStore().setItem(key, String(Date.now()))
      } catch {
        /* storage unavailable or full */
      }
    }
    const onPageHide = () => mark()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') mark()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [account?.nimiqAddress])

  // Dismissed stake-it prompts, per address (`nimbooks:stake-nudge-dismissed:
  // <address>`, a JSON array capped at 50 hashes: a preference, carried in
  // backups). Fresh per tab in demo mode.
  useEffect(() => {
    if (!account?.nimiqAddress) return
    const flat = account.nimiqAddress.replace(/\s+/g, '')
    const key = `nimbooks:stake-nudge-dismissed:${flat}`
    let list: string[] = []
    try {
      const parsed: unknown = JSON.parse(demoStore().getItem(key) ?? '[]')
      if (Array.isArray(parsed)) list = parsed.filter((h): h is string => typeof h === 'string')
    } catch {
      /* unreadable marker - treat as empty */
    }
    setNudgeDismissed(list)
  }, [account?.nimiqAddress])

  // Soft failures (stale rates, a rate-limited node) go to the auto-dismissing
  // toast; only a failure that actually leaves the app unusable earns the red
  // banner, which on the connect screen also pushes the hero around.
  const reportSoftFailure = useCallback((e: unknown, fallback: string) => {
    setToast(isTransientChainError(e) ? NODE_BUSY_COPY : fallback)
  }, [])

  // Clipboard with the legacy fallback older mobile WebViews still need (the
  // async API is unavailable there, and in some of them insecure-context
  // `writeText` rejects).
  const copyText = useCallback(async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(okMessage)
      return true
    } catch {
      /* no async clipboard — fall through to the textarea path */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setToast(okMessage)
      return true
    } catch {
      setError('Could not copy. Long-press the address instead.')
      return false
    }
  }, [])

  // Heartbeat rate refreshes fail quietly: the rates on screen stay, and a failed
  // retry waits a minute. getAllFiatRates answers from its own 5-minute cache, so
  // on most ticks this costs no request at all.
  const ratesRetryAtRef = useRef(0)
  // The display currency at call time, without re-creating the callback (and
  // thus re-running the seeding effect below) on every currency switch.
  const currencyRef = useRef(currency)
  currencyRef.current = currency
  const keepBest = (prev: FiatRates, next: FiatRates): FiatRates =>
    hasRate(next?.usd) ? next : prev
  const fetchRates = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (opts?.quiet && Date.now() < ratesRetryAtRef.current) return
      try {
        const all: PriceChainResult = await getAllFiatRates(currencyRef.current)
        // An unknown NIM price means every source came back empty: keep the
        // one on screen (it may be a stale cache the chain already fell back
        // to, or - for a first visit - the explicit unknown state).
        const nim = hasRate(all.nim.usd) ? all.nim : null
        if (opts?.quiet && !nim) ratesRetryAtRef.current = Date.now() + 60_000
        setFiat((prev) => {
          const next = {
            nim: nim ?? prev.nim,
            usdt: keepBest(prev.usdt, all.usdt),
            eth: keepBest(prev.eth, all.eth),
            pol: keepBest(prev.pol, all.pol),
          }
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
        })
        setFxTable((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(all.fx)) return prev
          return all.fx
        })
        setPriceStatus({
          asOf: all.asOf,
          priceSource: all.priceSource,
          fxSource: all.fxSource,
        })
      } catch (e) {
        console.warn('Rate fetch failed:', e)
        if (opts?.quiet) ratesRetryAtRef.current = Date.now() + 60_000
        else reportSoftFailure(e, 'Live rates unavailable. Showing cached values.')
      }
    },
    [reportSoftFailure]
  )

  useEffect(() => {
    setLang(getLanguage() ?? navigator.language.split('-')[0] ?? 'en')
    // Load rates from localStorage cache immediately (no flash of $0). The
    // cached tables' `at` also drives the "as of HH:MM" line: a price older
    // than 30 minutes must say so, not pass as live.
    const cached = readRates()
    const fxCache = readFxCached()
    setFiat((p) => ({
      nim: mergeRates(NO_RATES, cached.nim?.rates),
      usdt: mergeRates(p.usdt, cached.usdt?.rates),
      eth: mergeRates(NO_RATES, cached.eth?.rates),
      pol: mergeRates(NO_RATES, cached.pol?.rates),
    }))
    if (fxCache) setFxTable(fxCache.table)
    const cachedNimAt = typeof cached.nim?.at === 'number' ? cached.nim.at : null
    setPriceStatus({
      asOf: cachedNimAt,
      priceSource: 'cache',
      fxSource: fxCache?.source ?? 'none',
    })
    // Fetch fresh rates (the price chain resolves tiers on its own)
    fetchRates()
  }, [fetchRates])

  // USD is the accounting currency: the CSV export and the tax-year statement
  // stay in USD whatever the user picked for display (see buildCsv).
  const rates = useMemo(
    () => ({ nim: fiat.nim.usd, usdt: fiat.usdt.usd, eth: fiat.eth.usd, pol: fiat.pol.usd }),
    [fiat]
  )
  // Display rates - the currency chosen by tapping the total value. A code
  // with no rate in the table is unknown, not 0: it renders as "Price
  // unavailable" where it is needed (see totalFiat and formatFiat).
  const shown = useMemo(
    () => ({
      nim: fiat.nim[currency] ?? NaN,
      usdt: fiat.usdt[currency] ?? NaN,
      eth: fiat.eth[currency] ?? NaN,
      pol: fiat.pol[currency] ?? NaN,
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

  // "Copied ✓" on the Receive button reverts on its own — same shape as the
  // toast above, so it can't leave a timer behind on unmount.
  useEffect(() => {
    if (!addrCopied) return
    const t = setTimeout(() => setAddrCopied(false), 2000)
    return () => clearTimeout(t)
  }, [addrCopied])

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
    // Shortened for the share sheet only — the QR still encodes the long link,
    // since a short-URL QR is a denser-scan change worth doing on its own.
    const url = await shortenUrl(siteLink(invoiceRoute(invoice)))
    const amount = formatLunaExact(invoice.amountNim)
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'NimBooks payment request',
          text: `Payment request: ${amount} NIM${invoice.memo ? ` (${invoice.memo})` : ''}`,
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
      setError('Could not copy link. Open the request and copy it from the address bar.')
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
    // The user chose a wallet: start the 3.2 MB client download behind the
    // provider handshake. The landing page itself never warms (a visitor who
    // does not connect pays nothing).
    warmLightClient()
    consentFromLanding()
    setCountConsentState(getCountConsent())
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
    warmLightClient()
    consentFromLanding()
    setCountConsentState(getCountConsent())
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

  // `entry` comes from a learn-page explainer: it lands on that screen, and only
  // a tour entry keeps the tour offer. The plain button passes nothing.
  const connectDemo = async (entry?: SampleEntry) => {
    warmLightClient()
    setConnecting(true)
    setError(null)
    // A waiting stake link opens the stake panel on entry; the tour offer
    // would land on top of it and hide the link notice, so skip it once.
    skipTourOfferRef.current = (!!entry && !entry.tour) || !!stakeLinkIntent
    try {
      // Public mainnet address with real activity, read-only demo mode
      // (lib/demoData.ts: a live Nimiq Pay wallet staking with ImpactZero).
      const acc = connectDemoAccount(DEMO_WALLET_ADDRESS)
      // Bake the demo story into localStorage BEFORE the account lands, so the
      // receipts/invoices load effects pick it up: real signed receipts and a
      // chain-paid request appear in the tabs on any device.
      seedDemoData(acc.nimiqAddress ?? DEMO_WALLET_ADDRESS)
      setPayConsensus(acc.consensus ?? null)
      setAccount(acc)
      if (entry) {
        setView(entry.view)
        learnEntryRef.current = entry
      }
      await refresh(acc)
      setToast('Demo mode: read-only sample wallet.')
    } catch (e) {
      skipTourOfferRef.current = false
      setError('Demo load failed: ' + (e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  // `heartbeat` marks the 10s auto-refresh: it reads only what is new (see
  // refreshTransactionHead) and keeps the rates current. Every other caller gets
  // the full read, as before.
  const refresh = async (acc: WalletAccount, opts?: { clearError?: boolean; heartbeat?: boolean }) => {
    const heartbeat = opts?.heartbeat === true
    setLoading(true)
    // Only a manual refresh (or a fresh connect) clears the error banner —
    // the 10s auto-refresh must not wipe an error the user is still reading.
    if (opts?.clearError !== false) setError(null)
    if (heartbeat) void fetchRates({ quiet: true })
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
            reportSoftFailure(e, 'Balance unavailable right now, retrying.')
          })
        // The wallet's remote account, where Nimiq Pay actually stores the
        // money (see wallet.WalletAccount.remoteAddress). One RPC call, fired
        // independently like the balance above and deliberately outside the
        // tx-keyed sweep below: a counterparty redeeming out of the contract
        // writes no tx to this user's address, so a figure gated on the tx list
        // would sit stale. Nothing here waits on it — the fallback scan keeps
        // the totals honest until it lands.
        if (acc.remoteAddress) {
          const remote = acc.remoteAddress
          void getRemoteAccountBalance(remote)
            .then((bal) => setRemoteAccountLuna(Number(bal) || 0))
            .catch((e) => {
              // Back to the history scan rather than a wrong number: `null`
              // is "unknown", not "empty".
              console.warn('Remote account balance lookup failed:', e)
              setRemoteAccountLuna(null)
            })
        } else {
          setRemoteAccountLuna(null)
        }
        // The main walk, the staker record and the chain head start together:
        // none needs the others, and the sweeps further down wait for all three.
        // The walk is the step that can take seconds; on the heartbeat it is only
        // the newest page (see refreshTransactionHead).
        const txsRead = heartbeat
          ? refreshTransactionHead(addr, 1000)
          : getNimiqTransactionHistory(addr, 1000)
        // A failed staker lookup resolves to ok: false and keeps the record on
        // screen. A null here would read as "never staked" and blank the stake
        // card for a tick.
        const stakingRead = fetchStakingHolding(addr).then(
          (holding) => ({ ok: true as const, holding }),
          (e) => {
            console.warn('Staking holding lookup failed:', e)
            return { ok: false as const, holding: null }
          }
        )
        // A full load waits on history, which comes from the light client and
        // can take 10-25 s on a first visit. The staker record answers in about
        // a second: show it as soon as it lands, so the stake card and the
        // Portfolio gate never read "not staked" for a staker while history is
        // still loading. The join below sets the same record again (a no-op).
        if (!heartbeat) {
          void stakingRead.then((staking) => {
            if (staking.ok) {
              setStakingHolding((prev) =>
                sameStakingHolding(prev, staking.holding) ? prev : staking.holding
              )
            }
          })
        }
        // The wallet's remote HTLC relay history. Nimiq Pay keeps funds in a
        // separate contract address (accounts[1]); the relay hops are the
        // user's real transactions but never show on the basic address list.
        // Fetched in parallel with the rest — nothing downstream depends on
        // it, and History merges the two lists tagged `remote` so the full
        // wallet picture is visible and classified.
        if (acc.remoteAddress) {
          // The contract Pay is currently using, plus every live contract the
          // archive sync discovered. The current one is skipped when the sync
          // has already settled it (pruned to an empty basic account): its
          // rows then ride in via archiveTxs and a second read would only
          // fetch an empty list. Deduped, flat, preserving order.
          const baseFlat = acc.remoteAddress.replace(/\s+/g, '').toUpperCase()
          const addresses: string[] =
            archiveFinalsRef.current.has(baseFlat) || isArchivedContract(addr, acc.remoteAddress)
            ? []
            : [acc.remoteAddress]
          const seenAddr = new Set(addresses.map((a) => a.replace(/\s+/g, '').toUpperCase()))
          for (const c of liveContractsRef.current) {
            const flat = c.replace(/\s+/g, '').toUpperCase()
            if (seenAddr.has(flat)) continue
            seenAddr.add(flat)
            addresses.push(c)
          }
          // Still fired without awaiting — History lands when it lands, like
          // the remote read before it; only now it may be several contracts.
          void Promise.allSettled(
            addresses.map((a) =>
              (heartbeat ? refreshTransactionHead(a, 1000) : getNimiqTransactionHistory(a, 1000))
                .then((rows) => rows.map((t) => ({ ...t, remote: true })))
            )
          ).then((settled) => {
            const next: NimiqTx[] = []
            const seenHash = new Set<string>()
            for (const r of settled) {
              if (r.status !== 'fulfilled') continue // allSettled: one failed contract, not a failure
              for (const t of r.value) {
                if (seenHash.has(t.hash)) continue
                seenHash.add(t.hash)
                next.push(t)
              }
            }
            if (next.length > 0) {
              setRemoteTxs((prev) => (sameTxList(prev, next) ? prev : next))
            } else {
              // Every read failed (or there is nothing to read): today's
              // behaviour, an empty list.
              setRemoteTxs((prev) => (prev.length === 0 ? prev : []))
            }
          })
        } else {
          setRemoteTxs((prev) => (prev.length === 0 ? prev : []))
        }
        // The history, the staker record and the chain head land together, so the
        // statement (which reads the first two) is built once rather than twice.
        const [txs, staking, head] = await Promise.all([txsRead, stakingRead, getCurrentBlock()])
        setNimTxs((prev) => (sameTxList(prev, txs) ? prev : txs))
        // From here the first read for this address has answered, even if the
        // answer is a real zero. Later refreshes keep the figures, not "Loading…".
        setHistoryReadyAddress(cleanAddr(addr))
        if (staking.ok) {
          setStakingHolding((prev) =>
            sameStakingHolding(prev, staking.holding) ? prev : staking.holding
          )
        }
        const freshHolding = staking.holding
        // Chain head — needed to tell whether a retire is already valid. Comes
        // from the Pay provider when there is one, otherwise the public RPC
        // (see wallet.getCurrentBlock). Best effort: an unknown height keeps
        // the previous one and the 10s auto-refresh picks it up next pass.
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
        const sweepDue = contractSweepRef.current !== sweepKey
        if (sweepDue) {
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
          // Nimiq Pay's relay address holds nothing itself — the money is in
          // the HTLC it forwarded into, so this is the user's real balance.
          // Same tx-derived sweep as the two above, so it joins their paced
          // section and their cache key. (A counterparty claiming out of the
          // contract writes no tx to *this* address, so the figure only
          // refreshes once the tx list moves or the app reloads.)
          try {
            setHtlcInTransit(await getHtlcInTransit(addr, txs))
          } catch (e) {
            console.warn('HTLC in-transit lookup failed:', e)
            swept = false
            setHtlcInTransit(0)
          }
          // Only a clean sweep is worth remembering — a failed one must retry
          // on the next tick rather than cache its empty result.
          if (swept) contractSweepRef.current = sweepKey
        }
        // Archive the history of every settled Pay contract and pick up the
        // live ones (see lib/payContracts.ts). Deliberately NOT tied to the
        // sweep's `swept` retry: the public RPC rate-limits bursts, and an
        // archive pass that re-armed the whole sweep made every tick re-run
        // ~20 holdings lookups plus the archive, which 429'd the next pass
        // into the same state (measured: 200+ rejected calls a minute).
        // It runs when the tx list changed, or when an unfinished pass is due:
        // a pass that only ran out of budget continues on the next tick, one
        // that hit a failed lookup backs off (15s; doubling to 2 min only while
        // passes make no progress).
        // Gated on a Pay session naming a remote address; Hub and demo have none.
        if (
          acc.remoteAddress &&
          !archiveBusyRef.current &&
          (sweepDue || (archivePendingRef.current && Date.now() >= archiveNextAtRef.current))
        ) {
          archiveBusyRef.current = true
          try {
            const synced = await syncContractArchive(addr, ownFundedContracts(txs, addr), {
              fetchAccount: getContractAccount,
              fetchTxs: (a) => getNimiqTransactions(a, 100, null),
            })
            // Progress = this pass archived at least one more contract. A pass
            // that progressed and then hit a 429 retries soon; only passes
            // that get nowhere back off harder.
            const progressed = synced.finals.size > archiveFinalsRef.current.size
            archiveFinalsRef.current = synced.finals
            const nextArchive = synced.finalTxs.map((t) => ({ ...t, remote: true }))
            setArchiveTxs((prev) => (sameTxList(prev, nextArchive) ? prev : nextArchive))
            const firstLive = synced.live.slice(0, 3)
            liveContractsRef.current = firstLive
            setLiveContracts((prev) =>
              prev.length === firstLive.length && prev.every((v, i) => v === firstLive[i])
                ? prev
                : firstLive
            )
            if (synced.complete) {
              archivePendingRef.current = false
              archiveBackoffRef.current = ARCHIVE_BACKOFF_MIN_MS
            } else if (synced.failed) {
              if (progressed) archiveBackoffRef.current = ARCHIVE_BACKOFF_MIN_MS
              archivePendingRef.current = true
              archiveNextAtRef.current = Date.now() + archiveBackoffRef.current
              if (!progressed) {
                archiveBackoffRef.current = Math.min(archiveBackoffRef.current * 2, ARCHIVE_BACKOFF_MAX_MS)
              }
            } else {
              // Budget spent, nothing failed: carry on with the next tick.
              archivePendingRef.current = true
              archiveNextAtRef.current = 0
            }
          } catch (e) {
            console.warn('Pay contract archive sync failed:', e)
            archivePendingRef.current = true
            archiveNextAtRef.current = Date.now() + archiveBackoffRef.current
            archiveBackoffRef.current = Math.min(archiveBackoffRef.current * 2, ARCHIVE_BACKOFF_MAX_MS)
          } finally {
            archiveBusyRef.current = false
          }
        }
        // Reward income lives in a separate v2 API (the tx index has no
        // staking activity at all): every period back to January 2025, cached
        // per chunk, additive and already failure-tolerant - a non-staker
        // simply has none, and a failed chunk keeps its cached rows.
        try {
          const rewards = await getAllRestakeRewardTxs(addr)
          setRewardTxs((prev) => (sameTxList(prev, rewards.txs) ? prev : rewards.txs))
          setRewardsComplete(rewards.complete)
        } catch (e) {
          // A failed lookup keeps the reward rows already on screen.
          console.warn('Restake events lookup failed:', e)
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

  // The redirect login above hands back an account, not a connect click, so
  // nothing has loaded the books for it yet. Mount-only: every other path into
  // an account already calls refresh itself.
  //
  // The same pass picks up a session the WebView threw away (see `restoring`).
  // It runs once, and a failed restore clears the saved record, so there is
  // nothing here that can retry itself into a loop.
  useEffect(() => {
    const redirected = getConnectedAccount()
    if (redirected) {
      warmLightClient()
      void refresh(redirected)
      return
    }
    if (!restoring) return
    // A saved wallet is about to come back: warm the client while the host is
    // asked, so consensus overlaps the restore instead of following it.
    warmLightClient()
    void (async () => {
      let acc: WalletAccount | null = null
      try {
        acc = await restoreWalletSession()
      } catch (e) {
        console.warn('Session restore failed:', e)
      }
      if (!acc) {
        // Nothing (or nothing usable) to come back to: the connect screen, as
        // before. (restoreWalletSession returns null only when there is no
        // saved session or no Pay host at all — it never wipes a record on a
        // transient provider failure, so the next boot can still restore.)
        setRestoring(false)
        return
      }
      // Demo story data goes in before the account lands, exactly as on the
      // connect path. seedDemoData is an idempotent upsert, so a restore never
      // duplicates what is already there.
      if (acc.provider === 'demo' && acc.nimiqAddress) seedDemoData(acc.nimiqAddress)
      const savedView = getSavedSessionView()
      // One batch, so the connect screen never flashes between the two:
      // `restoring` only goes false with an account in hand.
      if (isView(savedView)) setView(savedView)
      setPayConsensus(acc.consensus ?? null)
      setAccount(acc)
      setRestoring(false)
      // From here it is an ordinary connect: same refresh, same books.
      await refresh(acc)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the saved session pointing at the tab the user is on, so back from the
  // explorer lands on History rather than the dashboard. No-ops when nothing is
  // saved (Hub, or a browser outside Nimiq Pay).
  useEffect(() => {
    if (!account) return
    saveSessionView(view)
  }, [view, account])

  // One ledger for everything that counts as a transaction: indexed txs, the
  // wallet's remote HTLC relay txs, plus the synthesized reward rows, newest
  // first. History, the CSV and the statement all read this, so they can never
  // disagree about income.
  // (The balance trajectory in Analytics is the exception — see below.)
  const allTxs = useMemo(() => {
    // Deduped by hash: a transfer between the wallet's basic address and its
    // own relay — the funding hop the whole Pay model runs on — is returned by
    // *both* address indexes. Merged raw it becomes two History rows sharing a
    // React key, a duplicate CSV line, and double-counted sent/fees in the tax
    // statement. The basic-address row wins; the relay copy is the same tx.
    // The remote side is the current Pay contract's history plus the archived
    // settled ones (see lib/payContracts.ts). A contract that settles around
    // its last read can appear in both lists — archive rows lose, deduped by
    // hash against everything already merged.
    const seen = new Set(nimTxs.map((t) => t.hash))
    const base = [...nimTxs]
    for (const t of [...remoteTxs, ...archiveTxs]) {
      if (seen.has(t.hash)) continue
      seen.add(t.hash)
      base.push(t)
    }
    // The on-demand older-history window rides in here, deduped against the
    // base rows — the loader dedupes against the localStorage cache, but that
    // cache is behind a TTL and can drift from the lists actually on screen.
    if (extendedHistory) {
      const extendedSeen = new Set(base.map((t) => t.hash))
      base.push(...extendedHistory.filter((t) => !extendedSeen.has(t.hash)))
    }
    if (rewardTxs.length === 0) return base
    return [...base, ...rewardTxs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  }, [nimTxs, remoteTxs, archiveTxs, rewardTxs, extendedHistory])

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
  // Contracts that still hold the user's NIM, for Analytics' netting of internal
  // HTLC transfers: every HTLC the sweep found, plus the remote account when Pay
  // names one. Memoised so the netting in Analytics is not redone every render.
  const analyticsHeldContracts = useMemo(
    () => [
      ...htlcHoldings.map((h) => h.address),
      ...(account?.remoteAddress ? [account.remoteAddress] : []),
      // Pay contracts the sync found still live: they hold the wallet's money
      // the same way the named remote account does. Analytics normalises and
      // de-duplicates these internally, overlaps here are harmless.
      ...liveContracts,
    ],
    [htlcHoldings, account?.remoteAddress, liveContracts]
  )
  // Analytics reads the contract-side rows (payments and stakes made inside
  // Pay went straight out of the contract — they never touch the basic list).
  // Merged and deduped here once; `txs` (the basic list) stays untouched, the
  // contract rows ride in via the `contractTxs` netting input.
  const contractTxsForAnalytics = useMemo(() => {
    const seen = new Set<string>()
    const out: NimiqTx[] = []
    for (const t of [...remoteTxs, ...archiveTxs]) {
      if (!t?.hash || seen.has(t.hash)) continue
      seen.add(t.hash)
      out.push(t)
    }
    return out
  }, [remoteTxs, archiveTxs])
  // Real, third-party incoming payments: rows the Analytics netting (above)
  // confirms actually landed in the wallet. Nimiq Pay moves NIM between its
  // own HTLC contracts constantly; a return leg with realIn 0, a failed tx, a
  // self transfer, and anything addressed elsewhere all stop at the gate.
  // Reward rows are synthetic and never pass the `synthetic` check. This is
  // the pool the "stake it?" nudge picks from - see lib/earnInsights.stakeNudge.
  const incomingPayments = useMemo(() => {
    const own = account?.nimiqAddress
    if (!own) return []
    const ownFlat = cleanAddr(own)
    const remoteFlat = account.remoteAddress ? cleanAddr(account.remoteAddress) : null
    const splits = splitHtlcFlows(allTxs, own, {
      heldContracts: analyticsHeldContracts,
      contractTxs: contractTxsForAnalytics,
    })
    return allTxs.filter((t) => {
      if (!t?.hash || t.synthetic || t.executionResult === false) return false
      const rec = cleanAddr(t.recipient)
      if (rec !== ownFlat && (!remoteFlat || rec !== remoteFlat)) return false
      const sp = splits.get(t.hash)
      return !!sp && sp.realIn > 0
    })
  }, [allTxs, account?.nimiqAddress, account?.remoteAddress, analyticsHeldContracts, contractTxsForAnalytics])

  // History's filters read the same netting Analytics does, with exactly the
  // inputs Analytics passes (see the `Analytics` element below): the basic list
  // for the tx rows, the held contracts and the contract-side rows that decide
  // how much of a Pay round trip was really the user's money. Computed once
  // here so the chip counts, the list and the totals share one map.
  const historyFlows = useMemo(() => {
    const own = account?.nimiqAddress
    if (!own) return new Map()
    return splitHtlcFlows(nimTxs, own, {
      heldContracts: analyticsHeldContracts,
      contractTxs: contractTxsForAnalytics,
    })
  }, [nimTxs, account?.nimiqAddress, analyticsHeldContracts, contractTxsForAnalytics])
  const historyCtx = useMemo<HistoryCtx>(
    () => ({
      own: account?.nimiqAddress ?? '',
      remote: account?.remoteAddress ?? null,
      flows: historyFlows,
      hideInternal: hideInternalHistory,
    }),
    [account?.nimiqAddress, account?.remoteAddress, historyFlows, hideInternalHistory]
  )
  const historyCountsByFilter = useMemo(
    () => historyCounts(historyTxs, historyCtx),
    [historyTxs, historyCtx]
  )
  const historyFiltered = useMemo(
    () => filterHistory(historyTxs, historyFilter, historyCtx),
    [historyTxs, historyFilter, historyCtx]
  )
  // Over ALL filtered rows, never the visible page: Load more must not move
  // the summary figure.
  const historyFilterSummary = useMemo(
    () => historySummary(historyTxs, historyFilter, historyCtx),
    [historyTxs, historyFilter, historyCtx]
  )
  const historyHasInternal = useMemo(
    () => hasInternalTransfers(historyTxs, historyCtx),
    [historyTxs, historyCtx]
  )
  const rewardMonths = useMemo(
    () => (historyFilter === 'rewards' ? groupRewardsByMonth(historyFiltered) : []),
    [historyFilter, historyFiltered]
  )
  // A new wallet never inherits the previous one's filter or page depth.
  useEffect(() => {
    setHistoryFilter('all')
    setVisibleTxCount(INITIAL_VISIBLE_TX)
    setRewardMonthToggles({})
  }, [account?.nimiqAddress])
  // Analytics lives on Overview and writes the shared key from its own state,
  // so a switch flipped there must be picked up when History opens: re-read
  // the stored preference on every entry to the History tab.
  useEffect(() => {
    if (view !== 'history') return
    try {
      setHideInternalHistory(localStorage.getItem('nimbooks:analytics:filterHtlc') === 'true')
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
  }, [view])
  // One stored preference for both screens: Analytics reads this key on mount,
  // so writing it on every change keeps the two Hide internal switches in step.
  useEffect(() => {
    try {
      localStorage.setItem('nimbooks:analytics:filterHtlc', String(hideInternalHistory))
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
  }, [hideInternalHistory])
  const pickHistoryFilter = (filter: HistoryFilter) => {
    if (filter === historyFilter) return
    setHistoryFilter(filter)
    setVisibleTxCount(INITIAL_VISIBLE_TX)
  }
  const toggleRewardMonth = (key: string, openByDefault: boolean) => {
    setRewardMonthToggles((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? openByDefault),
    }))
  }

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
  // The HTLC figure every total is built on. Three views of the same money,
  // all overlapping, so the effective figure is the largest and never a sum —
  // adding them would double-count a wallet whose stored funds are also an
  // open swap, which is the common case.
  //
  // `remoteAccountLuna` is authoritative where the provider offers it: Nimiq
  // Pay names the HTLC holding the funds, so no discovery is involved and no
  // contract can be missed. `lockedLuna` still counts, because a pending swap
  // the user is the *recipient* of isn't in their own remote account at all.
  // With no remote account (Hub, demo, or a lookup that failed) this falls
  // back to the scan pair: `lockedLuna` for swaps still pending, and
  // `htlcInTransit` for every contract this address funded that still holds
  // NIM (the relay case — see getHtlcInTransit).
  const htlcLuna =
    remoteAccountLuna !== null
      ? Math.max(remoteAccountLuna, lockedLuna)
      : Math.max(lockedLuna, htlcInTransit)
  // Money the user can spend or is about to receive: the basic account plus
  // anything in flight through an HTLC. This — not the basic balance — is what
  // Nimiq Pay shows as the wallet's balance, and what anchors the trajectory.
  const effectiveBalanceLuna = (Number(nimBalance) || 0) + htlcLuna
  const offBalanceLuna = htlcLuna + stakedLuna + vestedLuna
  const totalNimLuna = effectiveBalanceLuna + stakedLuna + vestedLuna
  // No cached rows and the first history read for this address is still
  // running: the totals below are not known yet. Show a neutral placeholder
  // rather than a $0.00 / 0 NIM that would read as an empty wallet. Cached rows
  // and the 10s heartbeat keep today's figures (historyReadyAddress matches).
  const historyPendingFirstLoad =
    !!account?.nimiqAddress &&
    loading &&
    nimTxs.length === 0 &&
    historyReadyAddress !== cleanAddr(account.nimiqAddress)
  const lightLoadActive = !!account?.nimiqAddress && loading

  const totalFiat = useMemo(() => {
    let total = 0
    let unknown = false
    // Priced off the same effective total as the NIM tile, so the two can
    // never disagree about how much the wallet holds. An asset with a
    // balance but no usable price makes the WHOLE total unknown - and when
    // the price itself is unknown the total is unknown even while the
    // balance is still loading: it can never silently become 0 and read as
    // $0.00.
    if (hasRate(shown.nim)) {
      if (nimBalance !== null) total += (totalNimLuna / 100000) * shown.nim
    } else if (nimBalance === null || totalNimLuna > 0) {
      unknown = true
    }
    for (const b of evmBalances) {
      const val = Number(b.balance) / 10 ** b.decimals
      if (!Number.isFinite(val)) continue
      if (b.symbol === 'USDT') {
        if (hasRate(shown.usdt)) total += val * shown.usdt
        else if (val > 0) unknown = true
      } else if (b.symbol === 'POL') {
        if (hasRate(shown.pol)) total += val * shown.pol
        else if (val > 0) unknown = true
      } else {
        if (hasRate(shown.eth)) total += val * shown.eth
        else if (val > 0) unknown = true
      }
    }
    if (unknown) return NaN
    return Number.isFinite(total) ? total : 0
  }, [nimBalance, totalNimLuna, evmBalances, shown])

  // Flag/label for the chip on the Total value tile. Falls back to the first
  // entry so a stale saved code can never blank the chip. Currencies without
  // a flag file show a neutral code badge instead of a broken image.
  const cur = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0]

  // "as of HH:MM" (local time) next to Total value, shown only when the price
  // on screen is an old cached one (older than 30 minutes): better to date a
  // number than present a stale one as live.
  const PRICE_FRESH_MS = 30 * 60 * 1000
  const totalFiatAsOf = priceStatus?.asOf ?? null
  const totalFiatSubNote: string | null =
    Number.isFinite(totalFiat) &&
    totalFiatAsOf !== null &&
    Date.now() - totalFiatAsOf > PRICE_FRESH_MS
      ? `as of ${new Date(totalFiatAsOf).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : null

  // --- Send / Receive (Overview quick actions) ---

  // What the wallet can actually put in a transaction: the basic balance plus
  // anything in flight through an HTLC, since Nimiq Pay's wallet funds a
  // payment straight out of a swap contract (same ceiling the stake slider
  // uses). Derived from the same figure the NIM tile shows, so the sheet can
  // never offer more than the Overview claims the user has.
  const sendMaxLuna = Math.max(0, effectiveBalanceLuna)
  const sendLuna = parseNimToLuna(sendAmount)
  const sendMemoBytes = memoByteLength(sendMemo.trim())
  const sendToClean = cleanAddr(sendTo)
  const sendToValid = isValidNimiqAddress(sendTo)
  const sendToSelf =
    sendToValid && !!account?.nimiqAddress && sendToClean === cleanAddr(account.nimiqAddress)
  const sendAmountOverBalance = !!sendLuna && Number(sendLuna) > sendMaxLuna
  const sendReady =
    sendToValid && !!sendLuna && !sendAmountOverBalance && sendMemoBytes <= MAX_TX_MEMO_BYTES
  const sendBusy = sendState === 'sending' || sendState === 'locating' || sendState === 'unconfirmed'
  // Every submit takes a ticket; only the current one may write back into the
  // sheet. Closing bumps it, so a hash lookup still running can never reopen
  // a sheet the user has dismissed (same idea as stakeVerifyRef below).
  const sendTicketRef = useRef(0)

  // One place to end the burst: the timer and the hash go together, so no path
  // can leave confetti on screen or a timeout pointing at a sheet that is gone.
  const clearSendCelebration = useCallback(() => {
    if (sendCelebrateTimer.current) window.clearTimeout(sendCelebrateTimer.current)
    sendCelebrateTimer.current = null
    setSendCelebrate(null)
  }, [])

  // --- Cashlink sheet: create a claimable link, present it (link, QR, share)
  // and shelve it locally so it can be re-copied or reverted later. ---

  // The link is funded by an ordinary send, so it lives under the same parser
  // and the same ceiling as the send sheet above.
  const cashlinkLuna = parseNimToLuna(cashlinkAmount)
  const cashlinkAmountOverBalance = !!cashlinkLuna && Number(cashlinkLuna) > sendMaxLuna
  const cashlinkAmountReady = !!cashlinkLuna && !cashlinkAmountOverBalance

  const refreshCashlinkStatuses = async (from: string) => {
    // The onboarding tour runs on a static snapshot — chain refreshes mid-walk
    // re-sort the shelf and move the spotlight, so they stand still too.
    if (tour.phase === 'active') return
    for (const entry of loadCashlinks(from)) {
      try {
        const balance = Number(await getNimiqBalance(entry.address))
        // Only a link this device has actually seen funded may fall to
        // 'Claimed or reverted'. A zero balance on a link that was never
        // observed funded proves nothing — the funding may still be in flight,
        // or the indexer may simply be behind the broadcast — and calling it
        // finished is what would offer to delete a key that still holds NIM.
        const status =
          balance > 0
            ? 'Ready to claim'
            : entry.status === 'Ready to claim'
              ? 'Claimed or reverted'
              : entry.status === 'Funding…' || entry.status === 'Not funded yet'
                ? 'Not funded yet'
                : entry.status
        if (status !== entry.status) updateCashlink(from, entry.address, { status })
      } catch {
        /* one unreadable link must not block the rest */
      }
      setCashlinkHistory(loadCashlinks(from))
    }
    setCashlinkHistory(loadCashlinks(from))
  }

  const openCashlink = () => {
    setCashlinkError(null)
    setCashlinkResult(null)
    setCashlinkBusy(false)
    setCashlinkAmount('')
    setCashlinkMessage('')
    const from = account?.nimiqAddress
    setCashlinkHistory(from ? loadCashlinks(from) : [])
    // The sheet replaces the send sheet — never stacked.
    setSendOpen(false)
    setCashlinkOpen(true)
    // Warm the signer (key generation) while the amount is being typed.
    setCashlinkSignerReady(cashlinkCoreReady())
    if (!cashlinkCoreReady()) {
      void prepareCashlinkCore().then((ready) => setCashlinkSignerReady(ready))
    }
    // Chain status moves while the sheet is closed — refresh the shelf.
    if (from) void refreshCashlinkStatuses(from)
  }

  // Memoised on `cashlinkBusy` for the shared Escape handler (like closeSend):
  // mid-signature, the sheet stays put.
  const closeCashlink = useCallback(() => {
    if (cashlinkBusy) return
    setCashlinkOpen(false)
  }, [cashlinkBusy])

  const submitCashlink = async () => {
    if (cashlinkSubmittingRef.current) return
    // Parsed and capped exactly like the send sheet: same parser, same
    // ceiling, so a link can never be armed for more than the wallet holds and
    // no amount is silently rounded behind the user's back.
    if (!cashlinkLuna) {
      setCashlinkError('Enter an amount above 0 with at most 5 decimals (max 2,000,000,000 NIM).')
      return
    }
    if (Number(cashlinkLuna) > sendMaxLuna) {
      setCashlinkError(
        `Only ${formatLuna(String(sendMaxLuna), lang)} NIM is available to send right now.`
      )
      return
    }
    const valueLuna = Number(cashlinkLuna)
    const from = account?.nimiqAddress
    if (!from || !canSend()) {
      setCashlinkError('Connect a wallet that can send to create a cashlink.')
      return
    }
    // Everything from here to the wallet call is synchronous on purpose: the
    // Hub popup (or Pay approval) must fire from the click's own task. The
    // signer was warmed when the sheet opened; keygen below is sync.
    if (!cashlinkCoreReady()) {
      setCashlinkError('Still preparing the signer — one moment, then tap again.')
      return
    }
    let fresh: { secret: string; address: string }
    try {
      fresh = newCashlink(valueLuna, cashlinkMessage.trim())
    } catch (e) {
      setCashlinkError(e instanceof Error ? e.message : 'Could not generate the link.')
      return
    }
    cashlinkSubmittingRef.current = true
    setCashlinkBusy(true)
    setCashlinkError(null)
    // The key must exist on this device before any NIM moves, so the link can
    // always be reverted.
    const entry: StoredCashlink = {
      address: fresh.address,
      secret: fresh.secret,
      valueLuna,
      message: cashlinkMessage.trim(),
      status: 'Funding…',
      from,
      createdAt: Date.now(),
    }
    const saved = saveCashlink(entry)
    if (!saved.ok) {
      // No key on the device means no way back: refuse before any NIM moves.
      setCashlinkError(
        saved.reason === 'limit'
          ? `You already have ${CASHLINK_ACTIVE_LIMIT} active links saved. Claim, revert or remove one first.`
          : 'This device could not store the link, so nothing was sent. Free up storage and try again.'
      )
      cashlinkSubmittingRef.current = false
      setCashlinkBusy(false)
      return
    }
    setCashlinkHistory(loadCashlinks(from))
    noteUnbacked()
    // Everything the successful funding leg does, as one local step — shared
    // with the Pay "outcome unknown" catch, which must behave as
    // funded-in-flight (the money may be out) rather than as a failure.
    const finalizeFunding = (initialHash: string | null) => {
      clearTxCache() // the funding must show up on the next History load
      if (account) void refresh(account)
      setCashlinkResult({
        address: fresh.address,
        secret: fresh.secret,
        valueLuna,
        message: entry.message,
        status: 'Funding…',
      })
      setCashlinkHistory(loadCashlinks(from))
      // The hash is bookkeeping only (current Pay builds hand it back; older
      // ones did not) — recover it in the background when missing so the
      // result card appears immediately.
      void (async () => {
        if (initialHash) {
          updateCashlink(from, fresh.address, { fundingTx: initialHash })
          return
        }
        try {
          const found = await findSentTx(
            from,
            fresh.address,
            String(valueLuna),
            encodeMemo('Cashlink')
          )
          if (found?.hash) updateCashlink(from, fresh.address, { fundingTx: found.hash })
        } catch {
          /* the funding is in flight either way; the shelf tracks by balance */
        }
      })()
      // Flip the label once the funding lands (two timed checks, no polling).
      const settle = (delays: number[]) => {
        const [next, ...rest] = delays
        if (next === undefined) return
        window.setTimeout(() => {
          void (async () => {
            try {
              const balance = Number(await getNimiqBalance(fresh.address))
              if (balance > 0) {
                // Balance visible on the link address means the funding mined —
                // drop the tx cache again so the next History walk is fresh.
                clearTxCache()
                updateCashlink(from, fresh.address, { status: 'Ready to claim' })
                setCashlinkHistory(loadCashlinks(from))
                setCashlinkResult((prev) =>
                  prev && prev.address === fresh.address ? { ...prev, status: 'Ready to claim' } : prev
                )
              } else {
                settle(rest)
              }
            } catch {
              settle(rest)
            }
          })()
        }, next)
      }
      settle([4000, 8000])
    }
    try {
      const res = await sendNim({
        recipient: fresh.address,
        amountLuna: String(valueLuna),
        memo: 'Cashlink',
        extraData: FUNDING_DATA,
        from,
      })
      finalizeFunding(res.hash)
    } catch (e) {
      if (e instanceof TxOutcomeUnknownError) {
        // Pay could not say whether the funding went out. Treat it as
        // funded-in-flight: run the same success path (Pay kept the staged
        // hash when it has one), and keep the key — revert stays possible
        // once the funding lands. Never removeCashlink on this error.
        finalizeFunding(e.hash)
      } else {
        const message = errorText(e)
        if (/cancel|denied|reject|abort/i.test(message)) {
          // Nothing was sent — the unused key can go.
          removeCashlink(from, fresh.address)
          setCashlinkHistory(loadCashlinks(from))
          setCashlinkError('Request cancelled - nothing was sent.')
        } else {
          // Keep the key: the send may still be in flight.
          setCashlinkError(message || 'The cashlink could not be funded.')
        }
      }
    } finally {
      cashlinkSubmittingRef.current = false
      setCashlinkBusy(false)
    }
  }

  const confirmRevertCashlink = async () => {
    if (cashlinkRevertBusyRef.current) return
    const target = cashlinkRevertTarget
    const from = account?.nimiqAddress
    if (!target || !from) return
    cashlinkRevertBusyRef.current = true
    setCashlinkRevertBusy(true)
    setCashlinkError(null)
    try {
      const res = await sweepCashlink(target.secret, from)
      if (!res.ok) {
        setToast(res.error)
        return
      }
      clearTxCache() // the incoming NIM must show up on the next History load
      if (account) void refresh(account)
      updateCashlink(from, target.address, { status: 'Reverted ✓' })
      setCashlinkHistory(loadCashlinks(from))
      setCashlinkResult((prev) =>
        prev && prev.address === target.address ? { ...prev, status: 'Reverted ✓' } : prev
      )
      setToast('Cashlink reverted — the NIM is on its way back to your wallet.')
    } finally {
      cashlinkRevertBusyRef.current = false
      setCashlinkRevertBusy(false)
      setCashlinkRevertTarget(null)
    }
  }

  // Forgetting a row throws away the link's private key, which is kept nowhere
  // else — so it goes through a confirmation of its own, and the dialog says
  // plainly what a never-funded link would cost.
  const confirmRemoveCashlink = () => {
    const target = cashlinkRemoveTarget
    const from = account?.nimiqAddress
    if (target && from) {
      removeCashlink(from, target.address)
      setCashlinkHistory(loadCashlinks(from))
    }
    setCashlinkRemoveTarget(null)
  }

  const copyCashlinkLink = (link: string | null) => {
    if (!link) return
    navigator.clipboard?.writeText(link).then(
      () => setToast('Cashlink link copied!'),
      () => setToast('Could not copy — long-press the link instead.')
    )
  }

  const shareCashlink = async (link: string | null) => {
    if (!link) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'NimBooks cashlink', url: link })
      } catch {
        /* the user closed the share sheet — nothing to report */
      }
      return
    }
    copyCashlinkLink(link)
  }

  const openSend = () => {
    sendTicketRef.current++
    setSendError(null)
    setSendHash(null)
    setSendUnconfirmedChecked(false)
    // A reopen starts clean: the previous payment's burst must never decorate
    // a fresh, empty form.
    clearSendCelebration()
    setSendState('idle')
    setSendOpen(true)
  }

  // The changelog's support link: the modal closes and the send sheet opens
  // already addressed, the memo naming the cause. The amount stays empty: a
  // suggestion of how much to give is not NimBooks' business.
  const openDonationFromChangelog = () => {
    setChangelogOpen(false)
    setSendTo(DONATION_ADDRESS)
    setSendMemo(DONATION_MEMO)
    openSend()
  }

  // Memoised on `sendState` so the Escape handler below can depend on it and
  // always hold a current copy — a stale one would think it may close.
  const closeSend = useCallback(() => {
    // 'sending' is the one state that stays put: the wallet is asking for a
    // signature, and its answer has to land somewhere the user can see.
    if (sendState === 'sending') return
    sendTicketRef.current++
    // From 'locating' on, the payment may already be broadcast — the form is
    // spent, and clearing it is what stops the same amount going out a second
    // time ('unconfirmed' is included on purpose: an unconfirmed Pay submit is
    // exactly the case where a second send is the big risk). A sheet closed without
    // sending keeps what was typed.
    if (sendState === 'locating' || sendState === 'sent' || sendState === 'unconfirmed') {
      setSendTo('')
      setSendAmount('')
      setSendMemo('')
    }
    // Closing mid-celebration (Done, Escape, overlay tap) takes the confetti
    // and its timer with it — the bumped ticket above stops a verification
    // still in flight from starting a new one.
    clearSendCelebration()
    setSendState('idle')
    setSendOpen(false)
  }, [sendState, clearSendCelebration])

  // Confetti on the success screen, no gating: the wallet signed and the
  // payment is out — the "Payment sent" dialog IS the trigger. (The hash can
  // trail on the indexer for a few seconds; the celebration doesn't wait.)
  const celebrateSend = (ticket: number) => {
    if (isDemoMode()) return
    if (sendTicketRef.current !== ticket) return
    setSendCelebrate(`sent-${ticket}`)
    if (sendCelebrateTimer.current) window.clearTimeout(sendCelebrateTimer.current)
    sendCelebrateTimer.current = window.setTimeout(() => {
      sendCelebrateTimer.current = null
      setSendCelebrate(null)
    }, CONFETTI_MS)
  }

  const submitSend = async () => {
    const from = account?.nimiqAddress
    if (!from) return
    // Double-submit guard: a second tap while the wallet is signing would ask
    // for a second signature on the same payment.
    if (sendBusy) return
    // A new attempt never inherits the previous payment's burst.
    clearSendCelebration()
    if (!sendToValid) {
      setSendError("That doesn't look like a Nimiq address. Check every character — a send can't be undone.")
      return
    }
    const luna = parseNimToLuna(sendAmount)
    if (!luna) {
      setSendError('Enter an amount above 0 with at most 5 decimals (max 2,000,000,000 NIM).')
      return
    }
    // The ceiling can shrink between opening the sheet and submitting (a swap
    // settles, the 10s refresh lands), so it is re-checked at submit time.
    if (Number(luna) > sendMaxLuna) {
      setSendError(`Only ${formatLuna(String(sendMaxLuna), lang)} NIM is available to send right now.`)
      return
    }
    const memo = sendMemo.trim()
    if (memoByteLength(memo) > MAX_TX_MEMO_BYTES) {
      setSendError(`The note is too long. Nimiq allows ${MAX_TX_MEMO_BYTES} bytes on a transaction.`)
      return
    }
    setSendError(null)
    setSendState('sending')
    const ticket = ++sendTicketRef.current
    let hash: string | null = null
    try {
      // Plain UTF-8 memo: the adapter hands it to Pay as text (Pay hex-encodes
      // the data itself) and encodes it for the Hub — see wallet.sendNim.
      const result = await sendNim({
        recipient: sendToClean,
        amountLuna: luna,
        ...(memo ? { memo } : {}),
        from,
      })
      clearTxCache() // the new payment must show up on the next History load
      // A refresh that lands in the next second or two can beat the indexer and
      // cache a list without this payment in it, which the 2-minute TTL would
      // then hold. One delayed clear (the cashlink funding settles the same
      // way) hands the 10s tick a clean slate.
      window.setTimeout(() => clearTxCache(), 6000)
      hash = result.hash
      if (sendTicketRef.current === ticket) {
        // The success dialog (and its confetti) appears the INSTANT the
        // wallet signs — nothing waits on the chain or the indexer.
        setSendHash(hash)
        setSendState('sent')
        celebrateSend(ticket)
      }
      // Current Pay builds hand back the tx hash; only older ones (or a miss
      // on Pay's side) leave it null, and then the history lookup recovers it
      // in the background — it only upgrades the explorer link on the success
      // card when the indexer catches up; the celebration already fired.
      if (!hash) {
        void (async () => {
          try {
            const found = await findSentTx(from, sendToClean, luna, memo ? encodeMemo(memo) : undefined)
            if (found?.hash && sendTicketRef.current === ticket) {
              setSendHash(found.hash)
            }
          } catch {
            /* indexer hiccup — the card keeps its generic copy */
          }
        })()
      }
    } catch (e) {
      // Pay's "outcome unknown": it may have signed and submitted this exact
      // payment but cannot say so. Never invite a retry — drop the cached
      // history (the tx may already be indexed), park the sheet on the
      // unconfirmed card, and look the payment up on chain in the background,
      // ticket-guarded like the other async upgrades so a closed or reused
      // sheet never reads a stale result.
      if (e instanceof TxOutcomeUnknownError && sendTicketRef.current === ticket) {
        clearTxCache()
        setSendError(null)
        setSendState('unconfirmed')
        setSendHash(null)
        void (async () => {
          let confirmed: string | null = null
          if (e.hash) {
            // Pay kept the staged hash: let the chain settle it. Ten minutes
            // is far inside Nimiq's tx validity window, so 'expired' here
            // genuinely reads as "not on the chain yet", not as proof of loss.
            const result = await waitForTxMined(e.hash, {
              intervalMs: 10_000,
              timeoutMs: 10 * 60_000,
            })
            if (result === 'confirmed') confirmed = e.hash
          } else {
            try {
              const found = await findSentTx(
                from,
                sendToClean,
                luna,
                memo ? encodeMemo(memo) : undefined,
                24,
                5000
              )
              if (found?.hash) confirmed = found.hash
            } catch {
              /* keep 'unconfirmed' — a failed lookup never proves absence */
            }
          }
          if (sendTicketRef.current !== ticket) return
          if (confirmed) {
            // It went out after all: upgrade to the sent card with the same
            // celebration a straight send would have earned.
            setSendHash(confirmed)
            setSendState('sent')
            celebrateSend(ticket)
          } else {
            // Never back to 'idle': the user must not be able to resubmit a
            // payment that may already be out. Just switch the card's copy.
            setSendUnconfirmedChecked(true)
          }
        })()
        if (account) await refresh(account)
        return
      }
      // A dismissed sheet has nowhere to put this — the wallet showed its own
      // rejection, and nothing left this address.
      if (sendTicketRef.current === ticket) {
        setSendState('idle')
        setSendError('Send failed: ' + (errorText(e) || 'The payment was rejected.'))
      }
      return
    }
    // Outside the try above on purpose: the payment is already out, and
    // `refresh` reports its own failures (toast/banner) — a busy node must
    // never turn a sent payment into "Send failed".
    if (account) await refresh(account)
  }

  // --- Staking (Nimiq Pay) ---

  // One place to end the burst — the twin of clearSendCelebration, so no path
  // can leave confetti on screen or a timeout pointing at a panel that is gone.
  const clearStakeCelebration = useCallback(() => {
    if (stakeCelebrateTimer.current) window.clearTimeout(stakeCelebrateTimer.current)
    stakeCelebrateTimer.current = null
    setStakeCelebrate(null)
  }, [])

  // The verification poll outlives the panel — a closed panel still refreshes
  // balances and still owes the user a toast — so it reads whether the panel is
  // on screen off a ref rather than off the render it was started in.
  const stakeOpenRef = useRef(false)
  useEffect(() => {
    stakeOpenRef.current = stakeOpen
  }, [stakeOpen])

  // The unstake finishes on the same two beats as the stake, wherever it was
  // started from. 'expired' goes back to the form (the panel) or takes the
  // window away entirely (the banner modal, which has no form): either way the
  // error and the toast carry it. A submit whose verification hasn't started
  // yet already counts as confirming, so the form can never flash back in
  // between the two.
  const unstakeFlow: 'form' | 'confirming' | 'done' = !unstakeSubmitted
    ? 'form'
    : unstakeVerify === 'confirmed' || unstakeVerify === 'unknown'
      ? 'done'
      : unstakeVerify === 'expired'
        ? 'form'
        : 'confirming'
  // One truth for "the banner's window is on screen", read by the render, the
  // Escape handler and the toast gate alike. The open flag alone would not do:
  // an expired leg leaves it set with nothing left to show, and Escape would
  // then peel a window that isn't there instead of the panel that is.
  const unstakeModalShown =
    unstakeModalOpen && unstakeSubmitted?.source === 'banner' && unstakeFlow !== 'form'

  // Same ref trick as the panel's, for whichever of the two windows this
  // unstake belongs to: the stake panel for a leg started there, the banner's
  // modal for the other two.
  const unstakeWindowOpenRef = useRef(false)
  useEffect(() => {
    unstakeWindowOpenRef.current =
      unstakeSubmitted?.source === 'banner' ? unstakeModalOpen : stakeOpen
  }, [unstakeSubmitted?.source, unstakeModalOpen, stakeOpen])

  // Drops the unstake submit flow's display. Same rule as the stake one: only
  // ever called for a flow that has finished, never for a poll still running.
  const resetUnstakeFlow = useCallback(() => {
    setUnstakeVerify(null)
    setUnstakeSubmitted(null)
    setUnstakeError(null)
  }, [])

  // Done, ✕, Escape and the overlay all land here. Closing never cancels a
  // verification in flight: the poll keeps running, so the stake still lands in
  // History and the toast still fires. Only the submit-flow display resets, and
  // only once that flow is over — reopening mid-check resumes the confirming
  // card instead of a form that looks like nothing ever happened.
  const closeStake = useCallback(() => {
    clearStakeCelebration()
    if (stakeVerify !== 'checking') {
      setStakeVerify(null)
      setStakeSubmitted(null)
      setStakeError(null)
    }
    // An unstake started from this panel finishes in it, so it closes with it,
    // under the same rule.
    if (unstakeSubmitted?.source === 'panel' && unstakeVerify !== 'checking') {
      resetUnstakeFlow()
    }
    setStakeLinkNotice(null)
    // Closing before the validator list lands cancels the pending selection.
    setStakeLinkPendingValidator(null)
    setStakeLinkStakerUnknown(false)
    stakeLinkNoticeBaseRef.current = null
    setStakeOpen(false)
  }, [clearStakeCelebration, stakeVerify, unstakeSubmitted?.source, unstakeVerify, resetUnstakeFlow])

  // Done is the one close that also moves: a finished stake or unstake hands the
  // user back to Overview, where the balance and the banner report what just
  // happened. ✕, Escape and the overlay only close.
  const finishStake = useCallback(() => {
    closeStake()
    setView('dashboard')
  }, [closeStake])

  // The banner modal's twin of closeStake — same "a poll in flight keeps its
  // card" rule, so closing mid-check and tapping the banner again resumes.
  const closeUnstakeModal = useCallback(() => {
    if (unstakeVerify !== 'checking') resetUnstakeFlow()
    setUnstakeModalOpen(false)
  }, [unstakeVerify, resetUnstakeFlow])

  const finishUnstakeModal = useCallback(() => {
    closeUnstakeModal()
    setView('dashboard')
  }, [closeUnstakeModal])

  // The validator list is a big payload (~0.8 MB compressed), so it is fetched
  // fresh only where freshness matters: the stake panel and the yield
  // calculator. The Earn card on Overview shows a yield to every wallet, but
  // takes any cached list for that, so a wallet pays for the download once,
  // when nothing is cached yet. Cached 10 min in chain.ts, so reopening the
  // panel is free.
  useEffect(() => {
    if (!account?.nimiqAddress) return
    const haveList = validators.length > 0
    // Opening the stake panel re-reads a list already in hand. getValidators answers
    // from its own 10-minute cache, so this costs a fetch only once that has lapsed;
    // without it the in-state copy would be as old as the session.
    if (haveList && !stakeOpen && !calcOpen) return
    // The Earn card at the top of Overview needs a yield for everyone, staker
    // or not. Any cached list will do for that (yields move slowly), so the big
    // payload is fetched only when nothing is cached at all.
    if (!haveList && !stakeOpen && !calcOpen) {
      const cached = peekCachedValidators()
      if (cached) {
        setValidators(cached)
        return
      }
    }
    let cancelled = false
    if (!haveList) {
      setValidatorsLoading(true)
      setValidatorsError(null)
    }
    ;(async () => {
      try {
        const list = await getValidators()
        if (!cancelled) setValidators(list)
      } catch (e) {
        // A list already on screen stays put when a re-read fails.
        if (cancelled || haveList) return
        console.warn('Validator list failed:', e)
        setValidatorsError('Validator list unavailable right now. Try again shortly.')
      } finally {
        if (!cancelled && !haveList) setValidatorsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account?.nimiqAddress, stakeOpen, calcOpen, validators.length])

  // When the stake panel is open and the in-memory list has validators but is
  // missing logos (no full logo AND no cached thumbnail, i.e. an old-format
  // cache), trigger ONE forced refresh in the background. Once thumbnails are
  // baked into the cache this never fires, so the picker stops refetching the
  // big payload entirely. Guarded to one attempt per page session; failures
  // are swallowed and the existing list is never cleared.
  useEffect(() => {
    if (!stakeOpen || validators.length === 0) return
    if (validatorLogosRefreshedRef.current) return
    const hasLogos = validators.some((v) => Boolean(v.logo || v.logoSmall))
    if (hasLogos) return

    validatorLogosRefreshedRef.current = true
    ;(async () => {
      try {
        const fresh = await getValidators({ force: true })
        if (fresh && fresh.length > 0) setValidators(fresh)
      } catch (e) {
        console.warn('Validator logos refresh failed:', e)
      }
    })()
  }, [stakeOpen, validators])

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
      sendOpen ||
      cashlinkOpen ||
      receiveOpen ||
      unstakeModalShown ||
      !!downloadLink ||
      !!backupMode
    if (!anyOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmUnstakeOpen) {
        setConfirmUnstakeOpen(false)
        return
      }
      // The remove confirmation sits above the cashlink sheet too, and peels
      // first — the key it deletes cannot be brought back.
      if (cashlinkRemoveTarget) {
        setCashlinkRemoveTarget(null)
        return
      }
      if (cashlinkRevertTarget) {
        setCashlinkRevertTarget(null)
        return
      }
      // The banner modal stands alone over Overview, so it peels on its own —
      // and closeUnstakeModal keeps a verification still running.
      if (unstakeModalShown) {
        closeUnstakeModal()
        return
      }
      // The send sheet peels on its own (it is never stacked under another),
      // and closeSend refuses while a signature is in flight — the result of
      // that payment must not disappear behind a stray key press.
      if (sendOpen) {
        closeSend()
        return
      }
      // The cashlink sheet likewise peels on its own, and refuses mid-signature.
      if (cashlinkOpen) {
        closeCashlink()
        return
      }
      if (receiveOpen) {
        setReceiveOpen(false)
        return
      }
      // Escape mid-celebration must not leave a stale timer behind either —
      // closeStake owns that, along with resetting a finished submit flow.
      closeStake()
      setCurrencyOpen(false)
      setChangelogOpen(false)
      setDownloadLink(null)
      setBackupMode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    stakeOpen,
    closeStake,
    currencyOpen,
    changelogOpen,
    confirmUnstakeOpen,
    sendOpen,
    closeSend,
    cashlinkOpen,
    closeCashlink,
    cashlinkRemoveTarget,
    cashlinkRevertTarget,
    receiveOpen,
    unstakeModalShown,
    closeUnstakeModal,
    downloadLink,
    backupMode,
  ])

  // Clean up the confetti timers on unmount so a pending burst teardown
  // (stake or send) can't fire into a dead tree.
  useEffect(() => {
    return () => {
      if (stakeCelebrateTimer.current) window.clearTimeout(stakeCelebrateTimer.current)
      if (sendCelebrateTimer.current) window.clearTimeout(sendCelebrateTimer.current)
    }
  }, [])

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
  // The panel finishes in the same two beats as the send sheet: a confirming
  // step while the tx settles on chain, then a card that waits for Done. Both
  // replace the form — mixing a live slider into "confirming on chain" is what
  // made the old inline hint easy to miss. 'expired' drops back to the form,
  // where the error explains why, and 'unknown' reaches the card subdued: the
  // tx may well have landed, so it can be shown but not claimed.
  const stakeFlow: 'form' | 'confirming' | 'done' = !stakeSubmitted
    ? 'form'
    : stakeVerify === 'checking'
      ? 'confirming'
      : stakeVerify === 'confirmed' || stakeVerify === 'unknown'
        ? 'done'
        : 'form'
  // The panel only shows the beats of an unstake started in it; the banner's
  // legs have their own window and must not take over the panel behind it.
  const panelUnstakeFlow = unstakeSubmitted?.source === 'panel' ? unstakeFlow : 'form'
  const stakeAmountNim = Number(stakeAmount)
  // A first stake creates the staker record, and the protocol refuses to create
  // one below the 100 NIM minimum — the tx is rejected and never mines. Adding
  // to an existing record has no minimum.
  const stakeAmountValid =
    Number.isFinite(stakeAmountNim) &&
    stakeAmountNim > 0 &&
    (hasStaker || stakeAmountNim >= MIN_STAKE_NIM)
  // Slider ceiling: the basic account balance PLUS HTLC in-transit funds.
  // Nimiq Pay's wallet decides how to fund a stake request — it may redeem
  // a swap contract (its own key, timelock-only contracts). Verified
  // end-to-end 2026-09-10: staked 100 NIM while the relay's basic balance
  // was 0 — the contract dropped exactly 100 NIM and the staker went
  // active. In-transit funds are stakable; the ceiling lets the user
  // attempt it and Pay's wallet does the redemption.
  const stakeMaxLuna = Math.max(0, (Number(nimBalance) || 0) + htlcLuna)
  const stakeMaxNim = stakeMaxLuna / 100000

  // Earn card (top of Overview): earning now, and what idle NIM could add. A
  // staker sees their own pool's yield; anyone else the median pool's, so the
  // card never steers a newcomer to one validator.
  const activeStakeNim = (Number(stakingHolding?.active) || 0) / 100000
  const earning = activeStakeNim > 0
  const earnRate = (earning ? currentValidator?.annualReward : null) ?? typicalRate(validators)
  const earnCompound = earning && currentValidator ? compoundsFor(currentValidator) : true

  // Staking terms (Council Cycle 3): the four things every Earn position says,
  // for the pool this account is actually with. The same copy feeds the stake
  // panel further down, for the pool that stake would go to.
  const scheduleLabel = payoutScheduleLabel(currentValidator?.payoutSchedule)
  const terms = stakeTerms({
    validator: earning ? currentValidator : null,
    hasStaker: earning,
    scheduleLabel,
  })
  const restakeGain =
    earning && currentValidator?.payoutType === 'direct'
      ? restakeGainNim({ stakedNim: activeStakeNim, rate: earnRate ?? null })
      : null
  // Mini apps get no push notifications, so the reminder is a calendar event.
  // Built once: the next day at 09:00 local time does not change per render.
  const reminder = useMemo(
    () => restakeReminder({ nowMs: Date.now(), appUrl: 'https://nimbooks.subimpact.net/' }),
    []
  )
  const panelValidator = selectedValidator
    ? (validators.find((v) => cleanAddr(v.address) === selectedValidator) ?? null)
    : currentValidator
  const panelTerms = stakeTerms({
    validator: panelValidator,
    // The panel describes a picked pool, whether or not this account already
    // stakes: use its name in "how it works" as soon as one is known.
    hasStaker: hasStaker || !!selectedValidator,
    scheduleLabel: payoutScheduleLabel(panelValidator?.payoutSchedule),
  })

  const openStake = () => {
    // A verification still in flight keeps its card — reopening mid-check
    // resumes the confirming step rather than resetting to a form. Anything
    // finished (or never started) opens clean, and a reopen never inherits a
    // celebration from the previous stake.
    if (stakeVerify !== 'checking') {
      setStakeError(null)
      setStakeVerify(null)
      setStakeSubmitted(null)
      clearStakeCelebration()
    }
    // Same for an unstake that finished in this panel: its card is spent, and
    // the panel opens on a form. One still checking keeps its card.
    if (unstakeSubmitted?.source === 'panel' && unstakeVerify !== 'checking') {
      resetUnstakeFlow()
    }
    // A first stake can't be smaller than the minimum, and the slider floor is
    // set there — so open on that value rather than on a 0 the panel would
    // only reject (and which would leave a tap on the floor doing nothing).
    // A link passes its own staker lookup here: the connect refresh's record
    // may still be behind the history walk.
    const staker = stakeLinkOpenHasStakerRef.current ?? !!stakingHolding
    stakeLinkOpenHasStakerRef.current = null
    if (!staker && stakeMaxNim >= MIN_STAKE_NIM && !(stakeAmountNim >= MIN_STAKE_NIM)) {
      setStakeAmount(String(MIN_STAKE_NIM))
    }
    setStakeOpen(true)
  }

  // Open a waiting stake link as soon as the wallet is connected, its balance
  // is known and the link's own staker record has answered. The connect refresh
  // also reads that record, but only after the whole history walk; this lookup
  // is one RPC and lands in ~300 ms. The validator list is deliberately not
  // awaited: a cold list is a ~1.4 MB download, so the panel opens first and a
  // named validator is applied when the list arrives (see the next effect).
  useEffect(() => {
    const intent = stakeLinkIntent
    if (!intent || !account?.nimiqAddress || stakeLinkConsumedRef.current) return
    const addr = account.nimiqAddress

    // One lookup per intent/account. A changed account starts a new one; the
    // address check inside both callbacks ignores an answer for the old one.
    if (stakeLinkLookupRef.current !== addr) {
      stakeLinkLookupRef.current = addr
      setStakeLinkLookup({ address: addr, status: 'pending', holding: null })
      void fetchStakingHolding(addr).then(
        (holding) =>
          setStakeLinkLookup((prev) =>
            prev && prev.address === addr ? { address: addr, status: 'ok', holding } : prev
          ),
        (e) => {
          console.warn('Stake link staker lookup failed:', e)
          setStakeLinkLookup((prev) =>
            prev && prev.address === addr
              ? { address: addr, status: 'failed', holding: null }
              : prev
          )
        }
      )
      return
    }

    const lookup = stakeLinkLookup
    if (!lookup || lookup.address !== addr || lookup.status === 'pending') return
    // A capped amount needs the real free balance, so wait for the balance
    // read rather than treating the first 0 as the wallet's balance.
    if (nimBalance === null) return

    stakeLinkConsumedRef.current = true
    clearStoredStakeIntent()
    setStakeLinkIntent(null)
    setStakeLinkPendingValidator(null)
    const linkHolding = lookup.status === 'ok' ? lookup.holding : null
    stakeLinkHoldingRef.current = linkHolding
    stakeLinkOpenHasStakerRef.current = lookup.status === 'failed' || !!linkHolding
    setStakeLinkStakerUnknown(lookup.status === 'failed')
    openStake()

    const warnings = [...intent.warnings]
    // No link validator means no selection at all. A stale selection from an
    // earlier panel in this session must not leak into the link.
    if (!linkHolding) setSelectedValidator(null)

    let appliedLuna = intent.amountLuna
    if (appliedLuna !== null) {
      const freeLuna = Math.max(0, Math.floor(stakeMaxLuna))
      if (appliedLuna > freeLuna) {
        appliedLuna = freeLuna
        warnings.push(
          `Only ${formatLuna(String(freeLuna), lang)} NIM is free to stake, so the amount was capped.`
        )
      }
      // Only a lookup that answered can say this is a first stake. A failed
      // lookup keeps the link's amount instead of guessing the minimum.
      if (lookup.status === 'ok' && !linkHolding && appliedLuna < MIN_STAKE_LUNA) {
        if (freeLuna >= MIN_STAKE_LUNA) {
          appliedLuna = MIN_STAKE_LUNA
          warnings.push(
            `A first stake starts at ${MIN_STAKE_NIM} NIM, so the amount was set to the minimum.`
          )
        } else {
          warnings.push(
            `A first stake needs at least ${MIN_STAKE_NIM} NIM, and only ${formatLuna(String(freeLuna), lang)} NIM is free to stake.`
          )
        }
      }
      if (appliedLuna > 0) setStakeAmount(formatLunaExact(String(appliedLuna)))
    }

    const amountLabel =
      intent.amountLuna !== null ? `${formatLuna(String(intent.amountLuna), lang)} NIM` : null
    stakeLinkNoticeBaseRef.current = { amountLabel, warnings: [...warnings] }

    const linkedValidator = intent.validator
      ? (validators.find((v) => cleanAddr(v.address) === intent.validator) ?? null)
      : null

    if (!intent.validator) {
      setStakeLinkNotice(stakeLinkNoticeText(amountLabel, null, warnings))
      return
    }

    if (lookup.status === 'failed') {
      warnings.push('Your stake could not be checked right now, so no validator was selected.')
      setStakeLinkNotice(
        stakeLinkNoticeText(amountLabel, shortStakeAddress(intent.validator), warnings)
      )
      return
    }

    if (!linkedValidator && validators.length === 0 && !validatorsError) {
      // The list is still on its way. The short address keeps the notice
      // honest now; the pending effect rewrites it with the name when the list
      // lands (or explains that it did not).
      setStakeLinkPendingValidator(intent.validator)
      setStakeLinkNotice(
        stakeLinkNoticeText(amountLabel, shortStakeAddress(intent.validator), warnings)
      )
      return
    }

    if (!linkedValidator && validatorsError && validators.length === 0) {
      warnings.push('The validator list did not load, so the validator was not selected.')
      setStakeLinkNotice(
        stakeLinkNoticeText(amountLabel, shortStakeAddress(intent.validator), warnings)
      )
      return
    }

    const outcome = linkValidatorOutcome(intent.validator, linkHolding, validators, warnings)
    if (outcome.selected) setSelectedValidator(outcome.selected)
    setStakeLinkNotice(stakeLinkNoticeText(amountLabel, outcome.label, outcome.warnings))
    // openStake is stable for this one shot; reading it off the render keeps
    // the effect from reopening when unrelated state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stakeLinkIntent,
    account?.nimiqAddress,
    stakeLinkLookup,
    nimBalance,
    validators,
    validatorsError,
    stakeMaxLuna,
    lang,
  ])

  // A link panel that opened before the validator list. The panel and its
  // notice are already up; this applies the same selection rules once the list
  // lands, and rewrites the notice to name the validator. A failure keeps the
  // short address and says why nothing was selected. closeStake clears the
  // pending address, so a late list cannot move a selection behind a closed
  // panel.
  useEffect(() => {
    const pending = stakeLinkPendingValidator
    if (!pending || !stakeOpen) return
    if (validators.length === 0 && !validatorsError) return
    setStakeLinkPendingValidator(null)
    const base = stakeLinkNoticeBaseRef.current
    if (!base) return

    if (validatorsError && validators.length === 0) {
      const warnings = [
        ...base.warnings,
        'The validator list did not load, so the validator was not selected.',
      ]
      setStakeLinkNotice(
        stakeLinkNoticeText(base.amountLabel, shortStakeAddress(pending), warnings)
      )
      return
    }

    const outcome = linkValidatorOutcome(
      pending,
      stakeLinkHoldingRef.current,
      validators,
      base.warnings
    )
    if (outcome.selected) setSelectedValidator(outcome.selected)
    setStakeLinkNotice(stakeLinkNoticeText(base.amountLabel, outcome.label, outcome.warnings))
  }, [stakeLinkPendingValidator, stakeOpen, validators, validatorsError])


  // --- Reasons to come back (lib/earnInsights): all local, nothing sent. ---
  // Actual yield over the trailing month, next to the estimate above: rewards
  // the chain paid, divided by the active stake. Only for a staker - a past
  // staker's idle balance no longer defines a live yield.
  const actualYield = useMemo(() => {
    if (!earning) return null
    return trailingYield(rewardTxs, Math.round(activeStakeNim * 100000), Date.now())
  }, [rewardTxs, activeStakeNim, earning])
  // Per-validator totals, all time, largest first; names resolve against the
  // validator list (the reward rows carry addresses, the list carries names).
  const validatorEarnings = useMemo(() => {
    const raw = rewardsByValidator(rewardTxs)
    return raw.map((e) => {
      const v = validators.find((x) => cleanAddr(x.address) === e.address)
      return {
        address: e.address,
        name: v && v.name ? v.name : `${e.address.slice(0, 12)}…`,
        nim: e.nim,
        firstMs: e.firstMs,
        lastMs: e.lastMs,
      }
    })
  }, [rewardTxs, validators])
  // Rewards since the previous visit, when this one has a stored previous
  // visit and the history has arrived. The card hides the line until the
  // number can be trusted (loaded and non-zero), same rule as it hides the
  // idle line.
  const rewardsSincePreviousVisit = useMemo(() => {
    if (previousVisitMs === null) return null
    return {
      ms: previousVisitMs,
      ...rewardsSince(rewardTxs, previousVisitMs),
      loaded: rewardTxs.length > 0,
      complete: rewardsComplete,
    }
  }, [previousVisitMs, rewardTxs, rewardsComplete])
  // "Stake it?": the newest received payment of the last 7 days that left NIM
  // idle, or null. Suppressed during the tour so the walkthrough never moves
  // under the spotlight.
  const stakeNudgeTx = useMemo(() => {
    if (!account?.nimiqAddress || tourActive) return null
    return pickStakeNudge({
      incomingTxs: incomingPayments,
      idleNim: stakeMaxNim,
      hasStaker: earning,
      minStakeNim: MIN_STAKE_NIM,
      dismissedHashes: nudgeDismissed,
      nowMs: Date.now(),
    })
  }, [account?.nimiqAddress, tourActive, incomingPayments, stakeMaxNim, earning, nudgeDismissed])

  // "Not now": remember the payment's hash so it is never offered again
  // (per address, capped at 50, per tab in demo mode).
  const dismissStakeNudge = () => {
    if (!stakeNudgeTx || !account?.nimiqAddress) return
    const list = [...new Set([...nudgeDismissed, stakeNudgeTx.hash])].slice(-50)
    setNudgeDismissed(list)
    try {
      demoStore().setItem(`nimbooks:stake-nudge-dismissed:${account.nimiqAddress.replace(/\s+/g, '')}`, JSON.stringify(list))
    } catch {
      /* storage full - the dismissal holds for this session only */
    }
  }

  // Accepting the nudge opens the same stake panel as the Earn card's button,
  // but pre-fills the received amount rather than every idle NIM.
  const acceptStakeNudge = () => {
    if (!stakeNudgeTx) return
    openStake()
    const amount = Math.floor(Math.min(stakeNudgeTx.nim, stakeMaxNim))
    if (amount > 0) setStakeAmount(String(amount))
  }

  // A learn-page entry lands on the screen it named: its panel opens, and the
  // anchor it names scrolls into view. Runs once, when the sample account arrives.
  useEffect(() => {
    const entry = learnEntryRef.current
    if (!entry || !account) return
    learnEntryRef.current = null
    if (entry.open === 'stake') openStake()
    if (entry.target) scrollToLearnTarget(entry.target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  // Watch a submitted stake tx until it shows up on chain. Fire-and-forget:
  // the panel stays usable while it runs, and a tx that never lands turns into
  // an error instead of a hash the user keeps waiting on.
  const verifyStakeTx = (hash: string, amountNim?: number) => {
    const addr = account?.nimiqAddress
    if (addr && amountNim) {
      // The public index doesn't return staking txs for the sender, so the
      // stake is recorded here at submit time — same pattern as the unstake
      // legs — and History renders it from the local log.
      const entry: StakingAction = { kind: 'stake', amountNim, hash, at: Date.now(), confirmed: false }
      appendStakingAction(addr, entry)
      setStakingLog((prev) => [entry, ...prev.filter((a) => a.hash !== hash)])
    }
    stakeVerifyRef.current = hash
    setStakeVerify('checking')
    void (async () => {
      const result = await waitForTxMined(hash, {
        intervalMs: TX_VERIFY_INTERVAL_MS,
        timeoutMs: TX_VERIFY_TIMEOUT_MS,
      })
      // The log row is keyed by hash, so it resolves even when a newer submit
      // has taken over the panel's verification state.
      if (addr && amountNim) {
        if (result === 'confirmed') {
          markStakingActionConfirmed(addr, hash)
          setStakingLog((prev) =>
            prev.map((a) => (a.hash === hash ? { ...a, confirmed: true } : a))
          )
        } else if (result === 'expired') {
          // A stake that never reached the chain takes its row with it — the
          // same rule the unstake legs follow, and the invariant lib/stakingLog
          // states: the row must not linger claiming an action that never
          // happened. 'unknown' leaves it as submitted-not-confirmed.
          removeStakingAction(addr, hash)
          setStakingLog((prev) => prev.filter((a) => a.hash !== hash))
        }
      }
      if (stakeVerifyRef.current !== hash) return // superseded by a newer submit
      setStakeVerify(result)
      if (result === 'confirmed') {
        // An open panel celebrates on the spot: the confirmed card is the
        // signal, with a confetti burst over it, and it waits for Done. A panel
        // the user closed mid-check gets the toast instead, so a confirmation
        // is never silent — and never announced twice.
        if (stakeOpenRef.current) {
          setStakeCelebrate(hash)
          if (stakeCelebrateTimer.current) window.clearTimeout(stakeCelebrateTimer.current)
          stakeCelebrateTimer.current = window.setTimeout(() => {
            stakeCelebrateTimer.current = null
            setStakeCelebrate(null)
          }, CONFETTI_MS)
        } else {
          setToast('Stake confirmed on-chain! 🎉')
        }
        // The submit-time refresh ran before the tx mined; now that it's on
        // chain, drop the cache and pull fresh balances/staker/history so the
        // home screen is already right behind the card.
        clearTxCache()
        if (account) void refresh(account)
        return
      }
      if (result !== 'expired') return
      // 'unknown' is not a failure — the RPC never answered, so say only that.
      setStakeError(
        'Stake transaction was not mined: it never reached the chain. Please try again.'
      )
      setToast('Stake transaction was not mined ✗')
    })()
  }

  const submitStake = async () => {
    if (staking) return // double-tap / Enter guard — one signing request at a time
    // A second submit starts its own two-beat: the previous confirmation's
    // burst must never carry over into it.
    clearStakeCelebration()
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
    // The ceiling can shrink between opening the panel and submitting (a swap
    // settles, a payment goes out, the 10s refresh lands). Never sign more
    // than the wallet can fund — the unstake path does the same check.
    if (stakeAmountNim > stakeMaxNim) {
      setStakeError(
        `Only ${formatLuna(String(stakeMaxLuna), lang)} NIM is available to stake right now.`
      )
      return
    }
    if (firstStake && !selectedValidator) {
      setStakeError('Choose a validator first.')
      return
    }
    setStaking(true)
    setStakeError(null)
    setStakeVerify(null)
    setStakeSubmitted(null)
    try {
      const result = await stakeNim(firstStake ? selectedValidator : null, stakeAmountNim)
      if (!result.ok) {
        setStakeError(result.error)
        return
      }
      // Resolved here, not at render time: a first stake's validator is only
      // knowable from the picker (there is no staker record yet), and an added
      // stake's name comes from the delegation the record already carries.
      const validatorName = firstStake
        ? (validators.find((v) => cleanAddr(v.address) === selectedValidator)?.name ??
          `${(selectedValidator ?? '').slice(0, 12)}…`)
        : (currentValidator?.name ??
          (lockedDelegation ? `${lockedDelegation.slice(0, 12)}…` : 'your validator'))
      setStakeSubmitted({ hash: result.hash, amountNim: stakeAmountNim, validator: validatorName })
      verifyStakeTx(result.hash, stakeAmountNim)
      // Reset to a value the slider can actually hold: for a first stake the
      // floor is MIN_STAKE_NIM, so a bare '' would leave the thumb clamped at
      // 100 while the label reads 0 — a UI lockup if the user taps to keep
      // the panel open.
      setStakeAmount(hasStaker ? '' : String(MIN_STAKE_NIM))
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

  // What the currently typed/slid unstake amount would actually do, from the
  // same helper the submit handler uses - this only draws the inline preview;
  // nothing is decided here twice.
  const unstakePreview = planUnstake({
    requestedLuna: Math.round(Number(unstakeAmount) * 100000),
    retiredLuna,
    retireableLuna,
    inactiveLuna,
    minStakeLuna: MIN_STAKE_LUNA,
  })
  const unstakePreviewActive =
    Number(unstakeAmount) > 0 && Number(unstakeAmount) * 100000 <= maxUnstakeableLuna &&
    (unstakePreview.snapped || unstakePreview.fullOnly)
  // What the active stake would be left at if the request went out untixed -
  // the figure the snapped explainer shows before the fix.
  const unstakeActiveAfter =
    retireableLuna - (unstakePreview.askedDeactivateLuna ?? 0)

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

  // A Hub session signs staking through the Hub popup, and that popup must
  // open from the click that asks for it. So the signing library (wasm) and a
  // fresh block height are warmed up while a staking surface is on screen, and
  // the submit buttons stay disabled until ready; the height keeps refreshing
  // until the last surface closes.
  const [hubStakeReady, setHubStakeReady] = useState(false)
  // A failed warm-up (wasm fetch or block height) used to leave the buttons
  // dark on "Preparing…" until the panel was reopened. Now it retries on a
  // short timer while a staking surface is open, and says it is retrying.
  const [hubPrepFailed, setHubPrepFailed] = useState(false)
  const hubSession = account?.provider === 'hub'
  useEffect(() => {
    if (!hubSession) {
      stopHubStakingPrep()
      setHubStakeReady(false)
      setHubPrepFailed(false)
      return
    }
    const surfaceOpen =
      stakeOpen || unstakeActivity?.kind === 'cooling' || unstakeActivity?.kind === 'ready'
    if (!surfaceOpen) {
      stopHubStakingPrep()
      return
    }
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const attempt = () => {
      void prepareHubStaking().then((ready) => {
        if (cancelled) return
        setHubStakeReady(ready)
        setHubPrepFailed(!ready)
        if (!ready) retry = setTimeout(attempt, HUB_PREP_RETRY_MS)
      })
    }
    attempt()
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
    }
  }, [hubSession, stakeOpen, unstakeActivity])

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
    action?: { kind: UnstakeLegKind; amountNim: number },
    // Which window this leg reports into. Passed in rather than read off state:
    // the poll outlives the render it was started in, and an expired leg has to
    // know whether there is still a form on screen to show its error.
    source: 'panel' | 'banner' = 'panel'
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
      if (result === 'confirmed') {
        // The window on screen is the announcement: it flips to the completed
        // card and waits for Done. A window the user closed mid-check gets the
        // toast instead, so a confirmation is never silent and never doubled.
        if (!unstakeWindowOpenRef.current && action) setToast(UNSTAKE_LEG[action.kind].toast)
        // The submit-time refresh ran before the tx mined. Now that it is on
        // chain, pull fresh balances and staker record so Overview is already
        // right behind the card.
        clearTxCache()
        if (account) void refresh(account)
        // The tx is on chain, but the skip-leg-1 marker may only clear once the
        // chain proves the retired balance is gone. getStakingHolding refreshes
        // the staker record asynchronously after refresh(account) kicks off, so
        // re-read it here: only when retired flips to '0' is it safe to drop the
        // marker. If the record is missing or still shows retired balance, leave
        // the marker so the retry path keeps reusing the same hash and the
        // refresh flips the record shortly.
        if (addr) {
          void getStakingHolding(addr).then((holding) => {
            if (holding && holding.retired === '0' && withdrawSubmittedRef.current?.hash === hash) {
              withdrawSubmittedRef.current = null
            }
          })
        }
        return
      }
      if (result !== 'expired') return
      // Never arrived on chain — the tx never reached a block, so a retry must be
      // allowed to sign it again. Clear the marker only when it still belongs to
      // this hash; a newer deactivation's marker survives.
      if (withdrawSubmittedRef.current?.hash === hash) {
        withdrawSubmittedRef.current = null
      }
      // Only the deactivation that owns the marker may clear it. A withdraw or
      // a retire is a different step of a different leg, and wiping the marker
      // for one of those would drop a live deactivation's banner for the ~12h
      // until the staker record flips. Both the state and the persisted copy
      // are matched on the hash, so a newer deactivation's marker survives too.
      if (action?.kind === 'deactivate') {
        setPendingUnstake((prev) => (prev?.hash === hash ? null : prev))
        try {
          if (pendingUnstakeKey) {
            const stored = localStorage.getItem(pendingUnstakeKey)
            if (stored && (JSON.parse(stored) as { hash?: string }).hash === hash) {
              localStorage.removeItem(pendingUnstakeKey)
            }
          }
        } catch {
          /* ignore */
        }
      }
      // A banner leg has no form to fall back to: its window unmounts with the
      // flow, so the toast below is the whole message. Left in state, the error
      // would strand and resurface later under the *panel's* unstake form,
      // where it belongs to nothing. A panel leg keeps its error — the form it
      // failed in is still on screen to explain it.
      if (source === 'banner') {
        setUnstakeSubmitted(null)
        setUnstakeError(null)
        setUnstakeModalOpen(false)
      } else {
        setUnstakeError(
          'Unstake transaction was not mined: it never reached the chain. Please try again.'
        )
      }
      setToast('Unstake transaction was not mined ✗')
    })()
  }

  const submitUnstake = async () => {
    if (unstakingRef.current) return
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
    // Work the request out once, before anything is signed, with the same
    // helper the panel's inline explainer uses - the two can then never
    // disagree about what will actually be deactivated.
    const plan = planUnstake({
      requestedLuna: Math.round(amountNim * 100000),
      retiredLuna,
      retireableLuna,
      inactiveLuna,
      minStakeLuna: MIN_STAKE_LUNA,
    })
    if (plan.fullOnly) {
      // The whole active balance is at or under the minimum - nothing
      // partial is legal here, only unstaking all of it.
      setUnstakeError(
        `${MIN_REMAINDER_COPY}. Unstake the full ${formatLuna(String(retireableLuna), lang)} NIM instead.`
      )
      return
    }
    unstakingRef.current = true
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeSubmitted(null)
    setUnstakeVerify(null)
    setUnstakeModalOpen(false) // this one finishes in the panel, not the modal
    try {
      let remainingNim = amountNim
      // What actually went out, built as it goes: a submit can send a withdraw
      // and a deactivate, and the completed card summarises both. Kept as a
      // local so each leg can hand the card a fresh array.
      const legs: { kind: UnstakeLegKind; amountNim: number; hash: string }[] = []
      const notes: string[] = []
      // 1. Withdraw anything already fully cooled (retired → basic balance).
      //    `remove_stake` takes no amount: the protocol withdraws the whole
      //    retired balance or nothing (protocol.md — "Remove ALL retired
      //    funds; partial not allowed"). Asking for less than all of it used
      //    to send a tx for the smaller figure and get the full balance back.
      if (retiredLuna > 0 && remainingNim > 0) {
        const removeNim = retiredLuna / 100000
        // Already out from an earlier tap of this same submit? Then carry that
        // leg forward instead of signing it again: the deactivation below needs
        // a click of its own when the popup blocker eats it, and that click
        // re-enters here with the staker record untouched (see the ref).
        const prior = withdrawSubmittedRef.current
        const reused = prior && prior.retiredLuna === retiredLuna ? prior : null
        let removeHash = reused?.hash ?? null
        if (!removeHash) {
          const remove = await unstakeRemove(removeNim)
          if (!remove.ok) {
            setUnstakeError(remove.error)
            return
          }
          removeHash = remove.hash
          withdrawSubmittedRef.current = { hash: remove.hash, retiredLuna, amountNim: removeNim }
        }
        if (removeNim > remainingNim) notes.push(FULL_WITHDRAW_NOTE)
        legs.push({ kind: 'withdraw', amountNim: removeNim, hash: removeHash })
        setUnstakeSubmitted({ legs: [...legs], source: 'panel', notes: [...notes] })
        // A reused leg is already being watched by the poll the first tap
        // started — verifying it twice would duplicate its staking-log row.
        if (!reused) verifyUnstakeTx(removeHash, { kind: 'withdraw', amountNim: removeNim })
        // Clamped: withdrawing the whole retired balance can cover more than
        // was asked for, and the steps below only run on what's still owed.
        remainingNim = Math.max(0, remainingNim - removeNim)
      }
      // 2. Deactivate the rest of the ACTIVE stake (active → inactive). The
      //    protocol only retires *inactive* stake, so this - not retire - is
      //    the first step for live stake. `setActiveStake` sets an absolute
      //    balance, so pass what stays staked, not what leaves. The numbers
      //    come from the same plan the panel's inline explainer shows.
      if (plan.deactivateLuna > 0) {
        const deactivateLuna = plan.deactivateLuna
        if (plan.snapped) {
          // Leaving under the 100 NIM minimum is rejected outright, so the
          // plan enlarged the deactivation to keep exactly the minimum
          // staked; the summary card says so.
          notes.push(
            `${MIN_REMAINDER_COPY}. Deactivating ${formatLuna(String(deactivateLuna), lang)} NIM instead.`
          )
        }
        const deactivateNim = deactivateLuna / 100000
        const deactivate = await unstakeDeactivate((retireableLuna - deactivateLuna) / 100000)
        if (!deactivate.ok) {
          setUnstakeError(deactivate.error)
          return
        }
        legs.push({ kind: 'deactivate', amountNim: deactivateNim, hash: deactivate.hash })
        setUnstakeSubmitted({ legs: [...legs], source: 'panel', notes: [...notes] })
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
        // When the plan snapped the amount to the minimum, the shortfall is
        // staying staked on purpose - it is not "still cooling down" (step 3),
        // so it must not be reported as such.
        remainingNim = plan.snapped ? 0 : Math.max(0, remainingNim - deactivateNim)
      }
      // 3. Anything left is already cooling down (inactive). It still needs a
      //    retire transaction once the reporting window passes — that is the
      //    banner's finish action, not something this submit can send yet.
      if (remainingNim > 0) {
        setUnstakeError(
          `${formatLuna(String(remainingNim * 100000), lang)} NIM is already cooling down. Finish it from the balance banner once the reporting window passes.`
        )
      }
      if (remainingNim < amountNim) {
        setUnstakeAmount('')
        clearTxCache()
        if (account) await refresh(account)
      }
    } finally {
      unstakingRef.current = false
      setUnstaking(false)
    }
  }

  // Step 2 of the unstake flow: inactive → retired, for the whole cooled-down
  // balance. Only valid once the deactivation took effect and the reporting
  // window passed — before that the provider rejects it and says so.
  const completeUnstake = async () => {
    if (unstakingRef.current) return
    if (inactiveLuna <= 0) return
    // Belt and braces: the banner already hides the button until the retire is
    // valid, but a click racing a refresh must not send a tx the chain will
    // reject (it would never mine, leaving the state untouched).
    const inactiveFrom = stakingHolding?.inactiveFrom || 0
    const retireValidAt = inactiveFrom > 0 ? inactiveFrom + BLOCKS_PER_EPOCH : 0
    if (retireValidAt > 0 && currentBlock < retireValidAt) return
    unstakingRef.current = true
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeSubmitted(null)
    setUnstakeVerify(null)
    try {
      const retireNim = inactiveLuna / 100000
      const retire = await unstakeRetire(retireNim)
      if (!retire.ok) {
        setUnstakeError(retire.error)
        setToast(retire.error)
        return
      }
      // No panel here, so the two beats open a window of their own. The news
      // is the card, not a toast: it waits for Done like every other finish.
      setUnstakeSubmitted({
        legs: [{ kind: 'retire', amountNim: retireNim, hash: retire.hash }],
        source: 'banner',
        notes: [],
      })
      setUnstakeModalOpen(true)
      verifyUnstakeTx(retire.hash, { kind: 'retire', amountNim: retireNim }, 'banner')
      clearTxCache()
      if (account) await refresh(account)
    } finally {
      unstakingRef.current = false
      setUnstaking(false)
    }
  }

  // Step 3: retired → basic balance, for the whole withdrawable balance.
  const withdrawRetired = async () => {
    if (unstakingRef.current) return
    if (retiredLuna <= 0) return
    unstakingRef.current = true
    setUnstaking(true)
    setUnstakeError(null)
    setUnstakeSubmitted(null)
    setUnstakeVerify(null)
    try {
      const removeNim = retiredLuna / 100000
      const remove = await unstakeRemove(removeNim)
      if (!remove.ok) {
        setUnstakeError(remove.error)
        setToast(remove.error)
        return
      }
      // The same marker the panel's chained path sets: this withdraw is out,
      // and until it mines the staker record still reports the balance it
      // moves — so the panel must carry this leg rather than sign its own.
      withdrawSubmittedRef.current = { hash: remove.hash, retiredLuna, amountNim: removeNim }
      setUnstakeSubmitted({
        legs: [{ kind: 'withdraw', amountNim: removeNim, hash: remove.hash }],
        source: 'banner',
        notes: [],
      })
      setUnstakeModalOpen(true)
      verifyUnstakeTx(remove.hash, { kind: 'withdraw', amountNim: removeNim }, 'banner')
      clearTxCache()
      if (account) await refresh(account)
    } finally {
      unstakingRef.current = false
      setUnstaking(false)
    }
  }

  // The banner's buttons double as the way back into the flow they started:
  // while a leg of theirs is confirming or waiting for Done, tapping again
  // reopens its window instead of signing the same transaction twice. Leg-aware
  // on purpose — once the chain has moved on, the *next* step's button on the
  // same banner must still submit.
  const reopenBannerUnstake = (kind: UnstakeLegKind): boolean => {
    if (unstakeFlow === 'form' || unstakeSubmitted?.source !== 'banner') return false
    if (unstakeSubmitted.legs[unstakeSubmitted.legs.length - 1]?.kind !== kind) return false
    setUnstakeModalOpen(true)
    return true
  }

  const [countdown, setCountdown] = useState(10)
  // Bumped after every completed heartbeat. The portfolio's extra addresses re-read
  // off it every sixth tick, so nothing else needs a timer of its own.
  const [refreshTick, setRefreshTick] = useState(0)
  const loadingRef = useRef(false)
  // The heartbeat never overlaps itself: a tick that lands while the last one is
  // still in flight is skipped, the same as one that lands during a manual refresh.
  const heartbeatBusyRef = useRef(false)
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])
  // Heartbeat: count down from 10s and refresh the books when it hits 0. Only for
  // a real connected wallet (demo mode stays manual to avoid pointless RPC load).
  // The countdown pauses while the page is hidden, since Nimiq Pay can keep the
  // WebView open for hours, and catches up with one refresh when it is back.
  useEffect(() => {
    if (!account?.nimiqAddress || isDemoMode()) return
    // The onboarding tour runs on a static snapshot — no live refreshes
    // mid-walkthrough, or the layout (and the spotlight) could move under it.
    if (tour.phase === 'active') return
    let remaining = 10
    let lastBeatAt = Date.now()
    const beat = () => {
      if (heartbeatBusyRef.current || loadingRef.current) return
      heartbeatBusyRef.current = true
      lastBeatAt = Date.now()
      void refresh(account, { clearError: false, heartbeat: true }).finally(() => {
        heartbeatBusyRef.current = false
        setRefreshTick((n) => n + 1)
      })
    }
    setCountdown(10)
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      remaining -= 1
      if (remaining <= 0) {
        remaining = 10
        beat()
      }
      setCountdown(remaining)
    }, 1000)
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      // More than a full cycle away: refresh now rather than wait out the countdown.
      if (Date.now() - lastBeatAt > 10_000) {
        remaining = 10
        setCountdown(10)
        beat()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.nimiqAddress, tour.phase])

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
          timestamp: Math.floor(timestampToMs(tx.timestamp ?? Date.now()) / 1000), // seconds in the signed payload
          memo: tx.data,
        },
        account.nimiqAddress // sign with the connected address — no address-selector step
      )
      if (!receipt) {
        setError('Signing cancelled. No signature returned.')
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
      noteUnbacked()
      setToast('Receipt signed ✓')
    } catch (e) {
      console.error('signReceipt failed:', e)
      setError('Signing failed: ' + (errorText(e) || 'The signature request failed.'))
    } finally {
      setSigningHash(null)
    }
  }

  const shareReceipt = async (r: SignedReceipt) => {
    const enc = encodeReceipt(r)
    // Short link for the share sheet; falls back to the long one on any
    // shortener failure. The QR path is deliberately untouched here.
    const url = await shortenUrl(siteLink(`#/verify/${enc}`))
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
      setError('Could not copy link. Long-press the URL in the address bar.')
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
          const kind = txLabel(t, own)
          const memo = decodeMemo(t.data) ?? ''
          return [
            new Date(timestampToMs(t.timestamp ?? Date.now())).toISOString(),
            t.hash,
            isOut ? 'sent' : 'received',
            kind,
            t.sender,
            t.recipient,
            (Number(t.value) / 100000).toFixed(5), // raw decimals — no locale separators (accounting-safe)
            (Number(t.fee) / 100000).toFixed(5),
            // No rate yet (cold cache, CoinGecko still in flight) means the
            // USD value is unknown, and an unknown value is blank — a column
            // of 0.000000 reads as "these transactions were worthless".
            rates.nim > 0 ? ((Number(t.value) / 100000) * rates.nim).toFixed(6) : '',
            // A staking transaction's data field is a signalling payload, not
            // a note: the kind column already says what it is, and the raw hex
            // has no place in an accountant's memo column. A cashlink's tag is
            // the same thing, and reads as the word it stands for.
            kind === 'stake' || kind === 'unstake'
              ? ''
              : isCashlinkMemo(memo)
                ? 'Cashlink'
                : memo,
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

  // Tax-card fiat: two decimals normally, but a small-cap coin's daily
  // figures are often cents - render those with four so 0.0045 does not
  // display as 0.00, and a negative epsilon never reads as -0.00. Amounts are
  // in the reporting currency the tax report was computed for.
  const formatTaxFiat = (n: number): string => {
    const sym = currencySymbol(currency)
    if (!Number.isFinite(n) || Math.abs(n) < 0.005) return `${sym}0.00`
    return `${sym}${n.toFixed(Math.abs(n) < 1 ? 4 : 2)}`
  }

  // One source of truth for what each export is called and what it holds, so
  // the download, copy, and link paths can never drift apart.
  const csvExport = (
    kind: 'history' | 'statement' | 'tax' | 'tax-summary'
  ): { filename: string; csv: string } | null => {
    if (!account?.nimiqAddress) return null
    const tag = account.nimiqAddress.replace(/\s+/g, '').slice(0, 8)
    if (kind === 'history') {
      return { filename: `nimbooks-${tag}.csv`, csv: buildCsv() }
    }
    if (kind === 'tax') {
      if (!taxReport) return null
      return {
        // Filenames follow the currency the report was actually computed
        // in (the display currency when it is tax-capable, USD otherwise).
        filename: `nimbooks-tax-${taxFormat}-${taxCurrency}-${tag}.csv`,
        csv: buildTaxTransactionsCsv(
          taxFormat, taxReport.rows, taxReport.incomeRows, account.nimiqAddress, taxCurrency.toUpperCase()
        ),
      }
    }
    if (kind === 'tax-summary') {
      if (!taxReport) return null
      return {
        filename: `nimbooks-tax-summary-${taxCurrency}-${tag}.csv`,
        csv: buildTaxSummaryCsv(taxReport, account.nimiqAddress, taxCurrency.toUpperCase()),
      }
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
      setError('Could not copy CSV. Use Download instead.')
    }
  }

  // Nimiq Pay's WebView cannot save files at all, so hand the user a real
  // HTTPS link (plus a QR for a second device) they can open in a browser
  // that does honour Content-Disposition.
  const getDownloadLink = async (kind: 'history' | 'statement' | 'tax' | 'tax-summary') => {
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
          setToast('CSV too large for a link. Copied to clipboard instead ✓')
        } catch {
          setError('CSV too large for a link. Use Copy CSV instead.')
        }
        return
      }
      // Shortened on our own edge, never short.io: the whole export rides
      // inside this URL, so the link *is* the user's ledger, and a third-party
      // shortener would be handed the ledger with it. /api/export-link keeps
      // the payload in our KV for 48h and gives back a URL short enough to
      // scan. Any failure there (no binding yet, offline, slow) falls back to
      // the long URL, which the modal still offers to copy and open, dropping
      // the QR when it outgrows a camera.
      const short = await buildShortExportLink(e.csv, e.filename)
      setDownloadShortLink(short.ok)
      setDownloadLink(short.ok ? short.url : link)
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
    // The relay history goes with the rest of the ledger: connect() sets the
    // new account before its refresh resolves, so a leftover list would render
    // the previous wallet's rows in History (and export them) mid-fetch.
    setRemoteTxs([])
    // The contract archive state is session data like the relay history: it
    // belongs to the old wallet's contracts and must not bleed into the next.
    setArchiveTxs([])
    setLiveContracts([])
    liveContractsRef.current = []
    archiveFinalsRef.current = new Set()
    archivePendingRef.current = false
    archiveNextAtRef.current = 0
    archiveBackoffRef.current = ARCHIVE_BACKOFF_MIN_MS
    setRewardTxs([])
    setRewardsComplete(true)
    setHtlcHoldings([])
    setHtlcInTransit(0)
    setRemoteAccountLuna(null)
    setStakingHolding(null)
    setVestingHoldings([])
    setEvmBalances([])
    setReceipts([])
    setError(null)
    setToast(null)
    setVisibleTxCount(50)
    setStatement(null)
    setStatementYear('all')
    // The older-history window belongs to the old wallet, session-only.
    setExtendedHistory(null)
    setExtendedProgress(null)
    setExtendedLoading(false)
    setExtendedConfirmOpen(false)
    setDownloadLink(null)
    setInvoices([])
    setAmountInput('')
    setMemoInput('')
    setShownQrId(null)
    setStakeOpen(false)
    setStakeLinkNotice(null)
    clearStoredStakeIntent()
    setStakeLinkIntent(null)
    stakeLinkConsumedRef.current = false
    stakeLinkLookupRef.current = null
    setStakeLinkLookup(null)
    setStakeLinkPendingValidator(null)
    setStakeLinkStakerUnknown(false)
    stakeLinkNoticeBaseRef.current = null
    stakeLinkHoldingRef.current = null
    stakeLinkOpenHasStakerRef.current = null
    setCurrencyOpen(false)
    setSelectedValidator(null)
    setStakeAmount('')
    setStakeError(null)
    // Drop any in-flight verification: its result belongs to the old account.
    setStakeVerify(null)
    stakeVerifyRef.current = null
    setStakeSubmitted(null)
    setUnstakeSubmitted(null)
    setUnstakeModalOpen(false)
    setUnstakeError(null)
    setUnstakeVerify(null)
    unstakeVerifyRef.current = null
    // The display currency is a device preference, not account data — it stays.
  }

  // The statement follows the books: it is rebuilt when the transactions, the live
  // balances or the period change. Figures come from cached prices, so a rebuild
  // costs no RPC.
  const statementYears = useMemo(() => availableStatementYears(allTxs), [allTxs])
  // The address and period the statement on screen was built for. A rebuild for the
  // same pair is silent; a new pair (first build, or a period switch) shows the spinner.
  const statementKeyRef = useRef<string | null>(null)

  // The older-history offer only makes sense while the plain loader actually
  // capped out, and only until the extended window is already in for the
  // session. One wallet per load: the walk keys off the connected address.
  const showExtendedButton =
    !!account?.nimiqAddress && !extendedHistory && !extendedLoading && historyHitCap(allTxs)

  // Runs after the confirmation modal says go. The loader already merged and
  // deduped its result, so this only has to hand the window to allTxs (via
  // extendedHistory) and stand down. A partial return stays quiet for the
  // user — the year picker simply reflects what loaded; one console.warn for
  // support instead.
  const startExtendedHistory = useCallback(() => {
    const own = account?.nimiqAddress
    if (!own || extendedLoading) return
    setExtendedLoading(true)
    setExtendedProgress({ fetched: 0, elapsedSec: 0 })
    const startedAt = Date.now()
    getNimiqExtendedTransactionHistory(own, {
      onProgress: (fetched) =>
        setExtendedProgress({ fetched, elapsedSec: Math.round((Date.now() - startedAt) / 1000) }),
    })
      .then((res) => {
        if (res.partial) {
          console.warn('Extended history load stopped early by the RPC rate limiter')
        }
        setExtendedHistory(res.txs)
      })
      .catch((e) => {
        console.warn('Extended history load failed:', e)
        // extendedHistory stays null, so the button remains for a retry.
      })
      .finally(() => {
        setExtendedLoading(false)
        setExtendedProgress(null)
        setExtendedConfirmOpen(false)
      })
  }, [account?.nimiqAddress, extendedLoading])
  useEffect(() => {
    if (!account?.nimiqAddress || allTxs.length === 0) {
      statementKeyRef.current = null
      setStatement(null)
      setStatementLoading(false)
      return
    }
    const own = account.nimiqAddress // narrowed; stable across the closure
    const key = `${own}|${statementYear}`
    // Same address and period as the statement on screen: rebuild it quietly.
    const silent = statementKeyRef.current === key
    let cancelled = false
    if (!silent) setStatementLoading(true)
    ;(async () => {
      try {
        let prices: Record<string, number> = {}
        try {
          prices = await getDailyNimPrices()
        } catch (e) {
          // The NIM figures need no prices: build them anyway and leave the USD
          // columns out, rather than dropping the whole statement.
          reportSoftFailure(e, 'Statement prices unavailable right now. Try again shortly.')
        }
        if (cancelled) return
        // Nimiq Pay contract funding and refunds are the wallet's own money
        // moving, not payments: split them out the same way Analytics does,
        // from data already in memory (no extra RPC).
        const base = computeStatement(allTxs, own, statementYear, prices, {
          heldContracts: analyticsHeldContracts,
          contractTxs: contractTxsForAnalytics,
        })
        // Replay can only see events, so genesis-seeded pre-PoS funds and
        // auto-compounded stake rewards are invisible to it and the closing
        // balance comes out too low. For the current year, and for 'all' time
        // (whose closing balance is the same "right now" figure), anchor the
        // closing balance to live chain state instead. Past years stay
        // reconstructed: the chain has long since moved on, so no truthful
        // historical number exists there. The balances are the ones refresh()
        // already holds, so this costs no RPC.
        const currentYear = String(new Date().getUTCFullYear())
        const anchorLive = statementYear === currentYear || statementYear === 'all'
        let next: Statement = base
        if (anchorLive && nimBalance !== null) {
          next = {
            ...base,
            totals: {
              ...base.totals,
              closingBalanceNim: liveClosingBalanceNim(
                Number(nimBalance),
                Number(stakingHolding?.active || 0),
                Number(stakingHolding?.inactive || 0),
                Number(stakingHolding?.retired || 0)
              ),
              closingBalanceSource: 'live',
            },
          }
        }
        statementKeyRef.current = key
        setStatement(next)
      } catch (e) {
        if (cancelled) return
        console.warn('Statement failed:', e)
        reportSoftFailure(e, 'Statement prices unavailable right now. Try again shortly.')
        // A rebuild that fails keeps the statement already on screen.
        if (!silent) setStatement(null)
      } finally {
        if (!cancelled) setStatementLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    account?.nimiqAddress,
    allTxs,
    statementYear,
    nimBalance,
    stakingHolding,
    reportSoftFailure,
    analyticsHeldContracts,
    contractTxsForAnalytics,
  ])

  // Recalculate clears the figures and they are worked out again, and a currency
  // switch does the same, so the report always matches what it labels. Between
  // those, the report follows the books (see the effect below).
  // The tax report stays on the 37 historical rates are published for (see
  // TAX_CURRENCIES): any newer display currency computes and exports in USD
  // until its historical daily FX exists. Everything else about the maths is
  // unchanged.
  const taxCurrency: CurrencyCode = TAX_CURRENCIES.includes(currency) ? currency : 'usd'
  // FX rate: how many units of the reporting currency one USD buys. Read from
  // the dedicated FX ladder (lib/prices.ts); USD itself is identity.
  const taxFxRate = useMemo(() => {
    if (taxCurrency === 'usd') return 1.0
    const direct = fxTable[taxCurrency]
    // A nonsensical or unknown rate never wipes out the figures: fall back to
    // raw USD (rate 1), matching lib/tax's own guard.
    return hasRate(direct) ? direct : 1.0
  }, [fxTable, taxCurrency])

  // Crypto tax (FIFO). The first figures show a spinner. After that the report
  // follows the books: while the tax card is on screen, a change to the
  // transaction list or to the FX rate is worked out again in the background and
  // swapped in, with the old figures staying visible meanwhile. Recalculate and a
  // currency switch still start from a clean spinner.
  const taxRunRef = useRef(0)
  // The transaction list and FX rate the report on screen was built from.
  const taxBuiltRef = useRef<{ txs: NimiqTx[]; rate: number } | null>(null)
  // Every daily close seen so far. A pass that cannot reach DefiLlama must not drop
  // the years only that history covers, so the prices only ever accumulate.
  const taxPricesRef = useRef<Record<string, number>>({})
  useEffect(() => {
    if (view !== 'export') return
    const own = account?.nimiqAddress
    if (!own || taxBusy) return
    const sameCurrency = taxReport?.currency === taxCurrency
    const built = taxBuiltRef.current
    if (sameCurrency && built && built.txs === allTxs && built.rate === taxFxRate) return
    // A report already on screen in this currency is replaced quietly.
    const silent = sameCurrency
    const run = ++taxRunRef.current
    const txs = allTxs
    const rate = taxFxRate
    if (!silent) setTaxBusy(true)
    getAllDailyNimPrices()
      .then((fetched) => {
        if (run !== taxRunRef.current) return
        taxPricesRef.current = { ...taxPricesRef.current, ...fetched }
        taxBuiltRef.current = { txs, rate }
        setTaxReport(computeFifoGains(txs, own, taxPricesRef.current, taxCurrency, rate))
      })
      .catch(() => {
        if (!silent && run === taxRunRef.current) {
          setError('Tax figures unavailable. Check your connection and recalculate.')
        }
      })
      .finally(() => {
        if (!silent && run === taxRunRef.current) setTaxBusy(false)
      })
  }, [view, account?.nimiqAddress, allTxs, taxReport, taxBusy, currency, taxCurrency, taxFxRate])

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
        setToast('Device preferences enabled. Settings are saved to this device.')
      } else {
        setError('Device preferences unavailable. This works inside Nimiq Pay.')
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
      setError("That doesn't look like a NimBooks backup. Paste the whole file, braces included.")
      return
    }
    const total = Object.keys(file.keys).length
    if (total === 0) {
      setError('That backup is empty. There was nothing stored when it was taken.')
      return
    }
    const { restored } = importBackup(file)
    if (restored === 0) {
      setError('Everything in that backup is already on this device. Nothing to restore.')
      return
    }
    setBackupMode(null)
    setToast(`Restored ${restored} of ${total} items, reloading…`)
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
        ref={dialogFocus}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>NimBooks changelog</h2>
          <button className="btn-ghost" onClick={() => setChangelogOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        {/* "New look (beta)" opt-in: at the top of this window, directly above
            the bug line, in both looks. The switch is hand-rolled so it works
            in classic too, before the beta chunk is ever loaded. */}
        <div className="beta-toggle-row">
          <div className="beta-toggle-text">
            <span className="beta-toggle-label">New look (beta)</span>
            <span className="beta-toggle-hint">
              Try the redesigned layout. Overview and the yield calculator are ready; the other sections
              keep their classic content for now.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={uiBeta}
            aria-label="New look (beta)"
            data-learn="beta"
            className={uiBeta ? 'beta-switch on' : 'beta-switch'}
            onClick={() => setUiMode(uiBeta ? 'classic' : 'beta')}
          >
            <span className="beta-switch-thumb" />
          </button>
        </div>
        <p className="changelog-feedback">
          {uiBeta ? 'Found something odd in the new look? Report it in the ' : 'Report a bug or send feedback in the '}
          <a href={FEEDBACK_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Telegram group
          </a>{' '}
          or at <a href="mailto:nimbooks@subimpact.net">nimbooks@subimpact.net</a>
        </p>
        {isDemoMode() || !canSend() ? (
          // Demo and read-only sessions cannot sign a payment, so the changelog
          // shows the public donation address with a copy instead.
          <p className="changelog-feedback">
            Support NimBooks:{' '}
            <span className="mono">{DONATION_ADDRESS}</span>{' '}
            <button
              type="button"
              className="btn-ghost changelog-support-copy"
              onClick={async () => {
                if (await copyText(DONATION_ADDRESS, 'NIM address copied!')) setAddrCopied(true)
              }}
            >
              {addrCopied ? 'Copied ✓' : 'Copy'}
            </button>
          </p>
        ) : (
          <button type="button" className="btn-ghost-lg changelog-support" onClick={openDonationFromChangelog}>
            Support NimBooks
          </button>
        )}
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
      {uiBeta ? ' beta' : ''}
    </button>
  )

  // The AI door. A link, not a button: /mcp is a static page outside the app,
  // and it opens in its own tab so an app session is never disturbed.
  const mcpChip = (
    <a
      className="mcp-chip"
      data-learn="mcp"
      href="/mcp"
      target="_blank"
      rel="noopener"
      title="NimBooks for AI assistants: the MCP server"
      aria-label="Open the MCP setup page"
    >
      MCP
    </a>
  )

  const demoMode = isDemoMode()
  const stakeGate = useMemo(
    () => stakeGateStatus(stakingHolding, demoMode, grantedAccess),
    [stakingHolding, demoMode, grantedAccess]
  )

  // Why the stake submit is dark, in words, for every case the panel doesn't
  // already explain elsewhere (demo banner, empty-wallet card, the 100 NIM
  // hint under the amount). Never preselects a validator to make it go away:
  // the choice of pool stays the user's.
  const stakeBlockedReason: string | null = (() => {
    if (staking || demoMode) return null
    if (!canStake()) return 'Connect your own wallet to stake.'
    if (hubSession && !hubStakeReady) {
      return hubPrepFailed
        ? "Couldn't load the signing library yet. Check your connection - retrying automatically."
        : 'Preparing the signing library…'
    }
    if (stakeMaxNim <= 0) return null
    if (!hasStaker && stakeMaxNim < MIN_STAKE_NIM) return null
    if (!validatorChosen) return 'Pick a validator above to stake.'
    if (!stakeAmountValid) {
      if (!hasStaker && stakeAmountNim > 0 && stakeAmountNim < MIN_STAKE_NIM) return null
      return 'Choose an amount to stake.'
    }
    return null
  })()

  const handleStakeFromGate = () => {
    setSelectedValidator(cleanAddr(PINNED_VALIDATOR_ADDRESS))
    openStake()
  }

  // Coming back from a link Nimiq Pay opened in this same WebView: the session
  // is being restored, so hold the hero and say so. Deliberately nothing to
  // press — the connect screen would invite a second connect for a wallet that
  // is already on its way back.
  if (!account && restoring) {
    return (
      <div className="app">
        <HeroBackground />
        <header className="hero">
          <div className="logo">📒</div>
          <h1>NimBooks</h1>
          <p className="tagline">Earn on your NIM: stake from Nimiq Pay, even NIM still on its way to you, or from any browser, and every reward lands in your books and tax in your own currency.</p>
        </header>
        <main className="connect-panel">
          <div className="stake-progress" role="status" aria-live="polite">
            <p className="stake-progress-head">
              <span className="stake-spinner" aria-hidden="true" />
              Reconnecting to your wallet…
            </p>
          </div>
        </main>
      </div>
    )
  }

  if (!account) {
    // One path per device — see lib/device.ts for the detection rules.
    const inNimiqPay = isInNimiqPay()
    const isMobile = isMobileDevice()
    return (
      <div className="app app-landing">
        <HeroBackground />
        <div className="landing-intro">
          <header className="hero">
            <div className="hero-actions">
              {versionBadge}
              {mcpChip}
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
            <p className="tagline">Earn on your NIM: stake from Nimiq Pay, even NIM still on its way to you, or from any browser, and every reward lands in your books and tax in your own currency.</p>
            {publicStats && publicStats.uniqueWallets > 0 && (
              <div
                className="hero-metric-pill"
                role="status"
                title="Real wallets that connected to NimBooks, and their visits. The sample wallet is not counted."
              >
                <span className="live-dot" aria-hidden="true" />
                <span className="metric-text">
                  <strong>{publicStats.uniqueWallets.toLocaleString(lang)}</strong> {publicStats.uniqueWallets === 1 ? 'wallet' : 'wallets'} connected
                  {publicStats.since &&
                    ` since ${new Date(publicStats.since + 'T00:00:00Z').toLocaleDateString(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`}
                  {publicStats.totalConnections > 0 && (
                    // Real spaces either side of the dot: it is aria-hidden, so without them
                    // screen readers would run the two counts together
                    <>
                      {' '}
                      <span className="metric-sep" aria-hidden="true">·</span>
                      {' '}
                      <strong>{publicStats.totalConnections.toLocaleString(lang)}</strong> {publicStats.totalConnections === 1 ? 'visit' : 'visits'}
                    </>
                  )}
                </span>
              </div>
            )}
            {/* Where the visits come from: Pay on phones, the Hub (Nimiq Wallet) in any browser */}
            {publicStats && publicStats.pay + publicStats.hub > 0 && (
              <p className="hero-metric-split">
                {publicStats.pay.toLocaleString(lang)} {publicStats.pay === 1 ? 'visit' : 'visits'} via Nimiq Pay ·{' '}
                {publicStats.hub.toLocaleString(lang)} via Nimiq Wallet
              </p>
            )}
          </header>
          <main className="connect-panel">
            {stakeLinkIntent && (
              <p className="stake-link-waiting">A stake link is waiting. Connect a wallet to open it.</p>
            )}
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
                  href={payHandoffHref(stakeLinkIntent)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Nimiq Pay →
                </a>
                <p className="hint">
                  NimBooks runs inside the Nimiq Pay app, where your NIM wallet lives. Tap it
                  on your phone.
                </p>
                {/* Phone without the app: the Hub login works on mobile browsers
                    via redirect (lib/wallet.connectHub) — staking included,
                    since the Hub signing path shipped. */}
                <button
                  className="btn-ghost-lg"
                  onClick={connectWithHub}
                  disabled={connecting || hubConnecting}
                >
                  {hubConnecting ? 'Opening Nimiq Hub…' : 'No app? Continue with Nimiq Hub'}
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary" onClick={connectWithHub} disabled={connecting || hubConnecting}>
                  {hubConnecting ? 'Opening Nimiq Hub…' : 'Continue with Nimiq Hub'}
                </button>
                <p className="hint">
                  Sign in with your Nimiq wallet right here in the browser. No app needed.
                </p>
              </>
            )}
            <button className="btn-ghost-lg" onClick={() => connectDemo()} disabled={connecting || hubConnecting}>
              Try with a sample wallet
            </button>
            {error && <p className="error">{error}</p>}
            {/* Soft warnings (stale rates, a busy node) land in the toast, which
                this screen has no room for — a dim note carries them instead. */}
            {toast && !error && <p className="hint small">{toast}</p>}
            {/* Informed consent sits beside the buttons that act on it. */}
            <p className="hint small dim count-notice">
              {COUNT_NOTICE}{' '}
              {countConsent === 'no' ? (
                <>
                  This device won't be counted.{' '}
                  <button className="btn-link-inline" onClick={() => chooseCount('yes')}>Count me</button>
                </>
              ) : (
                <button className="btn-link-inline" onClick={() => chooseCount('no')}>Don't count me</button>
              )}
            </p>
          </main>
          <PhoneQr />
        </div>
        <Landing onSampleEntry={connectDemo} busy={connecting || hubConnecting} />
        {changelogModal}
      </div>
    )
  }

  // The unstake's two beats, built once. The stake panel and the balance
  // banner's modal are two windows onto the same finish, and a card that lived
  // in only one of them would drift from the other within a release. `onDone`
  // is the only difference: each window closes itself, then lands on Overview.
  const unstakeBeats = (onDone: () => void) => {
    if (!unstakeSubmitted || unstakeFlow === 'form') return null
    const { legs, notes } = unstakeSubmitted
    // The verification follows the last leg that went out, so that is the leg
    // the card is headlined by — a withdraw+deactivate submit leads with the
    // deactivate and reports the withdrawal as a row under it.
    const primary = legs[legs.length - 1]
    const copy = UNSTAKE_LEG[primary.kind]
    // Rows and transaction lines are labelled by leg only when there are two to
    // tell apart: on a single leg the headline already names the action, and
    // "Amount" is what the stake and send cards call it.
    const amounts = (
      <div className="invoice-confirm">
        {legs.map((leg) => (
          <div className="row" key={leg.hash}>
            <span>{legs.length > 1 ? UNSTAKE_LEG[leg.kind].row : 'Amount'}</span>
            <span>{leg.amountNim.toLocaleString(lang)} NIM</span>
          </div>
        ))}
      </div>
    )
    const hashes = legs.map((leg) => (
      <p className="hint small" key={leg.hash}>
        {legs.length > 1 ? `${UNSTAKE_LEG[leg.kind].row} transaction` : 'Transaction'}{' '}
        <a
          className="tx-hash-link"
          href={explorerTxUrl(leg.hash)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {leg.hash.slice(0, 16)}…
        </a>
      </p>
    ))
    const asides = notes.map((note) => (
      <p className="hint small" key={note}>
        {note}
      </p>
    ))
    if (unstakeFlow === 'confirming') {
      return (
        <div className="stake-progress unstake-progress" role="status" aria-live="polite">
          <p className="stake-progress-head">
            <span className="stake-spinner" aria-hidden="true" />
            Confirming on chain…
          </p>
          {amounts}
          {hashes}
          {asides}
          <p className="hint small">
            Nimiq mines in about a second, so this is usually over before you read it. You can close
            this: the transaction is already on its way and it lands in your History either way.
          </p>
          {/* A submit can report something the form is no longer there to show:
              a second leg the wallet refused, or a remainder that is already
              cooling down. It rides on the card instead. */}
          {unstakeError && <p className="hint small warn">{unstakeError}</p>}
        </div>
      )
    }
    // Confirmed is a plain statement of fact, not a celebration: nothing has
    // arrived yet on a deactivate or a retire, and even a withdrawal is money
    // coming back rather than a win. No confetti here on purpose.
    const confirmed = unstakeVerify === 'confirmed'
    return (
      <div
        role="status"
        aria-live="polite"
        className={
          confirmed ? 'invoice-sent stake-done unstake-done' : 'stake-done unstake-done unconfirmed'
        }
      >
        {confirmed ? (
          <p className="ok">✓ {copy.done}</p>
        ) : (
          <p className="stake-done-title">{copy.pending}</p>
        )}
        {amounts}
        {hashes}
        {asides}
        <p className="hint small">
          {confirmed
            ? copy.next
            : 'It was submitted, but we could not confirm it on chain. Check History in a moment.'}
        </p>
        {unstakeError && <p className="hint small warn">{unstakeError}</p>}
        <button className="btn-primary stake-submit" onClick={onDone}>
          Done
        </button>
      </div>
    )
  }

  const inNimiqPay = isInNimiqPay()

  // One props object per ported screen, shared by the classic and the beta
  // ("New look (beta)") render, so the two can never drift apart on inputs.
  const earnCardProps: ComponentProps<typeof EarnCard> = {
    stakedNim: activeStakeNim,
    idleNim: stakeMaxNim,
    hasStaker: earning,
    rate: earnRate ?? null,
    validatorName: earning ? (currentValidator?.name ?? null) : null,
    compound: earnCompound,
    minStakeNim: MIN_STAKE_NIM,
    nimPrice: shown.nim,
    currency: currency,
    lang: lang,
    onStake: () => {
      openStake()
      if (stakeMaxNim > 0) setStakeAmount(String(Math.floor(stakeMaxNim)))
    },
    onCalculator: () => setCalcOpen(true),
    lastVisitMs: previousVisitMs,
    rewardsSinceVisit: rewardsSincePreviousVisit,
    trailing: actualYield,
    validatorEarnings: validatorEarnings,
    terms: terms,
    payoutType: earning ? currentValidator?.payoutType : undefined,
    scheduleLabel: scheduleLabel,
    restakeGainNim: restakeGain,
    inNimiqPay: inNimiqPay,
    reminder: reminder,
    pending: historyPendingFirstLoad,
  }
  // In beta the earn card is rebuilt on the kit inside BetaOverview; the
  // classic card only ever renders in the classic look.
  const earnCard = <EarnCard {...earnCardProps} />
  const calcProps: ComponentProps<typeof YieldCalculator> = {
    validators: validators,
    loading: validatorsLoading,
    initialAmountNim: earning ? activeStakeNim : stakeMaxNim,
    initialValidator: earning && currentValidator ? currentValidator.address : null,
    nimPrice: shown.nim,
    currency: currency,
    lang: lang,
    onClose: () => setCalcOpen(false),
    availableNim: stakeMaxNim,
    stakedNim: earning ? activeStakeNim : 0,
    minStakeNim: MIN_STAKE_NIM,
    onStake: (amountNim, validatorAddress) => {
      setCalcOpen(false)
      openStake()
      setStakeAmount(String(amountNim))
      // Only a first stake picks a pool; an existing staker keeps theirs.
      if (!stakingHolding && validatorAddress) setSelectedValidator(cleanAddr(validatorAddress))
    },
  }
  const calcUi = uiBeta ? (
    <Suspense fallback={<YieldCalculator {...calcProps} />}>
      <BetaYieldCalculator {...calcProps} />
    </Suspense>
  ) : (
    <YieldCalculator {...calcProps} />
  )

  // The classic Balance details card: in the classic dashboard it sits below
  // the quick actions; in beta it lives inside the Balance card's Details
  // collapsible. One JSX, two homes.
  const renderBalanceDetails = () =>
    nimBalance !== null && offBalanceLuna > 0 && (
              <div className="card">
                <span className="label label-with-info">
                  Balance details
                  <InfoIcon text="Where your NIM sits: available in your wallet, staked with a validator, cooling down after unstaking, ready to withdraw, or locked in swap contracts." />
                </span>
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
  )

  // The classic Addresses card: same JSX as the Balance details card above.
  const renderAddresses = () => (
            <div className="card">
              <span className="label label-with-info">
                Addresses
                <InfoIcon text="The addresses your wallet uses. Tap the NIM address to copy it. The EVM address is the one connected to your wallet for EVM assets." />
              </span>
              {account.nimiqAddress && (() => {
                const addr = account.nimiqAddress
                return (
                  <button
                    type="button"
                    className="addr addr-with-iqon"
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
                          setError('Could not copy. Long-press the address instead.')
                        }
                      }
                    }}
                  >
                    <Iqon address={addr} size={28} />
                    <span className="addr-text">NIM: {addr}</span>
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
                          setError('Could not copy. Long-press the address instead.')
                        }
                      }
                    }}
                  >
                    EVM: {addr}
                  </button>
                )
              })()}
            </div>
  )  // "New look (beta)" + a connected session renders the beta shell; the
  // landing and connect screens are always classic.
  const betaShellOn = uiBeta && !!account

  // Sidebar "Where your NIM is": one row per EVM asset (the same symbol can
  // sit on several chains), priced with the display-currency table. An
  // unpriced asset stays NaN so the row can say "Price unavailable".
  const evmFiatBySymbol: Record<string, number> = {
    usdt: shown.usdt,
    pol: shown.pol,
    eth: shown.eth,
  }
  const evmSidebarRows: Array<{ symbol: string; amount: number; fiat: number }> = []
  for (const balance of evmBalances) {
    const raw = Number(balance.balance) / 10 ** balance.decimals
    const amount = Number.isFinite(raw) ? raw : 0
    // `fiat` is the row's VALUE (amount x unit price), not the unit price.
    const unitPrice = evmFiatBySymbol[balance.symbol.toLowerCase()] ?? NaN
    const value = amount > 0 ? (hasRate(unitPrice) ? amount * unitPrice : NaN) : 0
    const existing = evmSidebarRows.find((row) => row.symbol === balance.symbol)
    if (existing) {
      existing.amount += amount
      existing.fiat += value
    } else {
      evmSidebarRows.push({ symbol: balance.symbol, amount, fiat: value })
    }
  }

  // One row renderer for both History layouts: the flat list and a reward
  // month's expanded rows must be the same row, so it is written once here.
  // Content is unchanged from when this JSX lived inside the list.
  const renderHistoryTxRow = (tx: NimiqTx) => {
    // Direction comes from the filter module, so the arrow and the chip that
    // lists the row can never disagree (a remote row sent from the relay is
    // outgoing, everything else that is not from the basic address is in).
    const isOut = historyDirection(tx, historyCtx) === 'out'
    const label = txLabel(tx, account.nimiqAddress ?? '')
    const memo = decodeMemo(tx.data)
    const cashlinkTag = isCashlinkMemo(memo)
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
    const counterparty = isOut ? tx.recipient : tx.sender
    return (
      <div key={tx.hash} className="tx tx-with-iqon">
        <Iqon address={counterparty} size={28} className="tx-iqon" />
        <div className="tx-body">
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
            {tx.timestamp
              ? new Date(timestampToMs(tx.timestamp)).toLocaleString(lang)
              : '…'} ·{' '}
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
          {/* A staking transaction's data field is a signalling
              payload, not a note anyone wrote: rendering that hex blob
              as "memo:" is noise on screen and in the export. The
              cashlink funding and claiming tags are the same kind of
              furniture, so the row names the thing instead. */}
          {cashlinkTag ? (
            <div className="tx-memo">Cashlink</div>
          ) : (
            memo &&
            label !== 'stake' &&
            label !== 'unstake' && (
              <div className="tx-memo">
                memo:{' '}
                {(() => {
                  // The on-chain memo is the invoice reference
                  // (nimbooks:invoice:<id>); the human description
                  // travels in the share link. When this tx settled a
                  // request we know locally, show the friendly name.
                  const invId = parseInvoiceMemo(memo)
                  const inv = invId ? invoices.find((i) => i.id === invId) : undefined
                  return inv?.memo ? `${inv.memo} (${memo})` : memo
                })()}
              </div>
            )
          )}
          {/* A deposit into the staking contract (toType 3) is not a
              receipt candidate either — see lib/chain: the wallet
              can't prove a payment it didn't make to a counterparty,
              so the signature would verify and prove nothing. */}
          {!tx.synthetic && !tx.remote && tx.toType !== 3 && (
            <button
              className="btn-small"
              onClick={() => makeReceipt(tx)}
              disabled={
                demo ||
                receipts.some((r) => r.txHash === tx.hash) ||
                signingHash === tx.hash
              }
              title={demo ? 'Demo mode is read-only. Connect your wallet to sign receipts.' : undefined}
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
      </div>
    )
  }

  // The beta ("New look (beta)") wiring: one props object per beta screen,
  // sourced from the same closures the classic sections read, so the two
  // looks can never drift on inputs or actions.
  const betaShellProps = {
    view,
    onNavigate: setView,
    address: account.nimiqAddress ?? null,
    versionLabel: `${APP_VERSION_LABEL} beta`,
    onVersion: () => setChangelogOpen(true),
    onDisconnect: disconnect,
    theme,
    onToggleTheme: toggleTheme,
    onStake: openStake,
    onRefresh: () => refresh(account),
    refreshing: loading,
    countdown: !demoMode && !loading && account.nimiqAddress ? countdown : null,
    price: {
      nim: shown.nim,
      currency,
      // USD -> display currency for the history points: the NIM pair when
      // both legs are known, else the stablecoin table (NaN when neither).
      usdToCur:
        hasRate(fiat.nim[currency]) && hasRate(fiat.nim.usd)
          ? fiat.nim[currency] / fiat.nim.usd
          : fiat.usdt[currency],
      lang,
    },
    holdings: {
      availableLuna: Number(nimBalance) || 0,
      stakedLuna,
      movingLuna: htlcLuna,
      vestedLuna,
      evm: evmSidebarRows,
    },
    stake: {
      // A staker can add any amount above 1 NIM; a first stake must clear the
      // protocol's 100 NIM minimum (same rule the Earn card uses).
      show: earning ? stakeMaxNim >= 1 : stakeMaxNim >= MIN_STAKE_NIM,
      onStake: () => {
        openStake()
        if (stakeMaxNim > 0) setStakeAmount(String(Math.floor(stakeMaxNim)))
      },
    },
    notices: (
      <>
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
      </>
    ),
  }
  const betaOverviewProps = {
    lang,
    currency,
    currencyFlag: cur.flag,
    onCurrencyPicker: () => setCurrencyOpen(true),    balanceHero:
      nimBalance === null ? '…' : `${formatLuna(String(totalNimLuna), lang)} NIM`,
    totalValueFiat: formatFiat(totalFiat, currency),
    totalValueNote: totalFiatSubNote,
    nimBalance,
    // Luna, like every other figure on the balance card (the classic Balance
    // details row shows the same retireable stake).
    stakedLuna: retireableLuna,
    inTransitLuna: htlcLuna,
    earnProps: earnCardProps,
    nudge:
      stakeNudgeTx && earnRate !== null
        ? {
            receivedNim: stakeNudgeTx.nim,
            dateMs: timestampToMs(stakeNudgeTx.timestamp),
            rate: earnRate,
            yearNim: projectStake({
              principalNim: stakeNudgeTx.nim,
              annualRateNow: earnRate,
              months: 12,
              compound: earnCompound,
            }).firstYearNim,
            onAccept: acceptStakeNudge,
            onDismiss: dismissStakeNudge,
          }
        : null,
    onSend: tourActive ? undefined : openSend,
    sendDisabled: !account.nimiqAddress,
    onReceive: () => setReceiveOpen(true),
    quickNote: !account.nimiqAddress
      ? 'This connection has no Nimiq address. Connect a Nimiq wallet to send or receive NIM.'
      : demoMode
        ? 'Demo mode is read-only: receiving works, sending needs your own wallet.'
        : !canSend()
          ? "This wallet can't sign transactions here. Receiving works either way."
          : null,
    details: (
      <div className="classic-in-beta">
        {renderBalanceDetails()}
        {renderAddresses()}
      </div>
    ),
  }

  // The five sections render once: either inside the classic chrome (the
  // default look) or inside the beta shell. Same JSX, same closures, two
  // frames - beta only re-frames them, it never re-writes them.
  const renderSections = () => (
      <main className={betaShellOn ? 'classic-in-beta' : undefined}>
        {view === 'dashboard' && (
          <section className="dashboard">
            {!uiBeta && (
              <HistoryProgress
                active={lightLoadActive}
                lang={lang}
                onRetry={account ? () => void refresh(account) : undefined}
              />
            )}
            {!uiBeta && (
              <div className="stat-row">
              <div className="card total" data-learn="total">
                <div className="total-header">
                  <span className="label label-with-info">
                    Total value
                    <InfoIcon text="Your NIM and EVM assets at the current market rate, in the display currency. Staked, unstaking and HTLC-in-transit funds are included. Everything that is yours." />
                  </span>
                  {/* Visible affordance for the currency picker — the value
                      itself used to be the (invisible) button. */}
                  <button
                    type="button"
                    className="currency-chip"
                    onClick={() => setCurrencyOpen(true)}
                    title="Change display currency"
                  >
                    {cur.flag ? (
                      <img
                        className="chip-flag"
                        src={`/flags/flag-${cur.flag}.svg`}
                        alt=""
                        width={16}
                        height={16}
                      />
                    ) : (
                      <span className="chip-flag currency-badge badge-sm" aria-hidden="true">
                        {currency.toUpperCase()}
                      </span>
                    )}
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
                {historyPendingFirstLoad ? (
                  <span className="value dim">Loading…</span>
                ) : (
                  <span className="value">{formatFiat(totalFiat, currency)}</span>
                )}
                {!historyPendingFirstLoad && totalFiatSubNote && (
                  <span className="sub dim" data-probe="price-asof">
                    {totalFiatSubNote}
                  </span>
                )}
              </div>

              <div className="card nim-tile" data-tour="balance">
                <span className="label label-with-info">
                  NIM balance
                  <InfoIcon text="Your NIM on the Nimiq chain: available, staked, unstaking, and funds held in HTLC swap contracts (shown as in transit)." />
                </span>
                {historyPendingFirstLoad || nimBalance === null ? (
                  <span className="value dim">{historyPendingFirstLoad ? 'Loading…' : '…'}</span>
                ) : (
                  <>
                    <span className="value">{formatLuna(String(totalNimLuna), lang)} NIM</span>
                    <span className="sub">
                      ≈ {formatFiat((totalNimLuna / 100000) * shown.nim, currency, 4)}
                    </span>
                    {/* A relay-routed wallet reads 0 in its basic account, so
                        say where the money actually is rather than let the
                        total look like it came from nowhere. */}
                    {htlcLuna > 0 && (
                      <span className="sub dim">
                        {formatLuna(String(htlcLuna), lang)} NIM in transit (HTLC)
                      </span>
                    )}
                  </>
                )}
              </div>
              </div>
            )}

            {/* Connected, but the wallet host hasn't caught up and there is
                nothing on screen yet — say why rather than let it read as an
                empty wallet. Nothing is gated on this. */}
            {payConsensus === false &&
              totalNimLuna === 0 &&
              allTxs.length === 0 &&
              !historyPendingFirstLoad && <p className="hint small dim">{PAY_SYNCING_COPY}</p>}

            {/* A session restored from before the notice existed never saw it:
                ask once, and count nothing until answered. */}
            {account.provider !== 'demo' && countConsent === null && (
              <div className="card count-consent" role="region" aria-label="Wallet count">
                <p className="hint small">{COUNT_NOTICE}</p>
                <div className="count-consent-actions">
                  <button className="btn-secondary" onClick={() => chooseCount('yes')}>OK, count me</button>
                  <button className="btn-secondary" onClick={() => chooseCount('no')}>Don't count me</button>
                </div>
              </div>
            )}

            {/* Earning comes first: what the wallet earns now, or could. In
                beta this card is rebuilt on the kit inside BetaOverview. */}
            {!uiBeta && earnCard}

            {/* "Stake it?" - the second reason to come back, one tap from the
                Earn card it extends. Hidden while the tour moves the page. */}
            {!uiBeta && stakeNudgeTx && earnRate !== null && (
              <div className="card stake-nudge" role="region" aria-label="Stake a received payment">
                <p className="stake-nudge-line">
                  You received {stakeNudgeTx.nim.toLocaleString(lang, { maximumFractionDigits: 2 })} NIM on{' '}
                  {new Date(stakeNudgeTx.timestamp).toLocaleDateString(lang)}. Stake it? At{' '}
                  {(earnRate * 100).toLocaleString(lang, { maximumFractionDigits: 2 })}% p.a. it could earn about{' '}
                  {projectStake({ principalNim: stakeNudgeTx.nim, annualRateNow: earnRate, months: 12, compound: earnCompound }).firstYearNim.toLocaleString(lang, { maximumFractionDigits: 2 })} NIM a year.
                </p>
                <div className="stake-nudge-actions">
                  <button className="btn-primary" onClick={acceptStakeNudge}>
                    Stake it
                  </button>
                  <button className="btn-secondary" onClick={dismissStakeNudge}>
                    Not now
                  </button>
                </div>
              </div>
            )}

            {/* Quick actions: the two things a wallet is for, one thumb-reach
                below the balance. Actions, not sections — they open sheets and
                leave the 5-tab dock alone. */}
            {!uiBeta && (
            <div className="card quick-actions" data-learn="quick-actions">
              <span className="label">Quick actions</span>
              <div className="quick-actions-row">
                <button
                  type="button"
                  className="btn-primary quick-action"
                  onClick={tourActive ? undefined : openSend}
                  disabled={!account.nimiqAddress}
                  data-tour="quick-send"
                >
                  {/* Inline SVG like every other icon here — a Unicode arrow
                      tofus on some Android builds. */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 19V5" />
                    <path d="M5 12l7-7 7 7" />
                  </svg>
                  Send NIM
                </button>
                <button
                  type="button"
                  className="btn-secondary quick-action"
                  onClick={tourActive ? undefined : () => setReceiveOpen(true)}
                  data-tour="quick-receive"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14" />
                    <path d="M19 12l-7 7-7-7" />
                  </svg>
                  Receive NIM
                </button>
              </div>
              {!account.nimiqAddress ? (
                <p className="hint small">
                  This connection has no Nimiq address. Connect a Nimiq wallet to send or receive
                  NIM.
                </p>
              ) : demoMode ? (
                <p className="hint small">
                  Demo mode is read-only: receiving works, sending needs your own wallet.
                </p>
              ) : (
                !canSend() && (
                  <p className="hint small">
                    This wallet can't sign transactions here. Receiving works either way.
                  </p>
                )
              )}
            </div>
            )}

            {unstakeActivity && (
              <div className="pending-unstake-banner" role="status">
                <span className="pending-dot" aria-hidden="true" />
                <span className="banner-text">
                  {unstakeActivity.kind === 'pending' && (
                    <>
                      Deactivating {formatLuna(String(unstakeActivity.amountNim * 100000), lang)}{' '}
                      NIM. Takes effect at the next election block (up to ~12h), then a
                      reporting window before it's withdrawable.
                    </>
                  )}
                  {unstakeActivity.kind === 'cooling' && (
                    <>
                      {formatLuna(String(unstakeActivity.amountNim * 100000), lang)} NIM is
                      cooling down. Finish the unstake after the reporting window.
                    </>
                  )}
                  {unstakeActivity.kind === 'ready' && (
                    <>
                      {formatLuna(String(unstakeActivity.amountNim * 100000), lang)} NIM is
                      ready to withdraw. Move it to your balance.
                    </>
                  )}
                </span>
                {unstakeActivity.kind === 'cooling' &&
                  (unstakeActivity.retireReady ? (
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => {
                        if (!reopenBannerUnstake('retire')) void completeUnstake()
                      }}
                      disabled={!canStake() || staking || unstaking || (hubSession && !hubStakeReady)}
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
                    onClick={() => {
                      if (!reopenBannerUnstake('withdraw')) void withdrawRetired()
                    }}
                    disabled={!canStake() || staking || unstaking || (hubSession && !hubStakeReady)}
                  >
                    {unstaking ? 'Submitting…' : 'Withdraw'}
                  </button>
                )}
              </div>
            )}

            {/* Swapped, staked and vesting funds are still the user's — break
                the total down so a 0 basic balance doesn't read as "no money".
                With nothing off-balance the tile above is the whole story. */}
            {!uiBeta && renderBalanceDetails()}


            {evmBalances.length > 0 && (
              <div className="card">
                <span className="label label-with-info">
                  EVM assets
                  <InfoIcon text="Tokens on EVM chains connected through your wallet. Values are included in the Total value tile above." />
                </span>
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

            {!uiBeta && renderAddresses()}


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
                    <strong>Receive some NIM.</strong> Send NIM to your address above. It appears
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
                    {canStake() || demoMode ? (
                      // openStake, not a bare setStakeOpen: the panel now holds
                      // a submit flow between opens, and only openStake knows
                      // when it may be cleared (never mid-verification).
                      // Demo opens it read-only, like the send sheet.
                      <button className="btn-secondary" onClick={openStake}>
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
                would rewrite history by the reward total.
                The anchor is the *effective* balance (basic + HTLC): on a
                relay-routed wallet the basic account is 0, which drew a flat
                line at zero under a wallet holding thousands of NIM. */}
            <Analytics
              txs={nimTxs}
              currentBalanceNim={nimBalance === null ? null : String(effectiveBalanceLuna)}
              ownAddress={account.nimiqAddress ?? null}
              period={analyticsPeriod}
              onPeriodChange={setAnalyticsPeriod}
              onOpenHistory={() => setView('history')}
              lang={lang}
              nimRate={shown.nim}
              currency={currency}
              heldContracts={analyticsHeldContracts}
              contractTxs={contractTxsForAnalytics}
              pending={historyPendingFirstLoad}
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
            <HistoryProgress
              active={lightLoadActive}
              lang={lang}
              onRetry={account ? () => void refresh(account) : undefined}
            />
            {/* Single-select filter chips. Counts cover the whole loaded
                history; a filter with nothing in it is not offered (All always
                is, so there is always a way back). */}
            <div className="history-filters" role="group" aria-label="Filter transactions">
              {HISTORY_FILTERS.map((filter) => {
                const count = historyCountsByFilter[filter]
                if (filter !== 'all' && count === 0) return null
                return (
                  <button
                    key={filter}
                    type="button"
                    className={historyFilter === filter ? 'period active' : 'period'}
                    aria-pressed={historyFilter === filter}
                    onClick={() => pickHistoryFilter(filter)}
                  >
                    {HISTORY_FILTER_LABEL[filter]} {count}
                  </button>
                )
              })}
            </div>
            {/* Over ALL filtered rows, never the visible page: Load more must
                not move the figure. */}
            <p className="hint small history-summary">
              {historyFilter === 'received'
                ? `${countLabel(historyFilterSummary.count, 'payment')} · ${formatLuna(historyFilterSummary.totalLuna, lang)} NIM received`
                : historyFilter === 'sent'
                  ? `${countLabel(historyFilterSummary.count, 'payment')} · ${formatLuna(historyFilterSummary.totalLuna, lang)} NIM sent`
                  : historyFilter === 'rewards'
                    ? `${countLabel(historyFilterSummary.days, 'day')} of rewards · ${formatLuna(historyFilterSummary.totalLuna, lang)} NIM`
                    : countLabel(historyFilterSummary.count, 'transaction')}
            </p>
            <p className="hint small history-scope">In the history loaded on this device.</p>
            {historyFilterSummary.hiddenLuna !== '0' && (
              <p className="hint small history-hidden">
                Nimiq Pay internal transfers hidden:{' '}
                {formatLuna(historyFilterSummary.hiddenLuna, lang)} NIM
              </p>
            )}
            {historyHasInternal &&
              (historyFilter === 'all' ||
                historyFilter === 'received' ||
                historyFilter === 'sent') && (
                <button
                  type="button"
                  className={
                    hideInternalHistory
                      ? 'history-internal-toggle active'
                      : 'history-internal-toggle'
                  }
                  aria-pressed={hideInternalHistory}
                  onClick={() => setHideInternalHistory((v) => !v)}
                >
                  Hide Nimiq Pay internal transfers
                </button>
              )}
            {showTypeHelp && (
              <div className="card help-card">
                <p>
                  <strong>Basic transfer</strong>: a normal payment between two wallets. Money
                  moves straight from sender to recipient.
                </p>
                <p>
                  <strong>Swap (HTLC)</strong>: an atomic swap. Your wallet locks funds in a
                  contract; the counterparty claims them with a secret, or they refund to you
                  after the timeout. Nimiq Pay routes some transfers through these. While
                  locked, the funds are still yours. This is normal, not a drainer.
                </p>
                <p>
                  <strong>Stake / Unstake</strong>: you delegated NIM to a validator, or withdrew
                  it. Staked NIM lives in the staking contract rather than your basic balance,
                  and NimBooks counts it in the balance card.
                </p>
                <p>
                  <strong>Vesting</strong>: time-locked funds that release on a schedule.
                </p>
                <p>
                  <strong>Reward</strong>: validator payouts on your stake. These are paid every
                  few minutes and restaked automatically, so NimBooks sums them into one row per
                  day per validator. They come from a separate staking index that closes each UTC
                  day, so today's rewards appear tomorrow. Rewards go back to January 2025, when
                  the public rewards data starts.
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
            {unstakeActivity?.kind === 'pending' &&
              (historyFilter === 'all' || historyFilter === 'staking') && (
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
                Unstake transactions (deactivate, retire, withdraw) are not exposed by the public
                chain index, so only the ones you sent from this device appear below (reward
                payouts do too, one row per day). Your staker record is live:{' '}
                <strong>
                  {formatLuna(stakingHolding.active, lang)} NIM active
                  {Number(stakingHolding.inactive) > 0 &&
                    ` · ${formatLuna(stakingHolding.inactive, lang)} NIM cooling down`}
                  {Number(stakingHolding.retired) > 0 &&
                    ` · ${formatLuna(stakingHolding.retired, lang)} NIM withdrawable`}
                </strong>
              </p>
            )}
            {!loading && historyFiltered.length === 0 && (
              <p className="empty">{HISTORY_EMPTY[historyFilter]}</p>
            )}
            {/* Rewards read as one row per calendar month, newest first. The
                newest month is open until the user says otherwise; every month
                expands to the same daily rows the flat list renders. */}
            {historyFilter === 'rewards'
              ? rewardMonths.map((m, i) => {
                  const expanded = rewardMonthToggles[m.key] ?? i === 0
                  return (
                    <div key={m.key} className="reward-month">
                      <button
                        type="button"
                        className="reward-month-head"
                        aria-expanded={expanded}
                        onClick={() => toggleRewardMonth(m.key, i === 0)}
                      >
                        <span className="reward-month-name">{m.label}</span>
                        <span className="reward-month-meta">
                          {countLabel(m.days, 'day')} · {formatLuna(m.totalLuna, lang)} NIM
                        </span>
                        <span
                          className={
                            expanded ? 'reward-month-chevron open' : 'reward-month-chevron'
                          }
                          aria-hidden="true"
                        >
                          ▾
                        </span>
                      </button>
                      {expanded && m.rows.map((tx) => renderHistoryTxRow(tx))}
                    </div>
                  )
                })
              : historyFiltered.slice(0, visibleTxCount).map((tx) => renderHistoryTxRow(tx))}
            {historyFilter !== 'rewards' && historyFiltered.length > visibleTxCount && (
              <button
                className="btn-ghost-lg"
                onClick={() => setVisibleTxCount((c) => c + 100)}
              >
                Load more ({historyFiltered.length - visibleTxCount} remaining)
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
                <br />
                Signed some before? Receipts are kept on the device that signed them, so signing
                out of Nimiq Pay clears them. Restore a backup from Export, or sign them again
                from History: the transactions are still on-chain.
              </p>
            )}
            {receipts.length > 0 && backupDue && (
              <div className="card backup-nudge" role="status">
                <p className="hint small">
                  These receipts live only on this device. Signing out of Nimiq Pay or clearing
                  its data removes them; links you already shared keep working.
                </p>
                <button className="btn-secondary" onClick={openBackup}>
                  Back up now
                </button>
              </div>
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
                {r.memo &&
                  (() => {
                    // A receipt stores the tx's data field as hex. When it does
                    // not decode to text it is contract data (a Nimiq Pay swap
                    // contract's setup), not a note anyone wrote: name it rather
                    // than print a 160-character hex blob. A request reference
                    // shows the request's own description, as in History.
                    const memo = decodeMemo(r.memo)
                    if (memo === r.memo) return <div className="tx-memo">Contract data, no note</div>
                    const invId = parseInvoiceMemo(memo)
                    const inv = invId ? invoices.find((i) => i.id === invId) : undefined
                    return <div className="tx-memo">{inv?.memo ? `${inv.memo} (${memo})` : memo}</div>
                  })()}
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
                No payment requests yet. Create one above, then share the link. The payer settles
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
                  {/* The on-chain reference — matches the memo shown in History,
                      so a payer can verify which payment settled this request. */}
                  <div className="tx-sub mono">ref {invoiceMemo(inv.id)}</div>
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
          <section className="export" data-learn="export">
            <h2>Export</h2>
            <p className="hint">
              Download your NIM transaction history as CSV, ready for your accountant or tax
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

            <Portfolio
              account={account?.nimiqAddress ?? ''}
              walletLiquidLuna={effectiveBalanceLuna}
              walletStakedLuna={stakedLuna}
              vestedLuna={vestedLuna}
              nimPrice={shown.nim}
              currency={currency}
              lang={lang}
              gate={stakeGate}
              onStake={handleStakeFromGate}
              inNimiqPay={inNimiqPay}
              demo={demoMode}
              refreshTick={refreshTick}
            />

            <div className="card statement-card" data-learn="statement">
              <span className="label">Tax-year statement</span>
              <p className="hint small">
                Daily closes at CoinGecko UTC prices, aggregated per day: received, sent, fees,
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
              {showExtendedButton && (
                <div className="statement-controls">
                  <button className="btn-secondary" onClick={() => setExtendedConfirmOpen(true)}>
                    Load older history
                  </button>
                </div>
              )}
              {extendedLoading && extendedProgress && (
                <p className="hint small">
                  Loading older history… Loaded {extendedProgress.fetched} transactions…
                </p>
              )}
              {statementLoading && <p className="empty">Building statement…</p>}
              {!statementLoading && statement && (
                <>
                  <div className="statement-summary">
                    {statement.totals.openingBalanceNim !== null && (
                      <div className="row">
                        <span>Opening balance (Jan 1)</span>
                        <span>{statement.totals.openingBalanceNim.toFixed(5)} NIM</span>
                      </div>
                    )}
                    <div className="row">
                      <span>Received</span>
                      <span>
                        {statement.totals.receivedNim.toFixed(5)} NIM
                        {statement.totals.receivedUsd !== null &&
                          ` · $${statement.totals.receivedUsd.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="row">
                      <span>Sent to others</span>
                      <span>
                        {statement.totals.sentNim.toFixed(5)} NIM
                        {statement.totals.sentUsd !== null &&
                          ` · $${statement.totals.sentUsd.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="row">
                      <span>Network fees</span>
                      <span>
                        {statement.totals.feeNim.toFixed(5)} NIM
                        {statement.totals.feeUsd !== null &&
                          ` · $${statement.totals.feeUsd.toFixed(2)}`}
                      </span>
                    </div>
                    {(statement.totals.internalOutNim > 0 || statement.totals.internalInNim > 0) && (
                      <div className="row">
                        <span>Nimiq Pay internal transfers</span>
                        <span>
                          out {statement.totals.internalOutNim.toFixed(5)} NIM · back{' '}
                          {statement.totals.internalInNim.toFixed(5)} NIM
                        </span>
                      </div>
                    )}
                    {statement.totals.stakedNim > 0 && (
                      <div className="row">
                        <span>Staked (internal)</span>
                        <span>{statement.totals.stakedNim.toFixed(5)} NIM</span>
                      </div>
                    )}
                    {statement.totals.unstakedNim > 0 && (
                      <div className="row">
                        <span>Unstaked (internal)</span>
                        <span>{statement.totals.unstakedNim.toFixed(5)} NIM</span>
                      </div>
                    )}
                    <div className="row">
                      <span>Rewards</span>
                      <span>{statement.totals.rewardsNim.toFixed(5)} NIM</span>
                    </div>
                    {rewardTxs.length > 0 && !rewardsComplete && (
                      <p className="hint small">
                        Some staking rewards could not be loaded just now. They fill in on the
                        next refresh.
                      </p>
                    )}
                    {rewardTxs.length > 0 && statementYear === '2024' && (
                      <p className="hint small">
                        Staking rewards before January 2025 may be missing: the public rewards
                        data NimBooks reads starts then.
                      </p>
                    )}
                    <div className="row">
                      <span>Net change</span>
                      <span>
                        {statement.totals.netNim.toFixed(5)} NIM
                        {statement.totals.netUsd !== null && ` · $${statement.totals.netUsd.toFixed(2)}`}
                      </span>
                    </div>
                    {statement.totals.closingBalanceNim !== null && (() => {
                      const currentYear = String(new Date().getUTCFullYear())
                      const isCurrentPeriod =
                        statementYear === currentYear ||
                        // 'all' anchors its closing balance to the same live
                        // "right now" figure, so it gets the live note too.
                        statementYear === 'all'
                      return (
                        <>
                          <div className="row strong">
                            <span>
                              {isCurrentPeriod ? 'Current balance' : 'Closing balance (Dec 31)'}
                            </span>
                            <span>{statement.totals.closingBalanceNim.toFixed(5)} NIM</span>
                          </div>
                          {statement.totals.closingBalanceSource === 'live' ? (
                            <p className="hint small">
                              This is your live on-chain balance (liquid + staked), so it includes
                              funds that predate Nov 2024.
                            </p>
                          ) : (
                            statementYear !== 'all' && (
                              <p className="hint small">
                                Rebuilt from visible chain history; funds predating Nov 2024 are not
                                included.
                              </p>
                            )
                          )}
                        </>
                      )
                    })()}
                    <div className="row">
                      <span>Transactions</span>
                      <span>{statement.totals.txCount}</span>
                    </div>
                  </div>
                  {(statement.totals.internalOutNim > 0 || statement.totals.internalInNim > 0) && (
                    <p className="hint small">
                      Money moved into and out of Nimiq Pay's own payment contracts. It never left
                      you, so it is not counted as sent or received.
                    </p>
                  )}
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
                          setError('Could not copy statement. Use Download instead.')
                        }
                      }}
                    >
                      Copy CSV
                    </button>
                  </div>
                </>
              )}
              {!statementLoading && !statement && allTxs.length === 0 && (
                <p className="hint small">No transactions loaded yet. Statements appear here.</p>
              )}
            </div>

            <div className="card tax-card" data-learn="tax">
              <span className="label">Crypto tax (FIFO)</span>
              <p className="hint small">
                Realized gains on a first-in-first-out basis, priced at each day's close and
                reported in {CURRENCIES.find((c) => c.code === taxCurrency)?.label ?? taxCurrency.toUpperCase()}.
                History: DefiLlama, recent: CoinGecko. Figures for your records, not tax advice - confirm
                with your professional.
              </p>
              <p className="hint small">Reporting in {taxCurrency.toUpperCase()} · change in Overview</p>
              {currency !== taxCurrency && (
                <p className="hint small" data-probe="tax-usd-note">
                  Tax reports use USD for {currency.toUpperCase()} until historical exchange rates are added.
                </p>
              )}
              {taxBusy && <p className="empty">Computing gains…</p>}
              {!taxBusy && !taxReport && (
                <p className="empty">No tax figures yet - they load with the dashboard data.</p>
              )}
              {taxReport && (
                <>
                  <div className="statement-summary">
                    {taxReport.years.length === 0 && (
                      <div className="row">
                        <span>Disposals</span>
                        <span>None in this history</span>
                      </div>
                    )}
                    {taxReport.years.map((y) => (
                      <div key={y.year} className="tax-year-row">
                        <div className="tax-year-head">
                          <span className="tax-year">{y.year}</span>
                          {y.incomplete && <span className="badge">incomplete price coverage</span>}
                        </div>
                        <div className="tax-year-figures">{`Gain ${formatTaxFiat(y.gainUsd)} · Income ${formatTaxFiat(y.incomeUsd)}`}</div>
                      </div>
                    ))}
                    {rewardTxs.length > 0 && !rewardsComplete && (
                      <p className="hint small">
                        Some staking rewards could not be loaded just now. They fill in on the next
                        refresh.
                      </p>
                    )}
                    {rewardTxs.length > 0 && taxReport.years.some((y) => y.year === '2024') && (
                      <p className="hint small">
                        Staking rewards before January 2025 may be missing: the public rewards data
                        NimBooks reads starts then.
                      </p>
                    )}
                  </div>
                  <div className="statement-controls">
                    <label className="hint small" htmlFor="taxFormat">
                      Format
                    </label>
                    <select
                      id="taxFormat"
                      className="select"
                      value={taxFormat}
                      onChange={(e) => setTaxFormat(e.target.value as TaxFormat)}
                    >
                      {(Object.keys(TAX_FORMAT_LABELS) as TaxFormat[]).map((f) => (
                        <option key={f} value={f}>
                          {TAX_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="statement-actions">
                    <button
                      className="btn-primary"
                      onClick={() => {
                        const e = csvExport('tax')
                        if (e) void downloadCsv(e.filename, e.csv)
                      }}
                      disabled={!taxReport}
                    >
                      Download tax ledger CSV ({TAX_FORMAT_LABELS[taxFormat]})
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        const e = csvExport('tax-summary')
                        if (e) void downloadCsv(e.filename, e.csv)
                      }}
                      disabled={!taxReport}
                    >
                      Download gains summary CSV
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setTaxReport(null)
                      }}
                      disabled={taxBusy}
                      aria-label="Recalculate tax figures"
                      title="Recalculate tax figures"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        {/* rotate-ccw: recompute from the same books */}
                        <path d="M1 4v6h6" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                    </button>
                  </div>
                  {taxReport.missingPriceDays > 0 && (
                    <p className="hint small">
                      {taxReport.missingPriceDays} days had no historical price - affected transactions are
                      excluded from gains.
                    </p>
                  )}
                  {taxReport.unmatchedDisposals > 0 && (
                    <p className="hint small">
                      {taxReport.unmatchedDisposals} sales had no cost basis in the loaded history
                      (coins bought before tracking). Their gain is not computed.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="card backup-card" data-learn="backup">
              <span className="label">Backup &amp; restore</span>
              <p className="hint small">
                Your books are yours: take them out any time. Receipts, payment requests, the
                staking log and your preferences live on this device only, so a cleared cache
                takes them with it.
              </p>
              <button className="btn-secondary" onClick={openBackup}>
                Back up my data
              </button>
              <button className="btn-secondary" onClick={openRestore}>
                Restore from backup
              </button>
              {account.provider !== 'demo' && (
                <p className="hint small dim count-notice">
                  {countConsent === 'yes'
                    ? 'This wallet is counted in the public usage number (a one-way hash and a masked address).'
                    : "This wallet isn't counted in the public usage number."}{' '}
                  <button className="btn-link-inline" onClick={() => chooseCount(countConsent === 'yes' ? 'no' : 'yes')}>
                    {countConsent === 'yes' ? "Don't count me" : 'Count me'}
                  </button>
                </p>
              )}
            </div>

            <button className="btn-secondary" onClick={requestDeviceId}>
              {deviceId ? `Device: ${deviceId.slice(0, 12)}…` : 'Enable device preferences'}
            </button>
          </section>
        )}
      </main>
  );

  const classicShell = (
    <>
      <HeroBackground />
      <header className={uiBeta ? 'topbar beta-shell' : 'topbar'}>
        <div className="logo small">📒</div>
        <h1>NimBooks</h1>
        {versionBadge}
        {mcpChip}
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
          title={demoMode ? 'Stake (read-only in demo mode)' : 'Stake'}
          aria-label="Stake"
          data-tour="stake"
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
          {/* Icons are inline SVG on purpose: icon fonts and unicode glyphs
              render as tofu in the WebViews this app runs inside. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="tab-label">Overview</span>
        </button>
        <button
          className={view === 'history' ? 'tab active' : 'tab'}
          aria-current={view === 'history' ? 'page' : undefined}
          onClick={() => setView('history')}
          data-tour="history-tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="tab-label">History</span>
        </button>
        <button
          className={view === 'receipts' ? 'tab active' : 'tab'}
          aria-current={view === 'receipts' ? 'page' : undefined}
          onClick={() => setView('receipts')}
          data-tour="receipts-tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
            <path d="M14 8H8" />
            <path d="M16 12H8" />
          </svg>
          <span className="tab-label">Receipts</span>
        </button>
        <button
          className={view === 'request' ? 'tab active' : 'tab'}
          aria-current={view === 'request' ? 'page' : undefined}
          onClick={() => setView('request')}
          data-tour="request-tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
          <span className="tab-label">Request</span>
        </button>
        <button
          className={view === 'export' ? 'tab active' : 'tab'}
          aria-current={view === 'export' ? 'page' : undefined}
          onClick={() => setView('export')}
          data-tour="export-tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          <span className="tab-label">Export</span>
        </button>
      </nav>

      {renderSections()}
    </>
  );

  const betaNode = (
    <Suspense fallback={classicShell}>
      <BetaShell {...betaShellProps}>
        {view === 'dashboard' && (
          <Suspense fallback={null}>
            <BetaOverview {...betaOverviewProps} />
          </Suspense>
        )}
        {renderSections()}
      </BetaShell>
    </Suspense>
  )

  return (
    <div className={betaShellOn ? 'app app--beta' : 'app'}>
      {(() => (betaShellOn ? betaNode : classicShell))()}

      {changelogModal}

      {calcOpen && calcUi}

      {extendedConfirmOpen && (
        <div className="modal-overlay" onClick={() => setExtendedConfirmOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Load older history"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Load older history</h2>
              <button className="btn-ghost" onClick={() => setExtendedConfirmOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            {extendedLoading ? (
              <p className="hint">
                Loading older history…
                {extendedProgress ? ` Loaded ${extendedProgress.fetched} transactions…` : ''}
              </p>
            ) : (
              <>
                <p className="hint">
                  NimBooks reads your latest 1000 transactions. Loading older history can take a
                  minute on very active wallets. Continue?
                </p>
                <div className="statement-controls">
                  <button className="btn-secondary" onClick={() => setExtendedConfirmOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={startExtendedHistory}>
                    Load
                  </button>
                </div>
                <p className="hint small">
                  Like the books?{' '}
                  <a href="https://hub.nimiq.com/#/staking" target="_blank" rel="noopener noreferrer">
                    Stake with ImpactZero
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {downloadLink && (
        <div className="modal-overlay" onClick={() => setDownloadLink(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="CSV download link"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Download link</h2>
              <button className="btn-ghost" onClick={() => setDownloadLink(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="hint">
              Nimiq Pay can't save files directly. This link holds this wallet's export: open
              it in any browser, on this phone or another device
              {downloadLink.length <= 1200 ? ' (or scan the QR)' : ''}, to download the CSV. No
              wallet needed.
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
                  setToast('Download link copied. Open it in any browser to save the file ✓')
                } catch {
                  setError('Could not copy the link. Select it above and copy manually.')
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
                This export is too long for a scannable QR code. Copy the link instead.
              </p>
            )}
            <p className="hint small">
              {downloadShortLink
                ? 'The CSV sits behind this link on the NimBooks server, never a third party. This download link expires in 48 hours.'
                : 'The link carries the CSV itself, compressed. Nothing is stored on a server.'}
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
            ref={dialogFocus}
            tabIndex={-1}
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
                  Your books are yours: take them out any time. Copy this and keep it somewhere
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
                      markBackedUp()
                      setBackupDue(false)
                      setToast('Backup copied. Paste it somewhere safe ✓')
                    } catch {
                      setError('Could not copy. Select the text above and copy it manually.')
                    }
                  }}
                >
                  Copy backup
                </button>
                <p className="hint small">
                  Receipts, payment requests, the staking log and your preferences. Prices and
                  transaction history are left out, and come back from the chain on their own. Your
                  cashlinks travel too, keys included, so keep this text as safe as you keep your
                  wallet.
                </p>
              </>
            ) : (
              <>
                <p className="hint">
                  Paste a backup below. Anything already on this device is kept as-is: a restore
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
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Display currency</h2>
              <button className="btn-ghost" onClick={() => setCurrencyOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <input
              className="currency-search"
              type="search"
              placeholder="Search by code or name"
              aria-label="Search display currencies"
              value={currencyQuery}
              onChange={(e) => setCurrencyQuery(e.target.value)}
            />
            <div className="currency-scroll">
              {currencyMatches ? (
                <div className="currency-grid" role="radiogroup" aria-label="Search results">
                  {currencyMatches.map(currencyTile)}
                </div>
              ) : (
                <>
                  <h3 className="currency-section">Popular</h3>
                  <div className="currency-grid" role="radiogroup" aria-label="Popular currencies">
                    {POPULAR_CURRENCIES.map(currencyTile)}
                  </div>
                  <h3 className="currency-section">All currencies</h3>
                  <div className="currency-grid" role="radiogroup" aria-label="All currencies">
                    {OTHER_CURRENCIES.map(currencyTile)}
                  </div>
                </>
              )}
              {currencyMatches && currencyMatches.length === 0 && (
                <p className="hint small">No currency matches "{currencyQuery.trim()}".</p>
              )}
            </div>
            <p className="hint small">
              Display only: CSV exports and the tax-year statement stay in USD. Exchange rates:
              Nimiq, currency-api and ExchangeRate-API.
            </p>
          </div>
        </div>
      )}

      {stakeOpen && (
        <div className="modal-overlay" onClick={closeStake}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Stake NIM"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Only ever set for a stake confirmed on chain, and only while the
                panel is on screen to receive it. Keyed by hash so each stake
                gets its own pieces. Pointer-events: none, so Done stays
                tappable through it. */}
            {stakeCelebrate && <Confetti key={stakeCelebrate} />}
            <div className="modal-head">
              <h2>
                Stake NIM
                <InfoIcon text="Unstaking takes 3 transactions: deactivate, retire, then withdraw. The official wallet schedules the last two automatically with a watchtower; NimBooks has no watchtower, so you confirm each step yourself in Nimiq Pay. The balance banner guides you through." />
              </h2>
              <button className="btn-ghost" onClick={closeStake} aria-label="Close">
                ✕
              </button>
            </div>

            {stakeLinkNotice && (
              <p className="stake-link-banner" role="status">
                {stakeLinkNotice}
              </p>
            )}

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

            {/* Two exceptions to the "not in Pay, nothing to show here" rule.
                Demo mode shows the whole panel read-only (the real validators,
                yields and numbers — every signing button disabled, same as the
                send sheet). A Hub session gets it for real: since the Hub
                signing path shipped, browser sessions can stake, so the gate
                below only remains for a session that can do neither. */}
            {!inNimiqPay && !demoMode && !hubSession ? (
              <>
                <p className="hint">
                  Staking is signed by your wallet: sign in with the Nimiq Hub to delegate from
                  this browser, or open NimBooks inside the Nimiq Pay app.
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
            ) : stakeFlow === 'confirming' && stakeSubmitted ? (
              // Beat one. The form is gone on purpose: nothing here is editable
              // while a signed transaction settles, and the wait deserves a
              // state of its own rather than a line under a live slider.
              <div className="stake-progress" role="status" aria-live="polite">
                <p className="stake-progress-head">
                  <span className="stake-spinner" aria-hidden="true" />
                  Confirming on chain…
                </p>
                <div className="invoice-confirm">
                  <div className="row">
                    <span>Amount</span>
                    <span>{stakeSubmitted.amountNim.toLocaleString(lang)} NIM</span>
                  </div>
                  <div className="row">
                    <span>Validator</span>
                    <span>{stakeSubmitted.validator}</span>
                  </div>
                </div>
                <p className="hint small">
                  Transaction{' '}
                  <a
                    className="tx-hash-link"
                    href={explorerTxUrl(stakeSubmitted.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {stakeSubmitted.hash.slice(0, 16)}…
                  </a>
                </p>
                <p className="hint small">
                  Nimiq mines in about a second, so this is usually over before you read it. You can
                  close the panel: the stake is already on its way and it lands in your History
                  either way.
                </p>
              </div>
            ) : stakeFlow === 'done' && stakeSubmitted ? (
              // Beat two. Confirmed reads as a win; 'unknown' means the node
              // never answered, so the same card stays subdued and says so
              // rather than claiming a stake that may not exist.
              <div
                role="status"
                aria-live="polite"
                className={
                  stakeVerify === 'confirmed' ? 'invoice-sent stake-done' : 'stake-done unconfirmed'
                }
              >
                {stakeVerify === 'confirmed' ? (
                  <p className="ok">✓ Stake confirmed</p>
                ) : (
                  <p className="stake-done-title">Stake submitted</p>
                )}
                <div className="invoice-confirm">
                  <div className="row">
                    <span>Amount</span>
                    <span>{stakeSubmitted.amountNim.toLocaleString(lang)} NIM</span>
                  </div>
                  <div className="row">
                    <span>Validator</span>
                    <span>{stakeSubmitted.validator}</span>
                  </div>
                </div>
                <p className="hint small">
                  Transaction{' '}
                  <a
                    className="tx-hash-link"
                    href={explorerTxUrl(stakeSubmitted.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {stakeSubmitted.hash.slice(0, 16)}…
                  </a>{' '}
                  {stakeVerify === 'confirmed'
                    ? '· it is in your History, and your stake above updates as the node reports it.'
                    : '· it was submitted, but we could not confirm it on chain. Check History in a moment.'}
                </p>
                {/* Done is also the way back: the balance and the banner on
                    Overview are where the rest of this story is told. */}
                <button className="btn-primary stake-submit" onClick={finishStake}>
                  Done
                </button>
              </div>
            ) : panelUnstakeFlow !== 'form' ? (
              // The unstake started in this panel finishes in it, on the same
              // two beats and in place of the same form.
              unstakeBeats(finishStake)
            ) : (
              <>
                {/* Read-only up front, before the fields invite entry - the
                    same rule as the send sheet (a visitor on the sample
                    wallet reported a dark Stake button with the reason
                    hidden below a long validator list). */}
                {demoMode && (
                  <p className="demo-banner">
                    Demo preview: staking is disabled. Connect your own wallet to stake: Hub
                    sign-in works in this browser, or open NimBooks in Nimiq Pay.
                  </p>
                )}
                <span className="label stake-section">Validator</span>
                {hasStaker && (
                  <p className="hint small">
                    Your stake is already delegated, and adding to it keeps the same validator.
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
                      const isPinned = isPinnedValidator(v.address)
                      const isInactive = v.reliability === null && !isPinned
                      return (
                        <button
                          key={addr}
                          type="button"
                          role="radio"
                          aria-checked={activeSelection === addr}
                          disabled={hasStaker || isInactive}
                          onClick={() => setSelectedValidator(addr)}
                          className={[
                            'option-row',
                            activeSelection === addr ? 'selected' : '',
                            isInactive ? 'inactive' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className="option-dot" aria-hidden="true" />
                          {/* Logos ride along on the payload we already paid
                              for; cached lists carry small baked thumbnails,
                              so icons render instantly and offline. A monogram
                              chip is only a last resort. */}
                          {v.logo || v.logoSmall ? (
                            <img
                              className="validator-logo"
                              src={v.logo || v.logoSmall}
                              alt=""
                              aria-hidden="true"
                              width={28}
                              height={28}
                              loading="lazy"
                              style={v.accentColor ? { background: v.accentColor } : undefined}
                            />
                          ) : (
                            <span
                              className="validator-logo validator-logo-fallback"
                              aria-hidden="true"
                              style={{ background: v.accentColor || 'var(--card-2)' }}
                            >
                              {(v.name.trim()[0] || 'V').toUpperCase()}
                            </span>
                          )}
                          <span className="option-main">
                            <strong>{v.name}</strong>
                            <span className="option-meta">
                              {reward ? reward : 'yield n/a'}
                              {fee ? ` · fee ${fee}` : ''}
                              {reliability ? ` · reliability ${reliability}` : ''}
                            </span>
                            {isPinned && (
                              <span className="badge builder" title="Run by the developer of NimBooks">
                                Builder's pool
                              </span>
                            )}
                            {v.reliability === null && (
                              <span className="badge inactive">
                                {isPinned ? 'new pool · score pending' : 'inactive: not producing rewards'}
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
                        min={!hasStaker && !stakeLinkStakerUnknown && stakeMaxNim >= MIN_STAKE_NIM ? MIN_STAKE_NIM : 0}
                        max={stakeMaxNim}
                        step={0.1}
                        value={Math.min(stakeAmountNim, stakeMaxNim)}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        aria-label="Stake amount"
                      />
                      <span className="stake-slider-value">
                        <SliderAmountField
                          id="stakeAmountValue"
                          ariaLabel="Stake amount, type to edit"
                          value={stakeAmount}
                          lang={lang}
                          onCommit={(raw) =>
                            setStakeAmount(commitTypedAmount(raw, stakeMaxLuna, stakeAmount))
                          }
                        />{' '}
                        NIM
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
                        ? hasRate(shown.nim)
                          ? `≈ ${formatFiat(stakeAmountNim * shown.nim, currency)} · ${Math.round(
                              stakeAmountNim * 100000
                            ).toLocaleString(lang)} Luna`
                          : // Unknown price: the fiat approximation hides; the
                            // Luna total still tells the amount, and no $0.00
                            // may appear in its place.
                            `${Math.round(stakeAmountNim * 100000).toLocaleString(lang)} Luna · price unavailable`
                        : !hasStaker && stakeMaxNim < MIN_STAKE_NIM
                          ? `${MIN_STAKE_COPY} This wallet holds ${formatLuna(String(stakeMaxLuna), lang)} NIM.`
                          : // A typed amount can land under the first-stake
                            // minimum, which the slider's floor made
                            // unreachable. Say why the button is dark rather
                            // than leaving it dark without a reason — the same
                            // sentence submitStake would have given.
                            !hasStaker && stakeAmountNim > 0 && stakeAmountNim < MIN_STAKE_NIM
                            ? MIN_STAKE_COPY
                            : `Available to stake: ${formatLuna(String(stakeMaxLuna), lang)} NIM`}
                    </span>
                  </>
                ) : (
                  <div className="stake-empty">
                    <p className="hint small">
                      {hasStaker
                        ? `Your ${formatLuna(String(retireableLuna), lang)} NIM is already staked. Staked NIM can't be re-staked. To stake more, send NIM to this address first:`
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

                {/* The same four terms the Earn card shows, for the pool this
                    stake would go to. Rendered in demo mode too: the panel is
                    read-only there, not information-free. */}
                <div className="stake-terms">
                  <span className="label">Before you stake</span>
                  <dl className="earn-terms">
                    <div>
                      <dt>How it works</dt>
                      <dd>{panelTerms.howItWorks}</dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>{panelTerms.rate}</dd>
                    </div>
                    <div>
                      <dt>What can go wrong</dt>
                      <dd>{panelTerms.risk}</dd>
                    </div>
                    <div>
                      <dt>Getting out</dt>
                      <dd>{panelTerms.exit}</dd>
                    </div>
                  </dl>
                </div>

                {/* A submitted stake is no longer reported here: it takes over
                    the panel with a confirming step and then a confirmed card,
                    the way the send sheet finishes. The form only ever sees a
                    failure — an error it can explain and let the user retry. */}
                {stakeError && <p className="hint small warn">{stakeError}</p>}

                <button
                  className="btn-primary stake-submit"
                  onClick={submitStake}
                  disabled={
                    !canStake() ||
                    staking ||
                    !stakeAmountValid ||
                    !validatorChosen ||
                    (hubSession && !hubStakeReady)
                  }
                >
                  {staking
                    ? hubSession
                      ? 'Confirm in the Nimiq Hub…'
                      : 'Confirm in your wallet…'
                    : hasStaker
                      ? 'Add to stake'
                      : 'Stake'}
                </button>
                {stakeBlockedReason && (
                  // A dark button always says why. Demo is told by the banner
                  // up top; the rest are said here, at the button the user is
                  // looking at, rather than left for them to guess.
                  <p className="hint small stake-blocked-reason" role="status">
                    {stakeBlockedReason}
                  </p>
                )}
                {hasStaker && (
                  <>
                    <button
                      className="btn-ghost unstake-toggle"
                      onClick={() => setUnstakeOpen((v) => !v)}
                      disabled={!canStake() || staking || unstaking || (hubSession && !hubStakeReady)}
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
                            <SliderAmountField
                              id="unstakeAmountValue"
                              ariaLabel="Unstake amount, type to edit"
                              value={unstakeAmount}
                              lang={lang}
                              onCommit={(raw) =>
                                setUnstakeAmount(
                                  commitTypedAmount(raw, maxUnstakeableLuna, unstakeAmount)
                                )
                              }
                            />{' '}
                            NIM
                            {unstakeMaxNim > 0 && (
                              <span className="stake-pct">
                                {' '}
                                ({Math.round((Number(unstakeAmount) / unstakeMaxNim) * 100)}%)
                              </span>
                            )}
                          </span>
                        </div>
                        {/* A partial unstake that would shrink the active
                            stake under the 100 NIM minimum explains itself
                            here, before anything is sent - not only in the
                            receipt afterwards. Numbers come from the same
                            plan helper the submit handler uses. */}
                        {unstakePreviewActive && (
                          <>
                            <p className="hint small warn unstake-snap-hint">
                              {unstakePreview.snapped
                                ? `Nimiq needs at least ${MIN_STAKE_NIM} NIM to stay staked. This would leave ${formatLuna(String(unstakeActiveAfter), lang)} NIM, so NimBooks will unstake ${formatLuna(String(unstakePreview.deactivateLuna), lang)} NIM and keep 100 NIM staked.`
                                : `Nimiq needs at least ${MIN_STAKE_NIM} NIM to stay staked, and your active stake is ${formatLuna(String(retireableLuna), lang)} NIM. Only a full unstake is possible here.`}
                            </p>
                            {unstakeMaxNim > 0 && (
                              <button
                                type="button"
                                className="btn-secondary unstake-fill-full"
                                onClick={() => setUnstakeAmount(String(unstakeMaxNim))}
                              >
                                Unstake all {formatLuna(String(maxUnstakeableLuna), lang)} NIM
                              </button>
                            )}
                          </>
                        )}
                        <span className="hint small">
                          {inactiveLuna > 0
                            ? `${formatLuna(String(inactiveLuna), lang)} NIM cooling down. Finish it from the balance banner after the reporting window.`
                            : 'Unstake deactivates active stake into a cooldown; after the reporting window you retire it, then withdraw it.'}
                          {retiredLuna > 0 &&
                            ` ${formatLuna(String(retiredLuna), lang)} NIM already withdrawable.`}
                        </span>
                        {/* A submitted unstake is no longer reported here: it
                            takes over the panel with a confirming step and then
                            a summary card, the way a stake and a payment
                            finish. The box only ever sees a failure. */}
                        {unstakeError && <p className="hint small warn">{unstakeError}</p>}
                        <button
                          className="btn-primary stake-submit"
                          onClick={() => setConfirmUnstakeOpen(true)}
                          disabled={
                            !canStake() || unstaking || !(Number(unstakeAmount) > 0) ||
                            (hubSession && !hubStakeReady)
                          }
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
                              ref={dialogFocus}
                              tabIndex={-1}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <h3 className="confirm-title">Confirm unstake</h3>
                              <p className="confirm-amount">
                                {Number(unstakeAmount).toLocaleString(lang)} NIM
                              </p>
                              <p className="hint small">
                                Your stake stops earning at the next election block (~12h). It
                                becomes withdrawable after the reporting window, by{' '}
                                <strong>{unstakeEstimate.worstLabel}</strong> at the latest
                                (up to ~24h, depending on where the epoch boundary falls, and
                                longer if your validator is jailed).
                              </p>
                              <p className="hint small">
                                You'll need two more transactions once it has cooled down.
                                Both are one tap from the balance banner.
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
                                  disabled={unstaking}
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
                <p className="hint small">
                  Nimiq requires your stake to cool down for a full epoch before re-delegating, so
                  switching validator means unstake → stake again. NimBooks does both.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* The balance banner's two finishing steps are sent straight from
          Overview, with no panel to report back into — so they get a window of
          their own, carrying exactly the beats the stake panel shows. It stands
          only as long as there is something to show: an expired transaction
          drops the flow back to 'form', which takes the modal with it and
          leaves the error to the toast. */}
      {unstakeModalShown && unstakeSubmitted && (
        <div className="modal-overlay" onClick={closeUnstakeModal}>
          <div
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label={UNSTAKE_LEG[unstakeSubmitted.legs[0].kind].window}
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{UNSTAKE_LEG[unstakeSubmitted.legs[0].kind].window}</h2>
              <button className="btn-ghost" onClick={closeUnstakeModal} aria-label="Close">
                ✕
              </button>
            </div>
            {unstakeBeats(finishUnstakeModal)}
          </div>
        </div>
      )}

      {/* Send sheet — the same adapter path the invoice page pays through, so
          there is one signing flow in the app, not two. */}
      {sendOpen && (
        <div className="modal-overlay" onClick={closeSend}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Send NIM"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Only ever set for a payment confirmed on chain, and never in
                demo mode — which cannot sign in the first place. Keyed by hash
                so each payment gets its own pieces. Pointer-events: none, so
                Done stays tappable through it. */}
            {sendCelebrate && !demoMode && <Confetti key={sendCelebrate} />}
            <div className="modal-head">
              <h2>Send NIM</h2>
              {/* Closeable except while the wallet is asking for a signature —
                  see closeSend. */}
              <button
                className="btn-ghost"
                onClick={closeSend}
                aria-label="Close"
                disabled={sendState === 'sending'}
              >
                ✕
              </button>
            </div>

            {/* Demo mode can fill the form but never sign it - say so up
                front, before the fields invite entry (tester feedback:
                the read-only notice sat below the disabled button). */}
            {demoMode && sendState !== 'sent' && (
              <p className="demo-banner">Demo preview: sending is disabled.</p>
            )}

            {sendState === 'sent' ? (
              <div className="invoice-sent">
                <p className="ok">✓ Payment sent</p>
                <div className="invoice-confirm">
                  <div className="row">
                    <span>Amount</span>
                    <span>{sendLuna ? formatLuna(sendLuna, lang) : sendAmount} NIM</span>
                  </div>
                  <div className="row">
                    <span>To</span>
                    <span className="mono">{sendToClean.slice(0, 14)}…</span>
                  </div>
                </div>
                {sendHash ? (
                  <p className="hint small">
                    Transaction{' '}
                    <a
                      className="tx-hash-link"
                      href={explorerTxUrl(sendHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {sendHash.slice(0, 16)}…
                    </a>{' '}
                    · it is in your History, where you can sign a receipt for it.
                  </p>
                ) : (
                  <p className="hint small">
                    The transaction was submitted. It appears in History within a few seconds —
                    sign a receipt for it from there.
                  </p>
                )}
                <button className="btn-primary send-submit" onClick={closeSend}>
                  Done
                </button>
              </div>
            ) : (
              <div className="send-form">
                <label className="label" htmlFor="sendTo">
                  Recipient address
                </label>
                <input
                  id="sendTo"
                  className="input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="NQ…"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                />
                {sendToValid && (
                  <div className="send-recipient-preview">
                    <Iqon address={sendToClean} size={24} />
                    <span className="send-recipient-text mono">{sendToClean}</span>
                  </div>
                )}
                {sendTo.trim() !== '' && !sendToValid && (
                  <span className="hint small warn">
                    That isn't a valid Nimiq address. It starts with NQ and has 36 characters —
                    paste it rather than typing it.
                  </span>
                )}
                {sendToSelf && (
                  <span className="hint small">
                    This is your own address: the payment would come straight back.
                  </span>
                )}

                <label className="label" htmlFor="sendAmount">
                  Amount (NIM)
                </label>
                <input
                  id="sendAmount"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                />
                {sendAmount.trim() !== '' && !sendLuna ? (
                  <span className="hint small warn">
                    Enter a positive amount with at most 5 decimals (max 2,000,000,000 NIM).
                  </span>
                ) : sendAmountOverBalance ? (
                  <span className="hint small warn">
                    More than this wallet can send. Available:{' '}
                    {formatLuna(String(sendMaxLuna), lang)} NIM.
                  </span>
                ) : (
                  <span className="hint small">
                    {sendLuna
                      ? hasRate(shown.nim)
                        ? `≈ ${formatFiat((Number(sendLuna) / 100000) * shown.nim, currency)} · available ${formatLuna(String(sendMaxLuna), lang)} NIM`
                        : // Unknown price: no fiat approximation is invented.
                          `Available to send: ${formatLuna(String(sendMaxLuna), lang)} NIM`
                      : `Available to send: ${formatLuna(String(sendMaxLuna), lang)} NIM`}
                  </span>
                )}

                <label className="label" htmlFor="sendNote">
                  Note (optional)
                </label>
                <input
                  id="sendNote"
                  className="input"
                  type="text"
                  autoComplete="off"
                  placeholder="Invoice #42"
                  value={sendMemo}
                  onChange={(e) => setSendMemo(e.target.value)}
                />
                <span
                  className={sendMemoBytes > MAX_TX_MEMO_BYTES ? 'hint small warn' : 'hint small'}
                >
                  {sendMemoBytes}/{MAX_TX_MEMO_BYTES} bytes · rides on-chain with the payment, so
                  it is public and permanent.
                </span>

                <div className="invoice-confirm">
                  <div className="row">
                    <span>From</span>
                    <span className="mono">
                      {account.nimiqAddress
                        ? `${cleanAddr(account.nimiqAddress).slice(0, 14)}…`
                        : '—'}
                    </span>
                  </div>
                  <div className="row">
                    <span>Network fee</span>
                    <span>0 NIM</span>
                  </div>
                </div>

                {sendError && <p className="hint small warn">{sendError}</p>}

                {demoMode || !canSend() ? (
                  <>
                    {/* Read-only: the button stays on screen so the flow is
                        visible, but nothing here can sign — and nothing is
                        faked. wallet.sendNim refuses demo mode outright. A
                        restored Pay session the host did not answer on this
                        load is not read-only by choice: offer the connect
                        that wakes it. */}
                    {!demoMode && (isInNimiqPay() || isNimiqPayUserAgent()) ? (
                      <button
                        className="btn-primary send-submit"
                        onClick={() => void connect()}
                        disabled={connecting}
                      >
                        {connecting ? 'Connecting…' : 'Connect wallet to send'}
                      </button>
                    ) : (
                      <button className="btn-primary send-submit" disabled>
                        Send NIM
                      </button>
                    )}
                    <p className="hint small">
                      {demoMode
                        ? 'Demo mode is read-only. Connect your wallet to send NIM.'
                        : inNimiqPay
                          ? 'The wallet did not answer on this load. Connect again to send.'
                          : 'Sending needs a wallet that can sign. Open NimBooks in Nimiq Pay, or sign in with the Nimiq Hub.'}
                    </p>
                    {!demoMode && !inNimiqPay && (
                      <a
                        className="btn-primary btn-link"
                        href={NIMIQ_PAY_APP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Nimiq Pay →
                      </a>
                    )}
                  </>
                ) : sendState === 'unconfirmed' ? (
                  // Pay could not confirm the submit, so the form is gone —
                  // only a lookup card and Close. No button can fire a second
                  // send, and the amount/to rows mirror the sent card so the
                  // user can still check what they signed.
                  <div className="invoice-sent">
                    <p className="warn">
                      {sendUnconfirmedChecked ? 'Not on the chain yet' : 'Checking the chain…'}
                    </p>
                    <div className="invoice-confirm">
                      <div className="row">
                        <span>Amount</span>
                        <span>{sendLuna ? formatLuna(sendLuna, lang) : sendAmount} NIM</span>
                      </div>
                      <div className="row">
                        <span>To</span>
                        <span className="mono">{sendToClean.slice(0, 14)}…</span>
                      </div>
                    </div>
                    <p className="hint small">
                      {sendUnconfirmedChecked
                        ? 'It can still land for up to 2 hours. Check History before you send it again.'
                        : 'Nimiq Pay could not confirm this payment, so NimBooks is looking for it on the chain. Do not send it again.'}
                    </p>
                    <button className="btn-secondary" onClick={closeSend}>
                      Close
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="btn-primary send-submit"
                      onClick={() => void submitSend()}
                      disabled={!sendReady || sendBusy}
                    >
                      {sendState === 'sending'
                        ? 'Confirm in your wallet…'
                        : sendState === 'locating'
                          ? 'Confirming on-chain…'
                          : sendLuna
                            ? `Send ${formatLuna(sendLuna, lang)} NIM`
                            : 'Send NIM'}
                    </button>
                    <p className="hint small">
                      {sendState === 'locating'
                        ? 'Sent — looking it up on chain for the explorer link. You can close this; the payment is already on its way.'
                        : 'Your wallet asks you to confirm before anything leaves this address. Payments are final once they are on-chain.'}
                    </p>
                  </>
                )}
                {canSend() && !(hubSession && isPhoneOrTablet()) && sendState === 'idle' && (
                  // Cashlinks work on both rails now: Nimiq Pay funds them with
                  // its usual approval, the Hub funds them with a checkout
                  // popup. Only Hub-on-a-phone stays out (the Hub would
                  // redirect, and a redirected click has nothing to return to).
                  <button className="btn-ghost-lg" onClick={openCashlink}>
                    Send a claimable link instead
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cashlink sheet — Hub sessions only: create a claimable link, then
          present it (QR, copy, share). Links this wallet made are shelved
          locally (cashlinkStore) so they can be re-copied or reopened in the
          Hub's manage UI after the sheet is closed. */}
      {cashlinkOpen && (
        <div className="modal-overlay" onClick={closeCashlink}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Send as a cashlink"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Send as a cashlink</h2>
              <button
                className="btn-ghost"
                onClick={closeCashlink}
                aria-label="Close"
                disabled={cashlinkBusy}
              >
                ✕
              </button>
            </div>

            {cashlinkResult ? (
              <div className="invoice-sent">
                <p className="ok">✓ Cashlink created</p>
                <div className="invoice-confirm">
                  <div className="row">
                    <span>Amount</span>
                    <span>{formatLuna(String(cashlinkResult.valueLuna), lang)} NIM</span>
                  </div>
                  <div className="row">
                    <span>Status</span>
                    <span>{cashlinkResult.status}</span>
                  </div>
                </div>
                <div className="invoice-qr">
                  <QrCode
                    value={cashlinkShareUrl(cashlinkResult.secret)}
                    size={200}
                    label="QR code of the cashlink"
                  />
                </div>
                <p className="mono receive-addr">{cashlinkShareUrl(cashlinkResult.secret)}</p>
                <p className="hint small">
                  Anyone with this link can claim the NIM — send it over chat or email, or show
                  the QR. If it never gets claimed, revert it and the funds come back.
                </p>
                <button
                  className="btn-primary send-submit"
                  onClick={() => copyCashlinkLink(cashlinkShareUrl(cashlinkResult.secret))}
                >
                  Copy link
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => void shareCashlink(cashlinkShareUrl(cashlinkResult.secret))}
                >
                  Share
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setCashlinkRevertTarget(cashlinkResult)}
                >
                  Revert to my wallet
                </button>
                {backupDue && (
                  <div className="backup-nudge">
                    <p className="hint small warn">
                      This link's key lives only on this device. Back up now so a reset of Nimiq
                      Pay can't strand the NIM.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        closeCashlink()
                        openBackup()
                      }}
                    >
                      Back up now
                    </button>
                  </div>
                )}
                {cashlinkError && <p className="hint small warn">{cashlinkError}</p>}
                <button className="btn-ghost-lg" onClick={closeCashlink}>
                  Done
                </button>
              </div>
            ) : (
              <div className="send-form">
                <p className="hint">
                  A cashlink is a shareable link with NIM inside it: no recipient address, and
                  whoever opens it claims the funds. Create it here and fund it from your wallet
                  in one confirmation — then send the link to whoever should claim it.
                </p>
                <label className="label" htmlFor="cashlinkAmount">
                  Amount (NIM)
                </label>
                <input
                  id="cashlinkAmount"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={cashlinkAmount}
                  onChange={(e) => setCashlinkAmount(e.target.value)}
                />
                {cashlinkAmount.trim() !== '' && !cashlinkLuna ? (
                  <span className="hint small warn">
                    Enter a positive amount with at most 5 decimals (max 2,000,000,000 NIM).
                  </span>
                ) : cashlinkAmountOverBalance ? (
                  <span className="hint small warn">
                    More than this wallet can send. Available:{' '}
                    {formatLuna(String(sendMaxLuna), lang)} NIM.
                  </span>
                ) : null}
                <label className="label" htmlFor="cashlinkMessage">
                  Message (optional)
                </label>
                <input
                  id="cashlinkMessage"
                  className="input"
                  type="text"
                  autoComplete="off"
                  placeholder="Thanks for the coffee!"
                  maxLength={200}
                  value={cashlinkMessage}
                  onChange={(e) => setCashlinkMessage(e.target.value)}
                />
                {cashlinkError && <p className="hint small warn">{cashlinkError}</p>}
                <button
                  className="btn-primary send-submit"
                  onClick={() => void submitCashlink()}
                  disabled={cashlinkBusy || !cashlinkSignerReady || !cashlinkAmountReady}
                >
                  {cashlinkBusy ? 'Confirm in your wallet…' : 'Create cashlink'}
                </button>
                {cashlinkSignerReady ? (
                  <>
                    <p className="hint small">
                      One wallet confirmation puts the NIM into the link. Anyone holding the link
                      can claim it — keep it private until you send it.
                    </p>
                    <p className="hint small warn">
                      The link's key is kept only on this device. Until it is claimed, the link
                      itself is the only way to claim or revert the NIM, so copy it or back up
                      before you sign out of Nimiq Pay or switch phones.
                    </p>
                  </>
                ) : (
                  <p className="hint small">Preparing the signing library…</p>
                )}

                {cashlinkHistory.length > 0 && (
                  <div className="card">
                    <span className="label">Recent links</span>
                    {cashlinkHistory.map((c) => {
                      // A link that is closed out has nothing left to move; one
                      // that might still hold NIM is reverted, never removed.
                      // 'Not funded yet' is the ambiguous middle: it offers
                      // both, so a shelf full of stuck rows can still be
                      // cleared, but Remove asks a harder question first.
                      const finished =
                        c.status === 'Claimed or reverted' || c.status === 'Reverted ✓'
                      const canRevert =
                        c.status === 'Funding…' ||
                        c.status === 'Not funded yet' ||
                        c.status === 'Ready to claim'
                      const canRemove = finished || c.status === 'Not funded yet'
                      return (
                        <div key={c.address} className="invoice-confirm">
                          <div className="row">
                            <span>{formatLuna(String(c.valueLuna), lang)} NIM</span>
                            <span>{c.status}</span>
                          </div>
                          <div className="row">
                            <button
                              className="btn-small"
                              onClick={() => copyCashlinkLink(cashlinkShareUrl(c.secret))}
                            >
                              Copy link
                            </button>
                            {canRevert && (
                              <button
                                className="btn-small"
                                onClick={() => setCashlinkRevertTarget(c)}
                              >
                                Revert
                              </button>
                            )}
                            {canRemove && (
                              <button
                                className="btn-small"
                                onClick={() => setCashlinkRemoveTarget(c)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {cashlinkRevertTarget && (
              <div className="confirm-overlay" onClick={() => setCashlinkRevertTarget(null)}>
                <div
                  className="confirm-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Confirm revert"
                  ref={dialogFocus}
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="confirm-title">Revert this cashlink?</h3>
                  <p className="confirm-amount">
                    {formatLuna(String(cashlinkRevertTarget.valueLuna), lang)} NIM
                  </p>
                  <p className="hint small">
                    The NIM returns to your wallet and the link stops working — anyone you already
                    sent it to will no longer be able to claim.
                  </p>
                  <div className="confirm-actions">
                    <button className="btn-ghost" onClick={() => setCashlinkRevertTarget(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => void confirmRevertCashlink()}
                      disabled={cashlinkRevertBusy}
                    >
                      {cashlinkRevertBusy ? 'Reverting…' : 'Revert'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {cashlinkRemoveTarget && (
              <div className="confirm-overlay" onClick={() => setCashlinkRemoveTarget(null)}>
                <div
                  className="confirm-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Confirm remove"
                  ref={dialogFocus}
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="confirm-title">Remove this link record?</h3>
                  <p className="confirm-amount">
                    {formatLuna(String(cashlinkRemoveTarget.valueLuna), lang)} NIM
                  </p>
                  <p className="hint small">
                    This deletes the link's saved key from this device. The key is kept nowhere
                    else, so the row cannot be brought back.
                  </p>
                  {cashlinkRemoveTarget.status === 'Not funded yet' ? (
                    <p className="hint small warn">
                      Only remove it if you are sure it holds no NIM. If it was funded and not yet
                      claimed, this device loses the only key that could claim or revert it.
                    </p>
                  ) : (
                    <p className="hint small">It looks finished, so this is just tidying up.</p>
                  )}
                  <div className="confirm-actions">
                    <button className="btn-ghost" onClick={() => setCashlinkRemoveTarget(null)}>
                      Cancel
                    </button>
                    <button className="btn-primary" onClick={confirmRemoveCashlink}>
                      {cashlinkRemoveTarget.status === 'Not funded yet'
                        ? 'Remove anyway'
                        : 'Remove'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Receive sheet — address and QR only. Creating a payment request (an
          amount, a reference, reconciliation) stays in the Request tab. */}
      {receiveOpen && (
        <div className="modal-overlay" onClick={() => setReceiveOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Receive NIM"
            ref={dialogFocus}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Receive NIM</h2>
              <button
                className="btn-ghost"
                onClick={() => setReceiveOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {account.nimiqAddress ? (
              <>
                <p className="hint small">
                  Scan the code or share the address. Anything that arrives shows up in your books
                  automatically — no import step.
                </p>
                <div className="invoice-qr">
                  {/* Plain address, no URI scheme: every wallet scanner reads
                      it, and a generic camera app shows something readable. */}
                  <QrCode
                    value={cleanAddr(account.nimiqAddress)}
                    size={180}
                    label="QR code of your Nimiq address"
                  />
                </div>
                <p className="mono receive-addr">{account.nimiqAddress}</p>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const addr = account.nimiqAddress
                    if (!addr) return
                    if (await copyText(addr, 'NIM address copied!')) setAddrCopied(true)
                  }}
                >
                  {addrCopied ? 'Address copied ✓' : 'Copy address'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setReceiveOpen(false)
                    setView('request')
                  }}
                >
                  Ask for a specific amount
                </button>
                <p className="hint small">
                  A payment request adds an amount and a reference, and marks itself paid when the
                  transaction lands.
                </p>
                {demoMode && (
                  <p className="hint small">
                    Demo mode: this is the public sample wallet, shown read-only.
                  </p>
                )}
              </>
            ) : (
              <p className="hint">
                This connection has no Nimiq address. Open NimBooks inside Nimiq Pay, or sign in
                with the Nimiq Hub, and your receiving address appears here.
              </p>
            )}
          </div>
        </div>
      )}
      <TourHost
        tour={tour}
        onStart={tourStart}
        onNext={tourNext}
        onSkip={tourSkip}
        onDismiss={tourDismiss}
        onNavigate={setView}
      />
    </div>
  )
}

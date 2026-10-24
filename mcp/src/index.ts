// nimbooks-mcp — a fenced, local MCP server for your Nimiq books.
//
// What it does: reads the public chain for an address you name, aggregates it
// the way the NimBooks app does, and drafts payment-request links.
//
// What it cannot do, by construction:
//   - sign anything. There is no key handling in this package at all: nothing
//     generates, stores, reads or asks for a private key, a seed or a
//     passphrase. `create_payment_request` returns a link; only a wallet, with
//     its owner's approval, can move money.
//   - phone home. The only hosts this process contacts are the public Nimiq
//     RPC (rpc.nimiqwatch.com), the public Nimiq Watch analytics API
//     (v2.nimiqwatch.com — for staking rewards, the same second API the
//     NimBooks app reads), the validator list the app reads for its stake
//     panel (validators-api-main.je-cf9.workers.dev: names, fees,
//     reliability) and CoinGecko's public price API. There is no
//     NimBooks server — the app has none either — and this server never calls
//     nimbooks.subimpact.net. Links it mints contain that address the way a
//     printed invoice carries a street address: it is data, not a request.
//   - change anything. Every tool is a read or a pure function. Nothing is
//     marked paid, nothing is sent, no file is written.
//
// stdout is the MCP protocol stream. Every log line goes to stderr.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import {
  ToolError,
  decodeMemo,
  explorerTxUrl,
  getBalance,
  getBlockHeight,
  getStaking,
  getTransactionHistory,
  memoForRow,
  normalizeAddress,
  spacedAddress,
  txLabel,
  getRestakeRewardTxsReport,
  getValidatorsSnapshot,
  isValidNimiqAddress,
  REWARDS_FLOOR_DAY,
  type NimiqTx,
  type StakingHolding,
} from './chain.ts'
import {
  encodeInvoice,
  formatLunaExact,
  invoiceMemo,
  invoiceUrl,
  newInvoiceId,
  parseInvoiceMemo,
  parseNimToLuna,
  MAX_MEMO_CHARS,
  type InvoicePayload,
} from './invoice.ts'
import { listBackupInvoices, readBackupFile, type BackupFile } from './backup.ts'
import {
  buildStakeLink,
  parseStakeLink,
  STAKE_AMOUNT_WARNING,
  STAKE_VALIDATOR_WARNING,
} from './stakeLink.ts'
import { computeStatement, getDailyCloses, periodBounds, priceCoverageNote } from './statement.ts'
import {
  BLOCKS_PER_EPOCH,
  MIN_STAKE_NIM,
  MIN_STAKE_NOTE,
  chooseCompound,
  chooseRate,
  compoundsFor,
  isBuildersPool,
  matchValidator,
  projectStake,
  rewardsByValidator,
  trailingYield,
  typicalRate,
  type ValidatorInfo,
} from './staking.ts'

const VERSION = '1.2.1'

// How far back a tool will walk the transaction index. The RPC pages 50 at a
// time and is rate-limited, so these are budgets, not guesses — every tool
// that hits one says so in its answer rather than quietly truncating.
const HISTORY_CAP = 1000
const INVOICE_SCAN_CAP = 200

const NEVER_SIGNED =
  'Nothing was signed. This is a request, not a payment: only the payer’s ' +
  'wallet can move money, and only when its owner approves.'

// --- CLI ---

interface Options {
  backupPath: string | null
  defaultAddress: string | null
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { backupPath: null, defaultAddress: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--backup') opts.backupPath = argv[++i] ? resolve(argv[i]) : null
    else if (arg.startsWith('--backup=')) opts.backupPath = resolve(arg.slice('--backup='.length))
    else if (arg === '--address') opts.defaultAddress = argv[++i] ?? null
    else if (arg.startsWith('--address=')) opts.defaultAddress = arg.slice('--address='.length)
    else if (arg === '--version') {
      process.stdout.write(`nimbooks-mcp ${VERSION}\n`)
      process.exit(0)
    } else if (arg === '--help') {
      process.stdout.write(
        `nimbooks-mcp ${VERSION} — read-only MCP server for Nimiq books\n\n` +
          `  --backup <path>    a NimBooks backup JSON (enables list_invoices)\n` +
          `  --address <NQ…>    default address for tools that take one\n\n` +
          `Reads the public Nimiq chain and CoinGecko. Never signs, never sends.\n`
      )
      process.exit(0)
    }
  }
  return opts
}

const options = parseArgs(process.argv.slice(2))

// The restake-rewards fetch (v2.nimiqwatch.com) is additive and failure-
// tolerant by design, but the offline test suite must stay offline: the test
// script sets this so statement/summary tests never reach the second host.
const REWARDS_DISABLED = process.env.NIMBOOKS_MCP_NO_REWARDS === '1'

function log(msg: string): void {
  // stdout is the protocol. Diagnostics go to stderr, always.
  process.stderr.write(`[nimbooks-mcp] ${msg}\n`)
}

// A configured default is validated here, before anything is said about it: the
// server instructions name the address so the assistant can answer "how are my
// books looking?" without asking for one, and naming an address the tools would
// then reject is worse than naming none.
let defaultAddressSpaced: string | null = null
if (options.defaultAddress) {
  try {
    defaultAddressSpaced = spacedAddress(normalizeAddress(options.defaultAddress))
  } catch {
    log(`WARNING: --address ${options.defaultAddress} is not a valid Nimiq address; tools will ask for one.`)
    options.defaultAddress = null
  }
}

const DEFAULTS_TO_CONFIGURED = 'Optional; defaults to the server’s configured address.'

// The backup is read once at first use and kept in memory: re-reading it per
// call would make `list_invoices` disagree with itself mid-conversation.
let backupCache: BackupFile | null = null
function backup(): BackupFile {
  if (!options.backupPath) {
    throw new ToolError(
      'No backup file is configured, so there are no locally stored payment ' +
        'requests to list. Export one from NimBooks: Backup → Copy, save the ' +
        'clipboard to a file (e.g. ~/nimbooks-backup.json), then start this ' +
        'server with --backup /path/to/nimbooks-backup.json. ' +
        'Requests that were already paid on chain can be found without a ' +
        'backup using check_request_paid.'
    )
  }
  if (!backupCache) backupCache = readBackupFile(options.backupPath, (p) => readFileSync(p, 'utf8'))
  return backupCache
}

// --- Shared helpers ---

function addressArg(input: string | undefined): string {
  const raw = input ?? options.defaultAddress
  if (!raw) {
    throw new ToolError(
      'No address given, and no default is configured. Pass one (e.g. ' +
        '"NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX"), or start the server ' +
        'with --address <NQ…>.'
    )
  }
  return normalizeAddress(raw)
}

/** `since`/`until` as a date or full timestamp, read as UTC. */
function parseWhen(value: string | undefined, what: string, endOfDay: boolean): number | null {
  if (value === undefined) return null
  const raw = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ms = Date.parse(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    if (Number.isFinite(ms)) return ms
  }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) {
    throw new ToolError(`"${value}" is not a date I can read for ${what}. Use YYYY-MM-DD or an ISO 8601 timestamp.`)
  }
  return ms
}

function inWindow(tx: NimiqTx, since: number | null, until: number | null): boolean {
  const ts = tx.timestamp
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return since === null && until === null
  if (since !== null && ts < since) return false
  if (until !== null && ts > until) return false
  return true
}

function iso(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

/**
 * The rewards caveats the app shows: a year Nimiq Watch did not answer means
 * the total may be short (never silently zero), and any window reaching back
 * before 2025 carries the app's own note that the public rewards data starts
 * in January 2025.
 */
function rewardNotes(failedYears: number[], askedFromMs: number): string | undefined {
  const notes: string[] = []
  if (failedYears.length > 0) {
    notes.push(`The staking rewards total may be short: Nimiq Watch did not answer for ${failedYears.join(', ')}.`)
  }
  if (askedFromMs < Date.parse('2025-01-01T00:00:00Z')) {
    notes.push('Staking rewards before January 2025 may be missing: the public rewards data NimBooks reads starts then.')
  }
  return notes.length > 0 ? notes.join(' ') : undefined
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

/**
 * Every tool body runs inside this. A bad address, an unreachable RPC, a
 * missing backup — all of them come back as a tool result the assistant can
 * read out and act on. None of them takes the server down: a crashed stdio
 * server looks to the client like the whole integration is broken.
 */
async function guard(name: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ToolError) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
    const msg = e instanceof Error ? e.message : String(e)
    log(`${name} failed: ${msg}`)
    return {
      content: [
        {
          type: 'text',
          text:
            `${name} could not complete: ${msg}. Nothing was changed — every tool ` +
            `in this server only reads. Try again in a moment.`,
        },
      ],
      isError: true,
    }
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const

// --- Server ---

const BASE_INSTRUCTIONS =
  'Read-only access to a Nimiq address\'s books, plus drafting of payment ' +
  'requests and stake links. This server never signs and never sends: ' +
  'create_payment_request and draft_stake produce shareable links and nothing ' +
  'more. It reads the public Nimiq chain and CoinGecko prices; it has no ' +
  'account, no keys and no server of its own. Amounts are reported in both ' +
  'Luna (integer, exact) and NIM. It also reads staking positions ' +
  '(get_staking), the validator pools (list_validators), projects staking ' +
  'yield (project_yield), sums staking rewards (get_rewards) and drafts stake ' +
  'links (draft_stake) that open the app\'s stake panel pre-filled; its yield ' +
  'figures are projections, never promises.'

const server = new McpServer(
  { name: 'nimbooks-mcp', version: VERSION },
  {
    instructions: defaultAddressSpaced
      ? `${BASE_INSTRUCTIONS} Configured default address: ${defaultAddressSpaced} — ` +
        'tools that take an address use it when none is given.'
      : BASE_INSTRUCTIONS,
  }
)

// 1 — get_summary
server.registerTool(
  'get_summary',
  {
    title: 'Account summary',
    description:
      'Balance and money in/out for a Nimiq address over a window. Read-only: ' +
      'never signs, never sends. Defaults to the full history the public index ' +
      `returns (up to ${HISTORY_CAP} transactions, newest first). Balance is the ` +
      'live account balance now, not the balance at the end of the window; any ' +
      'staked NIM is reported separately because it lives in the staking contract. ' +
      'Money out includes transfers into the staking contract and out of it — the ' +
      'same treatment as the app’s statement; validator rewards arrive through a ' +
      'separate channel and are reported as their own line (rewardsReceivedNim).',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`Nimiq address — "NQ43 Y1RH …", the flat form, or 40 hex characters. ${DEFAULTS_TO_CONFIGURED}`),
      since: z.string().optional().describe('Start of the window, YYYY-MM-DD or ISO 8601 (UTC). Default: no start.'),
      until: z.string().optional().describe('End of the window, YYYY-MM-DD or ISO 8601 (UTC). Default: now.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, since, until }) =>
    guard('get_summary', async () => {
      const addr = addressArg(address)
      const from = parseWhen(since, 'since', false)
      const to = parseWhen(until, 'until', true)
      // A failed staker lookup is not the same as never staked (getStaking
      // throws for that now), but the summary must still come back: it says
      // so in a note and reports the staked figure as unknown, not 0.
      let staking: StakingHolding | null = null
      let stakingNote: string | undefined
      const [balanceLuna, walk] = await Promise.all([getBalance(addr), getTransactionHistory(addr, HISTORY_CAP, 200)])
      try {
        staking = await getStaking(addr)
      } catch (e) {
        stakingNote =
          `The staker lookup failed, so the staked amounts below are unknown, not zero: ` +
          `${e instanceof ToolError ? e.message : String(e)}`
      }
      // Restaking rewards never appear in the tx index — they are read from
      // the same v2 endpoint the app uses and folded in as rows, so a
      // staker's balance trajectory is not silently missing its income. The
      // window is the whole ask: `since`/`until` when given, every reward the
      // public data has (back to January 2025) otherwise. A reporting variant
      // is used so a year the endpoint did not answer is named, not dropped:
      // the app's rule is that the cards say the total may be short instead
      // of staying silent.
      const askedFrom = from ?? Date.parse(REWARDS_FLOOR_DAY + 'T00:00:00Z')
      const rewardReport = REWARDS_DISABLED
        ? { rows: [], failedYears: [] }
        : await getRestakeRewardTxsReport(addr, askedFrom, to ?? Date.now())
      const rewardTxs = rewardReport.rows
      const rewardsNote = rewardNotes(rewardReport.failedYears, askedFrom)
      const txs = [...walk.txs, ...rewardTxs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

      let inLuna = 0n
      let outLuna = 0n
      let feeLuna = 0n
      let inCount = 0
      let outCount = 0
      let rewardLuna = 0n
      let oldest: number | null = null
      let newest: number | null = null

      for (const tx of txs) {
        // Failed/reverted transactions are not transfers (the app excludes them
        // from every statement; so does this).
        if (tx.executionResult === false) continue
        if (!inWindow(tx, from, to)) continue
        const value = BigInt(/^\d+$/.test(tx.value) ? tx.value : '0')
        const fee = BigInt(/^\d+$/.test(tx.fee) ? tx.fee : '0')
        const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === addr
        if (isOut) {
          outLuna += value
          feeLuna += fee // sender pays
          outCount++
        } else {
          inLuna += value
          inCount++
          if (txLabel(tx, addr) === 'reward') rewardLuna += value
        }
        if (typeof tx.timestamp === 'number') {
          oldest = oldest === null ? tx.timestamp : Math.min(oldest, tx.timestamp)
          newest = newest === null ? tx.timestamp : Math.max(newest, tx.timestamp)
        }
      }

      return ok({
        address: spacedAddress(addr),
        balanceLuna,
        balanceNim: formatLunaExact(balanceLuna),
        staked: staking
          ? {
              activeLuna: staking.active,
              activeNim: formatLunaExact(staking.active),
              inactiveLuna: staking.inactive,
              retiredLuna: staking.retired,
              delegation: staking.delegation ? spacedAddress(staking.delegation) : null,
              note: 'Staked NIM sits in the staking contract, so it is not part of balanceLuna above.',
            }
          : null,
        window: {
          since: from !== null ? iso(from) : 'all history available',
          until: to !== null ? iso(to) : 'now',
          firstTxInWindow: oldest !== null ? iso(oldest) : null,
          lastTxInWindow: newest !== null ? iso(newest) : null,
        },
        inLuna: inLuna.toString(),
        inNim: formatLunaExact(inLuna.toString()),
        outLuna: outLuna.toString(),
        outNim: formatLunaExact(outLuna.toString()),
        feesPaidLuna: feeLuna.toString(),
        feesPaidNim: formatLunaExact(feeLuna.toString()),
        rewardsReceivedLuna: rewardLuna.toString(),
        rewardsReceivedNim: formatLunaExact(rewardLuna.toString()),
        netLuna: (inLuna - outLuna - feeLuna).toString(),
        netNim: formatLunaExact((inLuna - outLuna - feeLuna).toString()),
        txCount: inCount + outCount,
        inCount,
        outCount,
        historyFetched: walk.txs.length,
        rewardsFetched: rewardTxs.length,
        rewardsNote,
        stakingNote,
        truncated:
          walk.txs.length >= HISTORY_CAP || walk.overrun
            ? walk.overrun
              ? `The index stopped answering part-way through (rate limit); only the newest ${walk.txs.length} of the available history was read, then this summary.`
              : `Only the newest ${HISTORY_CAP} transactions were read.`
            : null,
      })
    })
)

// 2 — list_transactions
server.registerTool(
  'list_transactions',
  {
    title: 'List transactions',
    description:
      'Classified transactions for a Nimiq address, newest first. Read-only: ' +
      'never signs, never sends. Each row carries the kind the NimBooks app ' +
      'shows (payment, stake, unstake, reward, swap, vesting), the counterparty, ' +
      'and the memo — a cashlink’s protocol tag reads as "Cashlink" rather than ' +
      'raw bytes, and a `nimbooks:invoice:<id>` memo is the reference that ties ' +
      'a payment to a request.',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`Nimiq address (NQ form, spaced or flat, or 40 hex characters). ${DEFAULTS_TO_CONFIGURED}`),
      limit: z.number().int().min(1).max(500).optional().describe('Rows to return. Default 50.'),
      since: z.string().optional().describe('Only transactions at or after this date (YYYY-MM-DD or ISO 8601, UTC).'),
      until: z.string().optional().describe('Only transactions at or before this date (YYYY-MM-DD or ISO 8601, UTC).'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, limit, since, until }) =>
    guard('list_transactions', async () => {
      const addr = addressArg(address)
      const max = limit ?? 50
      const from = parseWhen(since, 'since', false)
      const to = parseWhen(until, 'until', true)
      // A window has to be applied after fetching (the index pages by cursor,
      // not by date), so fetch generously and filter.
      const fetchCap = from !== null || to !== null ? HISTORY_CAP : Math.min(HISTORY_CAP, Math.max(max, 50))
      const walk = await getTransactionHistory(addr, fetchCap, 200)
      const txs = walk.txs

      const rows = txs
        .filter((tx) => tx.executionResult !== false && inWindow(tx, from, to))
        .slice(0, max)
        .map((tx) => {
          const kind = txLabel(tx, addr)
          const isOut = tx.sender.replace(/\s+/g, '').toUpperCase() === addr
          const memo = memoForRow(tx, kind)
          const invoiceId = parseInvoiceMemo(decodeMemo(tx.data))
          return {
            kind,
            direction: isOut ? ('sent' as const) : ('received' as const),
            amountLuna: tx.value,
            amountNim: formatLunaExact(tx.value),
            counterparty: spacedAddress(isOut ? tx.recipient : tx.sender),
            ...(memo ? { memo } : {}),
            ...(invoiceId ? { invoiceId } : {}),
            timestamp: iso(tx.timestamp),
            hash: tx.hash,
            explorer: explorerTxUrl(tx.hash),
          }
        })

      return ok({
        address: spacedAddress(addr),
        count: rows.length,
        transactions: rows,
        note:
          rows.length === 0
            ? 'No transactions matched. The address may be new, or the window may be outside its history.'
            : walk.overrun
              ? `The index stopped answering part-way through (rate limit); rows cover the newest ${txs.length} transactions read.`
              : undefined,
      })
    })
)

// 3 — get_statement
server.registerTool(
  'get_statement',
  {
    title: 'Daily statement',
    description:
      'Day-by-day money in and out for a year (or one month of it), priced at ' +
      'the CoinGecko daily close in USD for each UTC day — the same basis the ' +
      'NimBooks tax statement uses. Read-only: never signs, never sends. Failed ' +
      'transactions are excluded and fees are counted on outgoing transactions ' +
      'only. Staking rewards (restaking payouts) are included as in-day income; ' +
      'moving NIM into or out of the staking contract is not a fiat flow, so it ' +
      'is excluded, exactly like the app’s statement. Days with no price ' +
      'available come back with closeUsd: null rather than a guess.',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`Nimiq address (NQ form, spaced or flat, or 40 hex characters). ${DEFAULTS_TO_CONFIGURED}`),
      year: z.number().int().describe('Calendar year, UTC — e.g. 2026.'),
      month: z.number().int().min(1).max(12).optional().describe('Optional month 1–12. Omit for the whole year.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, year, month }) =>
    guard('get_statement', async () => {
      const addr = addressArg(address)
      const bounds = periodBounds(year, month)
      const walk = await getTransactionHistory(addr, HISTORY_CAP, 200)
      // Restaking rewards are income too: the same v2 rows the app folds into
      // its statement, fetched for the statement period itself, so a staker's
      // statement is not missing them (the tx index has none). A reporting
      // variant, so a year the endpoint skipped is named in the answer.
      const rewardReport = REWARDS_DISABLED
        ? { rows: [], failedYears: [] }
        : await getRestakeRewardTxsReport(addr, bounds.from, Math.min(bounds.to, Date.now()))
      const rewardTxs = rewardReport.rows
      const txs = [...walk.txs, ...rewardTxs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      const prices = await getDailyCloses(bounds.from, Math.min(bounds.to, Date.now()))
      const statement = computeStatement(txs, addr, bounds, prices)

      return ok({
        address: spacedAddress(addr),
        period: statement.period,
        basis: statement.basis,
        rows: statement.rows.map((r) => ({
          date: r.date,
          inNim: Number(r.inNim.toFixed(5)),
          outNim: Number(r.outNim.toFixed(5)),
          feeNim: Number(r.feeNim.toFixed(5)),
          closeUsd: r.closeUsd,
          inUsd: r.inUsd === null ? null : Number(r.inUsd.toFixed(6)),
          outUsd: r.outUsd === null ? null : Number(r.outUsd.toFixed(6)),
          txCount: r.txCount,
        })),
        totals: statement.totals,
        rewardsNote: rewardNotes(rewardReport.failedYears, bounds.from),
        priceNote:
          statement.pricesMissing > 0
            ? [
                `${statement.pricesMissing} day(s) had no CoinGecko close available, so USD totals are withheld rather than computed from a partial year.`,
                priceCoverageNote(bounds.from, Date.now()),
              ]
                .filter(Boolean)
                .join(' ')
            : undefined,
        truncated: walk.overrun
          ? `The index stopped answering part-way through (rate limit); the newest ${walk.txs.length} transactions were read, so the statement may be missing older rows.`
          : walk.txs.length >= HISTORY_CAP
            ? `Only the newest ${HISTORY_CAP} transactions were read.`
            : undefined,
      })
    })
)

// 4 — create_payment_request
server.registerTool(
  'create_payment_request',
  {
    title: 'Draft a payment request',
    description:
      'DRAFTS a payment request and returns a shareable link. This never signs ' +
      'anything, never sends anything, and never marks anything paid — the ' +
      'whole request rides inside the link, and only the payer’s wallet, with ' +
      'their approval, can actually move money. The link opens in the NimBooks ' +
      'app; the payment it produces carries the reference nimbooks:invoice:<id>, ' +
      'which check_request_paid looks for later. Note: inside the link, the ' +
      'payload field amountNim is denominated in Luna by the app’s link format; ' +
      'this tool’s own output reports amountNim in NIM and amountLuna in Luna.',
    inputSchema: {
      amountNim: z
        .string()
        .describe('Amount in NIM, as a decimal string — "12.5". Up to 5 decimals (1 NIM = 100000 Luna).'),
      payee: z.string().optional().describe(`Address to be paid. ${DEFAULTS_TO_CONFIGURED}`),
      memo: z.string().optional().describe(`What the request is for, up to ${MAX_MEMO_CHARS} characters. Travels in the link, not on chain.`),
      expiry: z
        .string()
        .optional()
        .describe('When the request stops being valid: "1h", "24h", "7d", "none" (default), or an ISO 8601 timestamp.'),
      id: z.string().optional().describe('Fixed request id, for reproducible links. Generated when omitted.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ amountNim, payee, memo, expiry, id }) =>
    guard('create_payment_request', async () => {
      const addr = addressArg(payee)
      const luna = parseNimToLuna(String(amountNim))
      if (!luna) {
        throw new ToolError(
          `"${amountNim}" is not an amount I can request. Give a positive NIM ` +
            `amount with at most 5 decimals, e.g. "12.5".`
        )
      }
      if (memo && memo.length > MAX_MEMO_CHARS) {
        throw new ToolError(`The memo is ${memo.length} characters; the app’s limit is ${MAX_MEMO_CHARS}.`)
      }
      const requestId = id ?? newInvoiceId()
      if (!/^[0-9a-z-]{1,24}$/i.test(requestId)) {
        throw new ToolError(
          `"${requestId}" cannot be a request id: it becomes the on-chain ` +
            `reference the payer signs, so it is limited to letters, digits and ` +
            `hyphens (up to 24).`
        )
      }
      const createdAt = Date.now()
      const expiresAt = parseExpiry(expiry, createdAt)

      // A request is a document that tells a human where to send money — the
      // payee inside it is the person who gets paid. When the configured
      // address is used because none was named, say so explicitly; a link
      // that silently carries the user's own address is how a request ends up
      // pointing at the wrong wallet.
      const payeeFromDefault = !!defaultAddressSpaced && !payee

      const payload: InvoicePayload = {
        app: 'nimbooks',
        v: 1,
        id: requestId,
        payee: addr,
        amountNim: luna,
        createdAt,
        ...(memo ? { memo } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      }

      return ok({
        id: requestId,
        link: invoiceUrl(payload),
        amountNim: formatLunaExact(luna),
        amountLuna: luna,
        payee: spacedAddress(addr),
        memo: memo ?? undefined,
        expiresAt: expiresAt ? iso(expiresAt) : null,
        onChainReference: invoiceMemo(requestId),
        encoded: encodeInvoice(payload),
        note:
          `${NEVER_SIGNED} Share the link; when it is paid, the payment carries ` +
          `the reference ${invoiceMemo(requestId)}, and check_request_paid will find it.` +
          (payeeFromDefault
            ? ` No payee was named, so the request is addressed to the configured ` +
              `address ${spacedAddress(addr)} — make sure that is who you meant.`
            : ''),
      })
    })
)

function parseExpiry(expiry: string | undefined, from: number): number | null {
  if (!expiry || expiry.toLowerCase() === 'none') return null
  // The app's own expiry choices (lib/invoice.ts EXPIRY_OPTIONS).
  const shorthand: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  const key = expiry.trim().toLowerCase()
  if (shorthand[key]) return from + shorthand[key]
  const ms = Date.parse(expiry)
  if (!Number.isFinite(ms)) {
    throw new ToolError(`"${expiry}" is not an expiry I can read. Use "1h", "24h", "7d", "none", or an ISO 8601 timestamp.`)
  }
  if (ms <= from) throw new ToolError(`That expiry (${expiry}) is already in the past.`)
  return ms
}

// 5 — check_request_paid
server.registerTool(
  'check_request_paid',
  {
    title: 'Check whether a request was paid',
    description:
      'Looks for a payment tagged with a request’s reference (nimbooks:invoice:<id>) ' +
      'in the address’s transactions — the same match the NimBooks app uses to ' +
      'mark a request paid. Read-only: it reports what the chain says and ' +
      'changes nothing, here or in the app. Scans the newest ' +
      `${INVOICE_SCAN_CAP} transactions.`,
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`The payee address the request was made for. ${DEFAULTS_TO_CONFIGURED}`),
      id: z.string().describe('The request id, as returned by create_payment_request.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, id }) =>
    guard('check_request_paid', async () => {
      const addr = addressArg(address)
      const wanted = String(id).trim()
      const walk = await getTransactionHistory(addr, INVOICE_SCAN_CAP)
      const txs = walk.txs

      // The amount is only known if a backup carries the request. Without it
      // the paid/found split depends entirely on the reference + payee match,
      // so the answer says so instead of silently treating any amount as paid
      // (a 1-Luna payment with the right tag must not read as settled).
      let expectedLuna: bigint | null = null
      let amountKnown = false
      if (options.backupPath) {
        try {
          const found = listBackupInvoices(backup(), addr, () => '', Date.now()).invoices.find(
            (i) => i.id === wanted
          )
          if (found) {
            expectedLuna = BigInt(found.amountLuna)
            amountKnown = true
          }
        } catch {
          /* no backup, or unreadable — fall back to tag-only matching */
        }
      }

      const match = txs.find((t) => {
        if (t.executionResult === false) return false
        if (parseInvoiceMemo(decodeMemo(t.data)) !== wanted) return false
        // The payment has to have landed on the payee, not merely mention the id.
        if (t.recipient.replace(/\s+/g, '').toUpperCase() !== addr) return false
        if (expectedLuna === null) return true
        // Underpayments stay open — only a full payment settles the request.
        return /^\d+$/.test(String(t.value)) && BigInt(t.value) >= expectedLuna
      })

      if (!match) {
        const underpaid = txs.find(
          (t) => t.executionResult !== false && parseInvoiceMemo(decodeMemo(t.data)) === wanted
        )
        return ok({
          paid: false,
          id: wanted,
          address: spacedAddress(addr),
          scanned: txs.length,
          note:
            underpaid && expectedLuna !== null
              ? `A transaction carries this reference but pays ${formatLunaExact(underpaid.value)} NIM, ` +
                `less than the ${formatLunaExact(expectedLuna.toString())} NIM requested — the app treats ` +
                `underpayments as still open.`
              : !amountKnown
                ? `No payment tagged ${invoiceMemo(wanted)} was found in the newest ${txs.length} ` +
                  `transactions for this address. No backup is configured, so the amount could not be ` +
                  `verified against the request — a payment with this reference of any size counts as ` +
                  `found. If the request is older than the scan, it may be beyond it; nothing here ` +
                  `marks it paid either way.`
                : `No payment tagged ${invoiceMemo(wanted)} was found in the newest ${txs.length} ` +
                  `transactions for this address. If the request is older than that, it may be beyond ` +
                  `the scan; nothing here marks it paid either way.`,
        })
      }

      return ok({
        paid: true,
        id: wanted,
        address: spacedAddress(addr),
        tx: {
          hash: match.hash,
          amountLuna: match.value,
          amountNim: formatLunaExact(match.value),
          from: spacedAddress(match.sender),
          to: spacedAddress(match.recipient),
          timestamp: iso(match.timestamp),
          explorer: explorerTxUrl(match.hash),
        },
        note:
          'Reported from the public chain. This server does not mark anything paid — the app reconciles its own copy.' +
          (!amountKnown
            ? ' No backup is configured, so the amount was matched only by the reference and the ' +
              `payee: this payment (${formatLunaExact(match.value)} NIM) is accepted as settling the ` +
              'request even though the requested amount could not be verified.'
            : ''),
      })
    })
)

// 6 — list_invoices
server.registerTool(
  'list_invoices',
  {
    title: 'List saved payment requests',
    description:
      'Payment requests stored in a NimBooks backup file (the app keeps them on ' +
      'the device; there is no server holding them). Requires the server to be ' +
      'started with --backup <path>. Read-only: the file is never written to, ' +
      'and the cashlink shelf inside it — which holds link private keys — is ' +
      'never opened.',
    inputSchema: {
      address: z.string().optional().describe(`The account whose requests to list. ${DEFAULTS_TO_CONFIGURED}`),
    },
    annotations: READ_ONLY,
  },
  async ({ address }) =>
    guard('list_invoices', async () => {
      const addr = addressArg(address)
      const file = backup()
      const { invoices, skipped } = listBackupInvoices(file, addr, (inv) => invoiceUrl(inv), Date.now())

      return ok({
        address: spacedAddress(addr),
        backupExportedAt: iso(file.exportedAt),
        count: invoices.length,
        invoices,
        skipped: skipped > 0 ? `${skipped} entr(y/ies) in the backup could not be read and were skipped.` : undefined,
        note:
          invoices.length === 0
            ? 'The backup holds no payment requests for this address. Check that the address matches the account they were created under.'
            : 'Status is what the app last recorded on the device. For the chain’s view of one request, use check_request_paid.',
      })
    })
)

// 7: get_staking

function percentOf(v: number | null | undefined, dp = 2): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  return Number((v * 100).toFixed(dp))
}

function findValidatorByAddress(address: string, validators: ValidatorInfo[]): ValidatorInfo | null {
  const flat = address.replace(/\s+/g, '').toUpperCase()
  return validators.find((v) => v.address.replace(/\s+/g, '').toUpperCase() === flat) ?? null
}

/** Flat, uppercase form used for comparisons and links. */
function flatAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/** Whether a validator argument is meant as an address rather than a name. */
function looksLikeAddressQuery(query: string): boolean {
  const flat = query.replace(/\s+/g, '')
  return /^NQ/i.test(flat) || /^(0x)?[0-9a-f]{40}$/i.test(flat)
}

/** A validator address, or null when the input is not one (invalid is dropped, not thrown). */
function validatorAddressFrom(input: string): string | null {
  const flat = flatAddress(input)
  if (/^(0X)?[0-9A-F]{40}$/.test(flat)) {
    try {
      return normalizeAddress(flat)
    } catch {
      return null
    }
  }
  return isValidNimiqAddress(flat) ? flat : null
}

/** Blocks at about 1 block/second, as the app words its unstake clocks. */
function blocksWait(blocks: number): string {
  if (blocks < 90) return `about ${blocks} minutes at about 1 block per second`
  const h = blocks / 3600
  if (h < 48) return `about ${Math.round(h)} hour(s) at about 1 block per second`
  return `about ${Math.round(h / 24)} day(s) at about 1 block per second`
}

/** The calendar years a rewards window covers, clamped to the floor day and now. */
function rewardYears(fromMs: number, toMs: number): number[] {
  const from = Math.max(fromMs, Date.parse(REWARDS_FLOOR_DAY + 'T00:00:00Z'))
  const to = Math.min(toMs, Date.now())
  if (to < from) return []
  const first = Number(new Date(from).toISOString().slice(0, 4))
  const last = Number(new Date(to).toISOString().slice(0, 4))
  const years: number[] = []
  for (let y = first; y <= last; y++) years.push(y)
  return years
}

server.registerTool(
  'get_staking',
  {
    title: 'Staked position',
    description:
      'A Nimiq address\'s staking position: active staked, inactive (cooling down after an ' +
      'unstake), retired (ready to withdraw) and total, plus the pool it is staked to with its ' +
      'fee, net yield and payout type, an unstake clock (a retire only becomes valid one full ' +
      'epoch after deactivation), and a first-year rewards estimate at the pool\'s current net ' +
      'yield. Read-only: reads the public chain and the public validators list, never signs and ' +
      'never sends. Never staked reads as staked: false, never as a failed lookup; a failed ' +
      'lookup is an error that says so.',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`Nimiq address (NQ form, spaced or flat, or 40 hex characters). ${DEFAULTS_TO_CONFIGURED}`),
    },
    annotations: READ_ONLY,
  },
  async ({ address }) =>
    guard('get_staking', async () => {
      const addr = addressArg(address)
      const holding = await getStaking(addr)
      const spaced = spacedAddress(addr)

      if (!holding) {
        // The RPC said "No staker with address", the real answer for an
        // address that has never staked, and not the same thing as a failed
        // lookup (which throws, above).
        return ok({
          address: spaced,
          staked: false,
          activeLuna: '0',
          activeNim: '0',
          inactiveLuna: '0',
          inactiveNim: '0',
          retiredLuna: '0',
          retiredNim: '0',
          stakedLuna: '0',
          stakedNim: '0',
          validator: null,
          unstaking: null,
          estimate: null,
          note: `No staker record exists on chain for this address: it has never staked. ${MIN_STAKE_NOTE}`,
        })
      }

      const activeLuna = BigInt(/^\d+$/.test(holding.active) ? holding.active : '0')
      const inactiveLuna = BigInt(/^\d+$/.test(holding.inactive) ? holding.inactive : '0')
      const retiredLuna = BigInt(/^\d+$/.test(holding.retired) ? holding.retired : '0')
      const totalLuna = activeLuna + inactiveLuna + retiredLuna

      // The pool's fee, yield and payout wording ride on the validators list;
      // when that API is down, the balances are still exact, so they answer
      // and the pool details come back empty with a note (name: null).
      let validators: ValidatorInfo[] | null = null
      let validatorsNote: string | undefined
      try {
        validators = (await getValidatorsSnapshot()).validators
      } catch (e) {
        validatorsNote = `${e instanceof ToolError ? e.message : String(e)} The balances below are exact from the chain.`
      }
      const v = validators && holding.delegation ? findValidatorByAddress(holding.delegation, validators) : null

      // Unstaking: a deactivate moves NIM to the inactive bucket, and the
      // retire transaction is only valid a full epoch later
      // (inactiveFrom + 43,200 blocks, roughly 12 hours at 1 block/s).
      let unstaking: Record<string, unknown> | null = null
      if (inactiveLuna > 0n) {
        const retireValidAt = holding.inactiveFrom > 0 ? holding.inactiveFrom + BLOCKS_PER_EPOCH : null
        let currentBlock: number | null = null
        try {
          currentBlock = await getBlockHeight()
        } catch {
          currentBlock = null
        }
        const ready = currentBlock !== null && retireValidAt !== null && currentBlock >= retireValidAt
        const blocksLeft =
          currentBlock !== null && retireValidAt !== null ? Math.max(0, retireValidAt - currentBlock) : null
        unstaking = {
          inactiveFromBlock: holding.inactiveFrom || null,
          retireValidAtBlock: retireValidAt,
          currentBlockHeight: currentBlock,
          readyToRetire: currentBlock === null ? null : ready,
          ...(blocksLeft !== null && !ready ? { timeLeft: blocksWait(blocksLeft) } : {}),
          note:
            'Inactive (cooling down) NIM no longer earns. Withdrawing it takes two steps: the retire ' +
            'transaction first becomes valid a full reporting epoch after the deactivation takes ' +
            'effect, and the withdrawal itself follows after that.',
        }
      }

      let estimate: Record<string, unknown> | null = null
      if (v && v.annualReward !== null && v.annualReward > 0 && activeLuna > 0n) {
        const proj = projectStake({
          principalNim: Number(activeLuna) / 100000,
          annualRateNow: v.annualReward,
          months: 12,
          compound: compoundsFor(v),
        })
        estimate = {
          firstYearRewardsNim: Number(proj.firstYearNim.toFixed(5)),
          firstYearRewardsLuna: String(Math.round(proj.firstYearNim * 100000)),
          annualRatePercent: percentOf(v.annualReward),
          compounds: compoundsFor(v),
          estimateNote:
            'An estimate: the pool\'s current net yield held over the first year, with emission ' +
            'falling along the protocol curve. It assumes the network stays at today\'s total stake, ' +
            'which nothing guarantees; it is not a promise.',
        }
      }

      const notes: string[] = []
      if (validatorsNote) notes.push(validatorsNote)
      if (!v && !validatorsNote) {
        notes.push(
          holding.delegation
            ? 'The pool this stake is with is not in the validators list right now; its name, fee and yield are unknown here.'
            : 'The staker record does not name a pool (delegation is empty), so the pool details are unknown.'
        )
      }

      return ok({
        address: spaced,
        staked: true,
        activeLuna: activeLuna.toString(),
        activeNim: formatLunaExact(activeLuna.toString()),
        inactiveLuna: inactiveLuna.toString(),
        inactiveNim: formatLunaExact(inactiveLuna.toString()),
        inactiveLabel: 'cooling down (earning nothing)',
        retiredLuna: retiredLuna.toString(),
        retiredNim: formatLunaExact(retiredLuna.toString()),
        retiredLabel: 'ready to withdraw',
        stakedLuna: totalLuna.toString(),
        stakedNim: formatLunaExact(totalLuna.toString()),
        // The pool rides on the validators list; when that is unavailable (or
        // the delegation is not in it), the object comes back with name: null
        // and a note, while the balances above stay exact.
        validator: holding.delegation
          ? {
              address: spacedAddress(holding.delegation),
              name: v ? v.name : null,
              feePercent: v ? percentOf(v.fee) : null,
              netYieldPercent: v ? percentOf(v.annualReward) : null,
              compounds: v ? compoundsFor(v) : null,
              payout: v ? (compoundsFor(v) ? 'adds rewards to your stake' : 'pays rewards out') : null,
              producing: v ? v.reliability !== null : null,
              buildersPool: v ? isBuildersPool(v.address) : null,
            }
          : null,
        unstaking,
        estimate,
        note: notes.length > 0 ? notes.join(' ') : undefined,
      })
    })
)

// 8: list_validators

server.registerTool(
  'list_validators',
  {
    title: 'Nimiq validator pools',
    description:
      'The Nimiq validator pools of the current epoch, ranked neutrally, exactly as the NimBooks ' +
      'app ranks them: producing pools first (those with a reliability score this epoch), best ' +
      'net annual yield first within them, pools that publish no yield last, then the ' +
      'non-producing pools, and the name as the final stable tiebreak. Nothing is pinned first. ' +
      'Read-only: one call to the public validators list, never signs and never sends. ' +
      'netYieldPercent is the net annual yield on the network\'s total stake after the pool\'s ' +
      'fee, the Nimiq wallet\'s convention; it moves as emission falls and as stake moves.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Pools to return, 1 to 50. Default 50.'),
      includeNonProducing: z
        .boolean()
        .optional()
        .describe('Include pools with no reliability score this epoch (they earn nothing right now). Default true.'),
    },
    annotations: READ_ONLY,
  },
  async ({ limit, includeNonProducing }) =>
    guard('list_validators', async () => {
      const { validators, networkStakeLuna } = await getValidatorsSnapshot()
      const max = limit ?? 50
      const producingOnly = includeNonProducing === false
      const picked = (producingOnly ? validators.filter((v) => v.reliability !== null) : validators).slice(0, max)
      const typical = typicalRate(validators)
      return ok({
        count: picked.length,
        ordered: 'producing pools first by net yield, no-yield pools last, non-producing pools after, name as the stable tiebreak',
        validators: picked.map((v, i) => ({
          rank: i + 1,
          name: v.name,
          address: spacedAddress(v.address),
          feePercent: percentOf(v.fee),
          feeNote: v.fee === null ? 'does not publish a fee' : undefined,
          netYieldPercent: percentOf(v.annualReward),
          reliabilityPercent: percentOf(v.reliability),
          producing: v.reliability !== null,
          compounds: compoundsFor(v),
          payout: compoundsFor(v) ? 'restakes' : 'direct',
          stakedNim: Number((v.balance / 100000).toFixed(5)),
          buildersPool: isBuildersPool(v.address),
        })),
        typicalYieldPercent: percentOf(typical),
        typicalYieldNote:
          'the median net annual yield across producing pools, the neutral "what staking pays" figure',
        networkStakeNim: Number((networkStakeLuna / 100000).toFixed(5)),
        networkStakeNote: 'the network\'s total active stake, backed out of the list the same way the app backs it out',
        note:
          'ImpactZero is run by the developer of NimBooks. It is ranked by the same rule as every ' +
          'other pool and is not pinned. Net annual yield is the yield on the network\'s total stake ' +
          'after the pool\'s fee, the Nimiq wallet\'s convention; it moves as emission falls and as ' +
          'stake moves. Pools marked direct pay rewards out instead of restaking them.',
      })
    })
)

// 9: project_yield

server.registerTool(
  'project_yield',
  {
    title: 'Project staking yield',
    description:
      'Projects what staking an amount of NIM might earn, year by year. With an explicit rate it ' +
      'is a pure offline calculation. Read-only, never signs and never sends. Rate resolution, in ' +
      'order: an explicit annualRatePercent, then the named pool\'s current net yield, then the ' +
      'median of the producing pools. Compounding follows the pool\'s payout type (direct pools ' +
      'pay out, the rest restake) unless an explicit compound choice is given. Returns per-year ' +
      'rewards, cumulative rewards and balance, plus its assumptions: emission falls along the ' +
      'protocol supply curve, the network\'s total stake is held at today\'s level, and it is a ' +
      'projection, not a promise.',
    inputSchema: {
      amountNim: z
        .string()
        .describe('Amount to stake, in NIM, as a decimal string, e.g. "1000". At most 5 decimals.'),
      years: z.number().int().min(1).max(10).optional().describe('Horizon in years, 1 to 10. Default 1.'),
      validator: z
        .string()
        .optional()
        .describe('A pool: its NQ address, exact name, or a unique part of the name (list_validators has them).'),
      annualRatePercent: z
        .number()
        .optional()
        .describe(
          'Explicit annual rate in percent, more than 0 and at most 100. Wins over any pool\'s or the typical rate, and makes the call work offline.'
        ),
      compound: z
        .boolean()
        .optional()
        .describe('Restake rewards as they arrive (true) or pay them out (false). Default: the pool\'s payout type, else true.'),
    },
    annotations: READ_ONLY,
  },
  async ({ amountNim, years, validator, annualRatePercent, compound }) =>
    guard('project_yield', async () => {
      const luna = parseNimToLuna(String(amountNim))
      if (!luna) {
        throw new ToolError(
          `"${amountNim}" is not an amount I can project. Give a positive NIM amount with at most ` +
            `5 decimals, e.g. "1000".`
        )
      }
      if (years !== undefined && !(Number.isInteger(years) && years >= 1 && years <= 10)) {
        throw new ToolError(`years must be a whole number from 1 to 10, not ${String(years)}.`)
      }
      const horizon = years ?? 1
      const principalNim = Number(luna) / 100000

      // With an explicit rate this is a pure calculation: nothing is fetched,
      // so it works with the validators API unreachable. Otherwise the named
      // pool (for its net yield) or the list (for the typical median) is read.
      let validators: ValidatorInfo[] | null = null
      let named: ValidatorInfo | null = null
      if (annualRatePercent === undefined) {
        validators = (await getValidatorsSnapshot()).validators
        named = validator ? matchValidator(validator, validators) : null
      }
      const choice = chooseRate({
        annualRatePercent,
        validatorQuery: validator,
        named,
        validators: validators ?? [],
      })
      // With an explicit rate the pool's payout type is never looked up (the
      // call stays offline), so an unstated compound falls back to true.
      const resolvedCompound = annualRatePercent === undefined ? chooseCompound(compound, named) : (compound ?? true)
      const now = Date.now()
      const proj = projectStake({
        principalNim,
        annualRateNow: choice.rate,
        months: horizon * 12,
        compound: resolvedCompound,
        now,
      })

      const perYear: Array<Record<string, unknown>> = []
      for (let y = 1; y <= horizon; y++) {
        const end = proj.points[y * 12]
        const start = proj.points[(y - 1) * 12]
        perYear.push({
          year: y,
          rewardsThatYearNim: Number((end.rewardsNim - start.rewardsNim).toFixed(5)),
          cumulativeRewardsNim: Number(end.rewardsNim.toFixed(5)),
          balanceNim: Number(end.balanceNim.toFixed(5)),
        })
      }
      const last = proj.points[proj.points.length - 1]

      const notes: string[] = []
      if (annualRatePercent !== undefined && validator && compound === undefined) {
        notes.push(
          `A rate was given explicitly, so the pool "${validator}" was not looked up and its payout ` +
            `type is unknown here: compounding was left on. Pass compound: false if that pool pays out.`
        )
      }

      return ok({
        amountNim: formatLunaExact(luna),
        amountLuna: luna,
        years: horizon,
        compound: resolvedCompound,
        compoundsLabel: resolvedCompound ? 'rewards are restaked (compound)' : 'rewards are paid out (simple)',
        ratePercent: Number((choice.rate * 100).toFixed(5)),
        rateSource: choice.rateSource,
        perYear,
        totals: {
          totalRewardsNim: Number(proj.rewardsNim.toFixed(5)),
          balanceAtEndNim: Number(last.balanceNim.toFixed(5)),
        },
        assumptions: [
          'Emission falls along the protocol supply curve: each month pays slightly less than the one before (modelled).',
          'The network\'s total stake is held at today\'s level, which is not modelled: more stake lowers everyone\'s rate, less raises it.',
          'This is a projection, not a promise.',
        ],
        note: notes.length > 0 ? notes.join(' ') : undefined,
      })
    })
)

// 10: get_rewards

server.registerTool(
  'get_rewards',
  {
    title: 'Staking rewards',
    description:
      'Staking rewards for an address over a window: the total (Luna and NIM), the reward days, ' +
      'the first and last reward date, and the breakdown per paying pool, plus an actual yield ' +
      'over the trailing 30 days measured against the current active stake and the current ' +
      'validator\'s estimate for comparison. Read-only, never signs and never sends. Important: ' +
      'only restaking (compounding) pools show up in this data; a direct-payout pool\'s rewards ' +
      'arrive as ordinary incoming transactions and are found with list_transactions instead. The ' +
      'public rewards data starts January 2025, so earlier asks come back empty, and it can lag ' +
      'by a day. A year Nimiq Watch did not answer is named in the answer, never silently dropped.',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe(`Nimiq address (NQ form, spaced or flat, or 40 hex characters). ${DEFAULTS_TO_CONFIGURED}`),
      since: z
        .string()
        .optional()
        .describe('Start of the window, YYYY-MM-DD or ISO 8601 (UTC). Default: the start of the public rewards data.'),
      until: z.string().optional().describe('End of the window, YYYY-MM-DD or ISO 8601 (UTC). Default: now.'),
      includeDays: z
        .boolean()
        .optional()
        .describe('Include the per-day reward rows, newest first, at most 400. Default false.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, since, until, includeDays }) =>
    guard('get_rewards', async () => {
      const addr = addressArg(address)
      const from = parseWhen(since, 'since', false) ?? Date.parse(REWARDS_FLOOR_DAY + 'T00:00:00Z')
      const to = parseWhen(until, 'until', true) ?? Date.now()

      // The rewards fetch is failure-tolerant per calendar year, and the
      // reporting variant is what keeps that tolerance honest: a skipped
      // year is named, never silently zero (the app's "may be short" rule).
      const report = REWARDS_DISABLED
        ? { rows: [], failedYears: rewardYears(from, to) }
        : await getRestakeRewardTxsReport(addr, from, to)
      const rows = report.rows

      // The pool context rides on an optional best-effort read of the staker
      // record and the validators list; neither may fail the whole answer,
      // because the rewards asked for are the point.
      let activeLuna = 0
      let stakingFailed = false
      const holding = await getStaking(addr).catch((e: unknown) => {
        stakingFailed = true
        log(`get_rewards: staker lookup failed: ${e instanceof Error ? e.message : String(e)}`)
        return null
      })
      if (holding) activeLuna = Number(/^\d+$/.test(holding.active) ? holding.active : '0')
      let validators: ValidatorInfo[] | null = null
      try {
        validators = (await getValidatorsSnapshot()).validators
      } catch {
        validators = null
      }
      const current =
        validators && holding ? findValidatorByAddress(holding.delegation, validators) : null

      const totalLuna = rows.reduce((acc, r) => acc + BigInt(/^\d+$/.test(r.value) ? r.value : '0'), 0n)
      const earning = rewardsByValidator(rows)
      const byValidator = earning.map((e) => {
        const v = validators ? findValidatorByAddress(e.address, validators) : null
        return {
          address: spacedAddress(e.address),
          name: v ? v.name : null,
          nim: Number(e.nim.toFixed(5)),
          days: e.days,
          firstRewardDate: e.firstMs === Infinity ? null : new Date(e.firstMs).toISOString().slice(0, 10),
          lastRewardDate: e.lastMs ? new Date(e.lastMs).toISOString().slice(0, 10) : null,
        }
      })

      const day = (r: NimiqTx): string => new Date(r.timestamp ?? 0).toISOString().slice(0, 10)
      const rewardDates = [...new Set(rows.map((r) => day(r)))].sort()

      // Actual yield over the trailing 30 days against the current active
      // stake (the app's Earn card figure), with the reason spelled out when
      // it cannot say anything: few covered days, no stake, or a window that
      // does not reach the last 30 days.
      const windowEnd = Date.now()
      let actualYield: Record<string, unknown>
      if (stakingFailed) {
        actualYield = { percent: null, windowDays: null, reason: 'the active stake could not be read' }
      } else if (!holding) {
        actualYield = { percent: null, windowDays: null, reason: 'no staker record on chain' }
      } else if (activeLuna <= 0) {
        actualYield = { percent: null, windowDays: null, reason: 'no active stake to measure against' }
      } else if (windowEnd > to + 30 * 86_400_000) {
        actualYield = { percent: null, windowDays: null, reason: 'the asked window does not overlap the last 30 days' }
      } else {
        const t = trailingYield(rows, activeLuna, windowEnd, 30)
        actualYield = t
          ? { percent: Number((t.rate * 100).toFixed(5)), windowDays: t.windowDays }
          : { percent: null, windowDays: null, reason: 'under 7 days of rewards in the last 30' }
      }

      const notes: string[] = []
      if (report.failedYears.length > 0 && rows.length === 0) {
        notes.push(
          `Nimiq Watch did not answer for ${report.failedYears.join(', ')}, so any rewards in this window are unknown, not zero.`
        )
      } else if (rows.length === 0) {
        notes.push(
          'No restaking rewards were recorded for this address in this window. That is a no-rewards answer, not a failure: only restaking (compounding) pools appear in this data at all.'
        )
      }
      if (current && !compoundsFor(current)) {
        notes.push(
          `${current.name} pays rewards out directly, so those payouts do not appear here at all: they arrive as ordinary incoming transactions, which list_transactions reports.`
        )
      }

      // Per-day rows (only when asked): per UTC day, the total across pools,
      // newest first, at most 400, the app's one-row-per-day view.
      const include = includeDays === true
      const perDay = new Map<string, bigint>()
      for (const r of rows) {
        const d = day(r)
        perDay.set(d, (perDay.get(d) ?? 0n) + BigInt(/^\d+$/.test(r.value) ? r.value : '0'))
      }
      const dayRows = include
        ? [...perDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .slice(0, 400)
            .map(([d, luna]) => ({ day: d, rewardsLuna: luna.toString(), rewardsNim: formatLunaExact(luna.toString()) }))
        : undefined

      return ok({
        address: spacedAddress(addr),
        window: {
          since: new Date(from).toISOString(),
          until: new Date(Math.min(to, Date.now())).toISOString(),
        },
        totalRewardsLuna: totalLuna.toString(),
        totalRewardsNim: formatLunaExact(totalLuna.toString()),
        rewardDays: perDay.size,
        firstRewardDate: rewardDates[0] ?? null,
        lastRewardDate: rewardDates[rewardDates.length - 1] ?? null,
        byValidator,
        actualYield,
        estimatedYieldPercent: current ? percentOf(current.annualReward) : null,
        estimatedYieldNote: current
          ? `${current.name}'s current net yield, for comparison with actualYield above`
          : !holding && !stakingFailed
            ? 'no current pool to compare against: this address has no staker record'
            : 'no current pool to compare against (the staker record or the validators list was not readable)',
        rewardsNote: rewardNotes(report.failedYears, from),
        ...(stakingFailed
          ? {
              stakingNote:
                'The staker record could not be read, so actualYield is missing the active stake it would divide by.',
            }
          : {}),
        ...(include
          ? {
              days: dayRows,
              truncated:
                perDay.size > 400
                  ? `Only the newest 400 reward days are listed; the window holds ${perDay.size}.`
                  : undefined,
            }
          : {}),
        note: notes.length > 0 ? notes.join(' ') : undefined,
      })
    })
)

// 11: draft_stake

server.registerTool(
  'draft_stake',
  {
    title: 'Draft a stake link',
    description:
      'DRAFTS a stake and returns a link only. This never signs anything and never sends ' +
      'anything: the link opens the NimBooks app with the stake panel pre-filled, and you ' +
      'check the amount and validator there and confirm in your own wallet. No validator is ' +
      'recommended, ranked or chosen for you, and there is no default validator. The link ' +
      'is the deliverable, exactly like create_payment_request: nothing is built, broadcast ' +
      'or queued here, and nothing is marked as staked. Notes explain what the app will do ' +
      'with the values, including a cap to the free balance and the 100 NIM first-stake ' +
      'minimum.',
    inputSchema: {
      amountNim: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Amount in NIM, decimal, at most 5 decimals. An omitted or invalid amount is left out of the link with a note.'),
      validator: z
        .string()
        .optional()
        .describe('A validator NQ address, or a validator name (exact, or a unique part of the name). There is no default validator.'),
      address: z
        .string()
        .optional()
        .describe(`The staker account, used only to read the current delegation and liquid balance for notes. ${DEFAULTS_TO_CONFIGURED}`),
    },
    annotations: READ_ONLY,
  },
  async ({ amountNim, validator, address }) =>
    guard('draft_stake', async () => {
      const validatorInput = validator?.trim() ?? ''
      let validatorAddress: string | null = null
      let validatorInfo: ValidatorInfo | null = null
      let validators: ValidatorInfo[] | null = null

      if (validatorInput) {
        if (looksLikeAddressQuery(validatorInput)) {
          validatorAddress = validatorAddressFrom(validatorInput)
          // An address does not need the list. When it is readable, the list
          // supplies the pool's name and whether it is producing this epoch;
          // when it is not, the address alone still goes into the link.
          if (validatorAddress) {
            try {
              validators = (await getValidatorsSnapshot()).validators
              validatorInfo = findValidatorByAddress(validatorAddress, validators)
            } catch {
              /* the link works with the address alone */
            }
          }
        } else {
          // A name has to be resolved against the live list; a failed fetch is
          // a tool error that says so, never a quietly different link.
          validators = (await getValidatorsSnapshot()).validators
          validatorInfo = matchValidator(validatorInput, validators)
          validatorAddress = validatorInfo ? flatAddress(validatorInfo.address) : null
        }
      }

      const link = buildStakeLink({ amountNim, validator: validatorAddress })
      const intent = parseStakeLink(link.slice(link.indexOf('#')))
      if (!intent) {
        throw new ToolError('The stake link could not be read back. This is a bug in the server; nothing was signed or sent.')
      }
      const amountLuna = intent.amountLuna
      const amountNimOut = amountLuna !== null ? formatLunaExact(String(amountLuna)) : null

      const notes: string[] = [
        'Nothing was signed or sent. The link opens the stake panel in NimBooks; you check the amount and validator and confirm in your own wallet.',
      ]
      // A value that was dropped from the link is named, not silently omitted.
      // The builder leaves invalid values out before they ever become params,
      // so the link itself cannot carry the warning back; it comes from the
      // input side.
      if (amountNim !== undefined && amountNim !== null && amountLuna === null)
        notes.push(STAKE_AMOUNT_WARNING)
      if (validatorInput && !intent.validator) notes.push(STAKE_VALIDATOR_WARNING)
      if (!intent.validator) notes.push('No validator was chosen. The app does not pick one for you.')

      if (validatorInfo) {
        if (validatorInfo.reliability === null) {
          notes.push(
            `${validatorInfo.name} has no reliability score this epoch, so it is not producing rewards and the app will not select it.`
          )
        } else if (!validatorInfo.isListed) {
          notes.push(`${validatorInfo.name} is not listed as active this epoch, so the app will not select it.`)
        }
      }

      // The account is read only for context notes. No address, or a failed
      // read, never blocks the link.
      let account: string | null = null
      try {
        account = addressArg(address)
      } catch (e) {
        if (address) {
          notes.push(
            `The account checks were skipped: ${e instanceof Error ? e.message : String(e)} The link is still valid.`
          )
        }
      }

      if (account) {
        try {
          const [balanceLuna, holding] = await Promise.all([getBalance(account), getStaking(account)])
          if (holding && holding.delegation) {
            const delegation = flatAddress(holding.delegation)
            if (validatorAddress && delegation !== validatorAddress) {
              const current = validators ? findValidatorByAddress(delegation, validators) : null
              const who = current ? current.name : spacedAddress(delegation)
              notes.push(
                `This account already stakes with ${who}. The app adds new stake to that validator; switching needs an unstake first.`
              )
            }
          }
          if (amountLuna !== null) {
            const liquid = /^\d+$/.test(balanceLuna) ? BigInt(balanceLuna) : 0n
            if (BigInt(amountLuna) > liquid) {
              notes.push(
                `The amount is above the account's liquid balance (${formatLunaExact(liquid.toString())} NIM free), so the app will cap it to what is free.`
              )
            }
            if (!holding && BigInt(amountLuna) < BigInt(MIN_STAKE_NIM) * 100000n) {
              notes.push(`This account has no stake yet, and the app needs at least ${MIN_STAKE_NIM} NIM for a first stake.`)
            }
          }
        } catch (e) {
          notes.push(
            `The account checks were skipped: ${e instanceof Error ? e.message : String(e)} The link is still valid.`
          )
        }
      }

      return ok({
        link,
        amountNim: amountNimOut,
        validator: intent.validator
          ? { address: spacedAddress(intent.validator), name: validatorInfo?.name ?? null }
          : null,
        notes,
        signed: false,
      })
    })
)

// --- Boot ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log(`v${VERSION} ready: 11 tools, read-only.`)
  log(options.backupPath ? `backup: ${options.backupPath}` : 'no --backup given; list_invoices will explain how to make one')
  if (defaultAddressSpaced) log(`default address: ${defaultAddressSpaced} (named in the server instructions)`)
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})

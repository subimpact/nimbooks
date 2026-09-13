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
//     RPC (rpc.nimiqwatch.com) and CoinGecko's public price API. There is no
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
  getStaking,
  getTransactionHistory,
  memoForRow,
  normalizeAddress,
  spacedAddress,
  txLabel,
  type NimiqTx,
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
import { computeStatement, getDailyCloses, periodBounds, priceCoverageNote } from './statement.ts'

const VERSION = '1.0.0'

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

function log(msg: string): void {
  // stdout is the protocol. Diagnostics go to stderr, always.
  process.stderr.write(`[nimbooks-mcp] ${msg}\n`)
}

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

const server = new McpServer(
  { name: 'nimbooks-mcp', version: VERSION },
  {
    instructions:
      'Read-only access to a Nimiq address\'s books, plus drafting of payment ' +
      'requests. This server never signs and never sends: create_payment_request ' +
      'produces a shareable link and nothing more. It reads the public Nimiq ' +
      'chain and CoinGecko prices; it has no account, no keys and no server of ' +
      'its own. Amounts are reported in both Luna (integer, exact) and NIM.',
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
      'staked NIM is reported separately because it lives in the staking contract.',
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe('Nimiq address — "NQ43 Y1RH …", the flat form, or 40 hex characters.'),
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
      const [balanceLuna, txs, staking] = await Promise.all([
        getBalance(addr),
        getTransactionHistory(addr, HISTORY_CAP),
        getStaking(addr),
      ])

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
        historyFetched: txs.length,
        truncated: txs.length >= HISTORY_CAP ? `Only the newest ${HISTORY_CAP} transactions were read.` : null,
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
      address: z.string().optional().describe('Nimiq address (NQ form, spaced or flat, or 40 hex characters).'),
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
      const txs = await getTransactionHistory(addr, fetchCap)

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
      'only. Days with no price available come back with closeUsd: null rather ' +
      'than a guess.',
    inputSchema: {
      address: z.string().optional().describe('Nimiq address (NQ form, spaced or flat, or 40 hex characters).'),
      year: z.number().int().describe('Calendar year, UTC — e.g. 2026.'),
      month: z.number().int().min(1).max(12).optional().describe('Optional month 1–12. Omit for the whole year.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, year, month }) =>
    guard('get_statement', async () => {
      const addr = addressArg(address)
      const bounds = periodBounds(year, month)
      const txs = await getTransactionHistory(addr, HISTORY_CAP)
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
        priceNote:
          statement.pricesMissing > 0
            ? [
                `${statement.pricesMissing} day(s) had no CoinGecko close available, so USD totals are withheld rather than computed from a partial year.`,
                priceCoverageNote(bounds.from, Date.now()),
              ]
                .filter(Boolean)
                .join(' ')
            : undefined,
        truncated: txs.length >= HISTORY_CAP ? `Only the newest ${HISTORY_CAP} transactions were read.` : undefined,
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
      'which check_request_paid looks for later.',
    inputSchema: {
      amountNim: z
        .string()
        .describe('Amount in NIM, as a decimal string — "12.5". Up to 5 decimals (1 NIM = 100000 Luna).'),
      payee: z.string().optional().describe('Address to be paid. Defaults to the server’s --address.'),
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
          `the reference ${invoiceMemo(requestId)}, and check_request_paid will find it.`,
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
      address: z.string().optional().describe('The payee address the request was made for.'),
      id: z.string().describe('The request id, as returned by create_payment_request.'),
    },
    annotations: READ_ONLY,
  },
  async ({ address, id }) =>
    guard('check_request_paid', async () => {
      const addr = addressArg(address)
      const wanted = String(id).trim()
      const txs = await getTransactionHistory(addr, INVOICE_SCAN_CAP)

      // The amount is only known if a backup carries the request, so the
      // "underpayments stay open" rule can only be applied when it does.
      let expectedLuna: bigint | null = null
      if (options.backupPath) {
        try {
          const found = listBackupInvoices(backup(), addr, () => '', Date.now()).invoices.find(
            (i) => i.id === wanted
          )
          if (found) expectedLuna = BigInt(found.amountLuna)
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
        note: 'Reported from the public chain. This server does not mark anything paid — the app reconciles its own copy.',
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
      address: z.string().optional().describe('The account whose requests to list.'),
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

// --- Boot ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log(`v${VERSION} ready — 6 tools, read-only.`)
  log(options.backupPath ? `backup: ${options.backupPath}` : 'no --backup given; list_invoices will explain how to make one')
  if (options.defaultAddress) {
    try {
      log(`default address: ${spacedAddress(normalizeAddress(options.defaultAddress))}`)
    } catch {
      log(`WARNING: --address ${options.defaultAddress} is not a valid Nimiq address; tools will ask for one.`)
      options.defaultAddress = null
    }
  }
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})

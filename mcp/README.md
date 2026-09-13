# nimbooks-mcp

An MCP server that gives an AI assistant read access to your Nimiq books — balances,
classified history, tax-basis statements — and lets it **draft** payment requests.

It runs on your machine, reads the public chain, and cannot spend a single Luna.

```
you:      "How much came in last month, and who from?"
you:      "Draft a request for 25 NIM for the September retainer."
you:      "Has anyone paid request a1b2c3d4e5 yet?"
```

---

## What it is not

This is the part to read first.

- **It never signs anything.** There is no key handling in this package at all — nothing
  generates, stores, reads, derives or asks for a private key, a seed phrase or a
  passphrase. `create_payment_request` returns a *link*. A link is a request. Only the
  payer's wallet can move money, and only when its owner approves the payment there.
- **It never sends anything.** No transaction is built, broadcast or queued. Nothing is
  marked paid — not on chain, and not in your app's own books.
- **It has no server.** The only hosts this process contacts are `rpc.nimiqwatch.com`
  (the public Nimiq RPC the NimBooks app already uses) and `api.coingecko.com` (public
  daily prices, for statements). It never calls `nimbooks.subimpact.net`. The links it
  mints *contain* that address, the way a printed invoice carries a street address —
  that is data, not a request.
- **It writes nothing.** Every tool is a read or a pure function. The backup file you
  point it at is opened read-only.
- **It is not a wallet, and not a replacement for one.** It reads what the chain already
  says in public about an address you name.

Not sure? The whole server is five files under `src/`, about 1,600 lines. `src/index.ts`
is the tool surface; there is nothing else to audit.

---

## Setup

Node 20 or newer. Nothing to clone — from npm:

```bash
npx -y nimbooks-mcp --help
```

Or from source, if you would rather build and audit it yourself:

```bash
git clone https://github.com/subimpact/nimbooks
cd nimbooks/mcp
npm install
npm run build     # → dist/index.js
```

### Claude Desktop

`claude_desktop_config.json` → Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "nimbooks": {
      "command": "npx",
      "args": [
        "-y", "nimbooks-mcp",
        "--address", "NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX"
      ]
    }
  }
}
```

Restart Claude Desktop. The six tools appear under the tools icon.

### Claude Code

```bash
claude mcp add nimbooks -- npx -y nimbooks-mcp \
  --address "NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX"
```

Built from source instead? Point both commands at
`node /absolute/path/to/nimbooks/mcp/dist/index.js` in place of `npx -y nimbooks-mcp`.

### Options

| Flag | What it does |
| --- | --- |
| `--address <NQ…>` | The account tools use when a call doesn't name one; the server tells the assistant about it, so questions like "how are my books looking?" work without repeating your address. Optional — every tool also takes an address argument. |
| `--backup <path>` | A NimBooks backup file. Only `list_invoices` needs it. |

**Getting a backup file:** the app keeps your payment requests on the device, not on a
server — so a file is the only way to show them here. In NimBooks: **Backup → Copy**,
then paste into a file, e.g. `~/nimbooks-backup.json`, and pass it with `--backup`.
Without it, `list_invoices` says so and points at `check_request_paid`, which asks the
chain instead.

> A backup also contains your cashlink shelf, and those entries hold the private keys of
> links that may still hold NIM. Keep the file as carefully as a wallet. This server never
> opens that part of it — not "reads it and drops the field": it is discarded at the door,
> and a test asserts it can never reach the output.

---

## The tools

| Tool | Answers |
| --- | --- |
| `get_summary` | Balance now, plus money in/out, fees, rewards and transaction counts over a window. |
| `list_transactions` | Classified rows — kind, direction, counterparty, memo, hash. |
| `get_statement` | Day-by-day in/out for a year or month, priced at each day's CoinGecko UTC close. |
| `create_payment_request` | **Drafts** a request and returns a shareable link. Signs nothing. |
| `check_request_paid` | Whether a payment tagged with a request's reference has landed. |
| `list_invoices` | Requests stored in your backup file. |

**Defaults and limits, stated plainly:**

- `get_summary` and `get_statement` read up to the newest **1000** transactions;
  `check_request_paid` scans the newest **200**. When a cap is hit, the answer says so.
- `get_summary` windows default to *all available history* → *now*. `since`/`until` take
  `YYYY-MM-DD` or ISO 8601, read as UTC.
- `list_transactions` returns 50 rows by default, 500 at most.
- Balance is the **live basic-account balance**, not the balance at the end of a window.
  Staked NIM lives in the staking contract, so it is reported separately.
- Statements exclude failed transactions, count fees on outgoing transactions only, and
  price each UTC day at that day's CoinGecko close. A day with no close available comes
  back `null` rather than a guess — and the USD *totals* are withheld entirely rather
  than summed from a partial year.
- **CoinGecko's public API only serves the last 365 days of prices.** Ask for an older
  year and the NIM figures are still exact, but the USD columns come back empty — and the
  answer says so, in those words. The NimBooks app has the same ceiling. A paid CoinGecko
  key would lift it; this server does not take one, because taking one would mean holding
  a credential.
- Addresses may be typed `NQ43 Y1RH …`, flat, lower-case, or as 40 hex characters. They
  are checksum-validated: a typo is refused, never quietly looked up.
- Amounts come back in both Luna (integer, exact) and NIM (exact decimal string). No
  float arithmetic touches money anywhere in this package.

---

## Example prompts

```
What's the balance, and how much came in during August?
Show me the last 20 transactions — anything that wasn't a plain payment?
Statement for September 2026, with the USD close for each day.
Draft a payment request for 12.5 NIM, memo "September retainer", expiring in 7 days.
Has request a1b2c3d4e5 been paid?
List my saved payment requests and tell me which are still open.
```

---

## Parity with the app

A link drafted here must be the same bytes the NimBooks app would have produced, or it
won't open when someone taps it. The test suite imports the app's *real*
`src/lib/invoice.ts` and compares the two encoders across every combination of amount
(`1`, `0.5`, `12.5`, `100000`, and `0.000001` — which both sides must *refuse*, being
finer than a Luna), memo (ASCII, emoji/CJK, none) and expiry (none, set), with and
without a named payer, then round-trips each link back through the app's own decoder.

Transaction classification is pinned the same way: against the app's `src/lib/chain.ts`,
row for row, including the cashlink tag ("Cashlink", not raw bytes), the
`nimbooks:invoice:<id>` reference, and the staking legs.

---

## Tests

```bash
npm test       # 46 tests, no network
npm run smoke  # opt-in: drives the built server against a live demo wallet
```

`npm test` covers invoice byte-parity, classification fixtures, statement aggregation
(also compared against the app's own `computeStatement`), backup parsing — including
malformed entries and the cashlink-secret fence — and a real stdio round trip through the
MCP SDK's own client, which is also the proof that stdout carries nothing but the
protocol, since a stray log line there would break the framing.

`npm run typecheck` covers `src/`. The tests are compiled by esbuild and validated by
running; they deliberately import the app's browser modules, which the app's own build
owns.

---

## Licence

MIT, same as NimBooks.

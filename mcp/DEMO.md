# Demo — nimbooks-mcp (16 Sep)

Three beats, about four minutes. The point to land: **your books, answerable in plain
language, and the assistant still cannot spend a single Luna.**

Demo wallet: `NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX`

## Before you start

```bash
cd mcp && npm install && npm run build
claude mcp add nimbooks -- node "$PWD/dist/index.js" \
  --address "NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX"
```

Have the NimBooks app open in a second window — beat 2 ends by pasting a link into it.

Sanity check right before you go on (~10 s, hits the live chain):

```bash
npm run smoke
```

---

## Beat 1 — "Where do I stand?"

> **Prompt:** *"How are my books looking this year? Balance, what came in, what went out."*

Calls `get_summary`. Expected shape:

```json
{
  "address": "NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX",
  "balanceLuna": "38200000",
  "balanceNim": "382",
  "staked": {
    "activeNim": "700.65888",
    "delegation": "NQ29 FBVT B4GM S27H UBP4 1MTC GNKQ VPBT 099M",
    "note": "Staked NIM sits in the staking contract, so it is not part of balanceLuna above."
  },
  "inNim": "1082", "outNim": "700", "netNim": "382",
  "txCount": 7, "inCount": 6, "outCount": 1
}
```

**Say:** the balance reads 382, but there are another 700 NIM staked — the app splits those
out because they live in the staking contract, and so does this. Nothing here is an
estimate: Luna are integers all the way through.

> **Follow-up:** *"Show me the last few transactions."*

Calls `list_transactions`. The row to point at is the cashlink:

```json
{ "kind": "payment", "direction": "received", "amountNim": "1",
  "counterparty": "NQ42 EEBN LRBV ACLQ K11Y BPUN 8PLA K3AB SMS3",
  "memo": "Cashlink",
  "timestamp": "2026-09-12T10:08:08.752Z",
  "hash": "7ddeed7ceb22a180f71f1fb62084a74ab2e67c8631403d29ccb9976915732897" }
```

**Say:** that memo is five bytes of protocol furniture on chain. The app names it
"Cashlink" rather than printing hex, and this server had to agree — the classification is
tested against the app's own module, row for row.

*(Optional, if there's time: "Statement for September, priced in dollars." → `get_statement`,
day rows with the CoinGecko UTC close for each day. Days with no close come back `null`
rather than a guess.)*

---

## Beat 2 — "Bill someone for it" *(the headline)*

> **Prompt:** *"Draft a payment request for 25 NIM, memo 'September retainer', expiring in a week."*

Calls `create_payment_request`:

```json
{
  "id": "demo123456",
  "link": "https://nimbooks.subimpact.net/#/invoice/eyJhcHAiOiJuaW1ib29rcyIsInYiOjEsImlkIjoiZGVtbzEyMzQ1NiIs…",
  "amountNim": "25",
  "amountLuna": "2500000",
  "payee": "NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX",
  "expiresAt": "2026-09-20T14:34:52.538Z",
  "onChainReference": "nimbooks:invoice:demo123456",
  "note": "Nothing was signed. This is a request, not a payment: only the payer’s wallet can move money, and only when its owner approves. Share the link; when it is paid, the payment carries the reference nimbooks:invoice:demo123456, and check_request_paid will find it."
}
```

**Now paste that link into the NimBooks app.** The request opens: 25 NIM, the memo, the
expiry, the QR. This is the beat — the link an assistant just wrote opens in the real app,
because the bytes are identical to what the app itself would have produced. There is a test
that holds that line across every amount, memo and expiry combination, encoding here and
decoding with the app's own module.

**Say, while it's on screen:** nothing was signed to make this. The whole request rides
inside the link — there is no server holding it, and this process has no key material of
any kind. The most it can do is ask.

---

## Beat 3 — "Did they pay?"

> **Prompt:** *"Has request 4u010r140g been paid?"*

Calls `check_request_paid`, which looks for the `nimbooks:invoice:<id>` reference in the
address's transactions — the same match the app uses to reconcile:

```json
{
  "paid": true,
  "id": "4u010r140g",
  "tx": {
    "hash": "3f77f5cfaa6576840483c2cff3dd112d1d2d6c3e5fd8fd0d2b4c7b1b7c8236b1",
    "amountNim": "50",
    "from": "NQ64 CNFM 19SU LHLT K5EN RLMG 8MMP 2H0S 02KK",
    "timestamp": "2026-09-10T02:00:04.873Z",
    "explorer": "https://nimiq.watch/#3f77f5cfaa6576840483c2cff3dd112d1d2d6c3e5fd8fd0d2b4c7b1b7c8236b1"
  },
  "note": "Reported from the public chain. This server does not mark anything paid — the app reconciles its own copy."
}
```

Then the one that didn't land:

> **Prompt:** *"What about demo123456?"* → `{ "paid": false, "scanned": 7, "note": "No payment tagged nimbooks:invoice:demo123456 was found…" }`

**Say:** it reports; it doesn't decide. Even here it won't mark anything paid — the app
reconciles its own books from the same chain data.

---

## The closing line

> Six tools. About 1,200 lines. It talks to exactly two hosts — the public Nimiq RPC and
> CoinGecko — and it has no key handling in it at all. The assistant can read your books
> and write you an invoice. It cannot move your money, and there is no code path in there
> by which it could learn how.

---

## If something goes sideways

| Symptom | What to do |
| --- | --- |
| Tools don't appear | Check the path in the client config is absolute and `dist/index.js` exists (`npm run build`). |
| "Could not reach the Nimiq RPC" | Network, or nimiqwatch rate-limiting. Wait a few seconds and re-ask — it retries once on its own. |
| `list_invoices` asks for a backup | Expected without `--backup`. Either skip that tool or pass `--backup mcp/test/fixtures/backup.json` for a canned one. |
| A day's `closeUsd` is `null` | CoinGecko had no close for that day. It is designed to say so rather than guess — that's a feature to name, not a bug to hide. |
| Live numbers differ from this file | The demo wallet is a real account; it moves. Shapes hold, figures won't. |

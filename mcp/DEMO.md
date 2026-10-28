# Demo: nimbooks-mcp

Three beats, about four minutes. The point to land: **your books, answerable in plain
language, and the assistant still cannot spend a single Luna.**

Demo wallet: `NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR` (the app's sample wallet since
v1.40.0: a live Nimiq Pay wallet staking with ImpactZero). Figures below were read live on
28 Oct 2026; the wallet is real and they move.

## Before you start

```bash
cd mcp && npm install && npm run build
claude mcp add nimbooks -- node "$PWD/dist/index.js" \
  --address "NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR"
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
  "address": "NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR",
  "balanceLuna": "400010",
  "balanceNim": "4.0001",
  "staked": {
    "activeNim": "7642.40622",
    "delegation": "NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY",
    "note": "Staked NIM sits in the staking contract, so it is not part of balanceLuna above."
  },
  "inNim": "69117.90486", "outNim": "69064.5124", "netNim": "53.39246",
  "rewardsReceivedNim": "49.39236",
  "txCount": 216, "inCount": 187, "outCount": 29
}
```

Note that the address is never spoken: `--address` is configured above, the server names it
in its instructions, and the tools use it when none is given. If you are running without a
default, name the address in this first question.

**Say:** the balance reads 4 NIM, but there are another 7,642 NIM staked. The app splits those
out because they live in the staking contract, and so does this. The 49 NIM of rewards are
validator payouts only: a stake made in Nimiq Pay shows up in the public rewards feed too,
and the server leaves it out, exactly as the app does. Nothing here is an estimate: Luna are
integers all the way through.

> **Follow-up:** *"Show me the last few transactions."*

Calls `list_transactions`. The row to point at is the swap:

```json
{ "kind": "swap", "direction": "sent", "amountNim": "6.01708",
  "counterparty": "NQ27 QCTR DRNT 1YF1 9E7F XTL1 7Q26 JF96 BENU",
  "timestamp": "2026-10-17T01:43:51.293Z",
  "hash": "1fe218c921b040fbae789820766d3dddcacb1489b940faf1616152192c01a8b5" }
```

**Say:** that is Nimiq Pay funding a swap contract, not a payment to someone. The app files
it as a swap rather than money spent, and this server had to agree: the classification is
tested against the app's own module, row for row. The rows around it are ordinary payments
with their memos as written ("nego thanked you on Cinima").

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
  "payee": "NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR",
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

**If anyone decodes the link on the spot:** the payload inside it has `amountNim` holding a
Luna figure (`2500000`) — that is the app's own link format, not a bug and not a 100,000×
overcharge. This tool's output reports `amountNim` in NIM and `amountLuna` in Luna.

**Say, while it's on screen:** nothing was signed to make this. The whole request rides
inside the link — there is no server holding it, and this process has no key material of
any kind. The most it can do is ask.

---

## Beat 3 — "Did they pay?"

> **Prompt:** *"Has request 4u010r140g to NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX been paid?"*

The sample wallet has no paid request of its own yet, so this beat names the former sample
wallet, which does. Calls `check_request_paid` with that `address`, and it looks for the
`nimbooks:invoice:<id>` reference in the address's transactions, the same match the app
uses to reconcile:

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

> **Prompt:** *"And the one you just drafted?"* → `{ "paid": false, "scanned": 176, "note": "No payment tagged nimbooks:invoice:<id> was found in the newest 176 transactions…" }`

**Say:** it reports; it doesn't decide. Even here it won't mark anything paid — the app
reconciles its own books from the same chain data.

---

## Beat 4 (optional): "What is my stake earning?"

> **Prompt:** *"What is my stake earning? Then: if I staked 1,000 NIM for 3 years, what might I earn?"*

Calls `get_staking`, then `project_yield`:

```json
{
  "staked": true,
  "activeNim": "7642.40622",
  "stakedNim": "7642.40622",
  "validator": {
    "address": "NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY",
    "name": "ImpactZero stake",
    "feePercent": 0,
    "netYieldPercent": 7.97,
    "compounds": true,
    "payout": "adds rewards to your stake",
    "buildersPool": true
  },
  "estimate": { "firstYearRewardsNim": 632.1585, "annualRatePercent": 7.97 }
}
```

**Say:** the balances are exact Luna from the chain; the pool's fee and yield come from the
same public validators list the app reads. The figure in `estimate` is labelled an estimate
and says its assumptions out loud: emission falling along the protocol's supply curve is
modelled, the network's total stake is held at today's level, and none of it is a promise.

The projection returns one row per year (rewards that year, cumulative, balance) and the
same three assumptions again, so the assistant cannot soften them away. No rate was passed,
so the tool says where the rate came from: `rateSource` reads "the median of producing
pools". Nothing in this beat signs or sends anything either: get_staking and project_yield
are reads and a pure calculation.

---

## The closing line

> Eleven tools. About 3,400 lines. It talks to exactly four hosts — the public Nimiq RPC,
> Nimiq Watch's rewards API, the validators list, and CoinGecko — and it has no key handling
> in it at all. The assistant can read your books
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

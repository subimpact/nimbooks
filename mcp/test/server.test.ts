// D. Server boot.
//
// Drives the real built server over real stdio, through the MCP SDK's own
// client. Three things this proves that a unit test cannot:
//
//   1. The tool surface is exactly the ten tools, with the limits stated in
//      their descriptions — that surface is the promise made to the assistant.
//   2. stdout carries nothing but the protocol. Any stray `console.log` in the
//      server would corrupt the JSON-RPC framing and every call below would
//      fail, so a green run here is the proof that logging stays on stderr.
//
//   3. A yield projection with an explicit rate is a pure calculation: the
//      server answers it with the validators gate on, where any fetch would
//      have to fail.
//
// Only pure tools are called: this whole file runs offline.

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { decodeInvoice as appDecodeInvoice } from '../../src/lib/invoice.ts'
import { projectStake as appProjectStake } from '../../src/lib/yieldCalc.ts'

const SERVER = resolve('dist/index.js')
const BACKUP = resolve('test/fixtures/backup.json')
const OWN = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'

const EXPECTED_TOOLS = [
  'check_request_paid',
  'create_payment_request',
  'get_rewards',
  'get_staking',
  'get_statement',
  'get_summary',
  'list_invoices',
  'list_transactions',
  'list_validators',
  'project_yield',
]

async function connect(args: string[] = []): Promise<Client> {
  const client = new Client({ name: 'nimbooks-mcp-test', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, ...args],
      stderr: 'ignore', // the server's own log lines; asserted on elsewhere
    })
  )
  return client
}

function text(result: any): string {
  return (result.content ?? []).map((c: any) => c.text ?? '').join('\n')
}

test('tools/list returns exactly the ten tools', async () => {
  const client = await connect(['--backup', BACKUP, '--address', OWN])
  try {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS)
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 40, `${tool.name} has a real description`)
      assert.ok(tool.inputSchema, `${tool.name} has an input schema`)
    }
    // A configured default is only usable if the assistant is told it exists —
    // otherwise it asks for an address the server already has.
    const instructions = client.getInstructions() ?? ''
    assert.match(instructions, /Configured default address: NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX/)
  } finally {
    await client.close()
  }
})

test('every tool description states the fence', async () => {
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      const d = tool.description ?? ''
      assert.match(d, /never signs|never sends|Read-only|read-only|DRAFTS/, `${tool.name}: ${d}`)
    }
    // The drafting tool has to be unmistakable about it.
    const draft = tools.find((t) => t.name === 'create_payment_request')!
    assert.match(draft.description!, /DRAFTS/)
    assert.match(draft.description!, /never signs/)
    assert.match(draft.description!, /only the payer’s wallet/)
    // The link's own amountNim field carries Luna (the app's format). Saying so
    // here is what stops a reader comparing it to this tool's NIM output and
    // calling a correct link a 100,000× overcharge.
    assert.match(draft.description!, /amountNim is denominated in Luna/)

    // With no --address, the instructions claim no default.
    assert.equal((client.getInstructions() ?? '').includes('Configured default address'), false)
  } finally {
    await client.close()
  }
})

test('create_payment_request drafts a link the app can open', async () => {
  const client = await connect(['--address', OWN])
  try {
    const result = await client.callTool({
      name: 'create_payment_request',
      arguments: { amountNim: '12.5', memo: 'September retainer ☕', id: 'a1b2c3d4e5', expiry: '7d' },
    })
    assert.notEqual(result.isError, true, text(result))
    const payload = JSON.parse(text(result))

    assert.equal(payload.id, 'a1b2c3d4e5')
    assert.equal(payload.amountNim, '12.5')
    assert.equal(payload.amountLuna, '1250000')
    assert.equal(payload.payee, OWN)
    assert.equal(payload.onChainReference, 'nimbooks:invoice:a1b2c3d4e5')
    assert.match(payload.note, /Nothing was signed/)
    assert.match(payload.note, /only the payer’s wallet can move money/)

    // The link is the deliverable: the app's own decoder has to accept it.
    assert.match(payload.link, /^https:\/\/nimbooks\.subimpact\.net\/#\/invoice\//)
    const encoded = payload.link.split('#/invoice/')[1]
    const decoded = appDecodeInvoice(encoded)
    assert.ok(decoded, 'the app decoded the minted link')
    assert.equal(decoded!.id, 'a1b2c3d4e5')
    assert.equal(decoded!.amountNim, '1250000')
    assert.equal(decoded!.memo, 'September retainer ☕')
    assert.equal(decoded!.payee, OWN.replace(/\s/g, ''))
    assert.ok(decoded!.expiresAt! > decoded!.createdAt)
  } finally {
    await client.close()
  }
})

test('a bad amount is a message, and the server stays up', async () => {
  const client = await connect(['--address', OWN])
  try {
    const bad = await client.callTool({
      name: 'create_payment_request',
      arguments: { amountNim: '0.000001' }, // finer than a Luna
    })
    assert.equal(bad.isError, true)
    assert.match(text(bad), /not an amount I can request/)

    // Still serving: the next call has to work on the same process.
    const good = await client.callTool({
      name: 'create_payment_request',
      arguments: { amountNim: '1', id: 'stillalive' },
    })
    assert.notEqual(good.isError, true, text(good))
    assert.equal(JSON.parse(text(good)).id, 'stillalive')
  } finally {
    await client.close()
  }
})

test('a mistyped address is refused with something the user can act on', async () => {
  const client = await connect()
  try {
    const res = await client.callTool({
      name: 'create_payment_request',
      arguments: { amountNim: '1', payee: 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGY' },
    })
    assert.equal(res.isError, true)
    assert.match(text(res), /checksum/i)

    // …and with no address at all, it says how to supply one.
    const none = await client.callTool({ name: 'create_payment_request', arguments: { amountNim: '1' } })
    assert.equal(none.isError, true)
    assert.match(text(none), /--address/)
  } finally {
    await client.close()
  }
})

test('list_invoices reads the backup when given one', async () => {
  const client = await connect(['--backup', BACKUP, '--address', OWN])
  try {
    const res = await client.callTool({ name: 'list_invoices', arguments: {} })
    assert.notEqual(res.isError, true, text(res))
    const payload = JSON.parse(text(res))
    assert.equal(payload.count, 4)
    assert.deepEqual(
      payload.invoices.map((i: any) => i.id),
      ['pend1ng001', 'pa1d000002', 'exp1red003', 'payer00004']
    )
    // Key material in that file is never read, so it can never come back out.
    assert.equal(text(res).includes('SECRET-MUST-NEVER-APPEAR-IN-OUTPUT'), false)
  } finally {
    await client.close()
  }
})

test('list_invoices without a backup says exactly how to make one', async () => {
  const client = await connect(['--address', OWN])
  try {
    const res = await client.callTool({ name: 'list_invoices', arguments: {} })
    assert.equal(res.isError, true)
    const msg = text(res)
    assert.match(msg, /Backup → Copy/)
    assert.match(msg, /--backup/)
    assert.match(msg, /check_request_paid/)
  } finally {
    await client.close()
  }
})

test('an unreadable backup path is reported, not swallowed', async () => {
  const client = await connect(['--backup', '/no/such/backup.json', '--address', OWN])
  try {
    const res = await client.callTool({ name: 'list_invoices', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(text(res), /Could not read the backup file/)
  } finally {
    await client.close()
  }
})

test('the statement tool refuses an impossible period without calling out', async () => {
  const client = await connect(['--address', OWN])
  try {
    const res = await client.callTool({ name: 'get_statement', arguments: { year: 1999 } })
    assert.equal(res.isError, true)
    assert.match(text(res), /not a year/)
  } finally {
    await client.close()
  }
})

// --- The 1.1 staking tools (offline paths only) ---

/** A server with an explicit environment, for the offline gates. */
async function connectWithEnv(env: Record<string, string>, args: string[] = []): Promise<Client> {
  const client = new Client({ name: 'nimbooks-mcp-test', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, ...args],
      env,
      stderr: 'ignore',
    })
  )
  return client
}

test('project_yield with an explicit rate is a pure, offline calculation', async () => {
  // The validators gate makes any fetch fail loudly, so a green run here is
  // the proof that an explicit rate never fetches.
  const client = await connectWithEnv({ NIMBOOKS_MCP_NO_VALIDATORS: '1', NIMBOOKS_MCP_NO_REWARDS: '1' })
  try {
    const res = await client.callTool({
      name: 'project_yield',
      arguments: { amountNim: '1000', annualRatePercent: 8.16, years: 1, compound: false },
    })
    assert.notEqual(res.isError, true, text(res))
    const payload = JSON.parse(text(res))
    assert.equal(payload.rateSource, 'you gave the rate')
    assert.equal(payload.ratePercent, 8.16)
    assert.equal(payload.compound, false)
    assert.equal(payload.totals.totalRewardsNim, 81.6)
    assert.equal(payload.amountNim, '1000')
    assert.equal(payload.amountLuna, '100000000')
    assert.equal(payload.perYear.length, 1)
    assert.equal(payload.perYear[0].cumulativeRewardsNim, 81.6)
    assert.equal(payload.perYear[0].balanceNim, 1000, 'simple: the balance stays the principal')
    
    assert.match(payload.assumptions.join(' '), /projection, not a promise/)
    assert.match(payload.assumptions.join(' '), /supply curve/)
    assert.match(payload.assumptions.join(' '), /total stake is held/)

    // Compounded over 3 years, the numbers are the app's own maths.
    const res3 = await client.callTool({
      name: 'project_yield',
      arguments: { amountNim: '1000', annualRatePercent: 8.16, years: 3, compound: true },
    })
    const payload3 = JSON.parse(text(res3))
    const app = appProjectStake({ principalNim: 1000, annualRateNow: 0.0816, months: 36, compound: true, now: Date.now() })
    assert.ok(
      Math.abs(payload3.totals.totalRewardsNim - Number(app.rewardsNim.toFixed(5))) <= 0.000001,
      `tool ${payload3.totals.totalRewardsNim} vs app ${app.rewardsNim}`
    )
    assert.ok(
      Math.abs(payload3.totals.balanceAtEndNim - Number(app.points[36].balanceNim.toFixed(5))) <= 0.000001
    )

    // The bounds: years must be 1 to 10, and the amount must parse.
    const y0 = await client.callTool({ name: 'project_yield', arguments: { amountNim: '1000', years: 0, annualRatePercent: 8 } })
    assert.equal(y0.isError, true)
    assert.match(text(y0), /years/)
    const y11 = await client.callTool({ name: 'project_yield', arguments: { amountNim: '1000', years: 11, annualRatePercent: 8 } })
    assert.equal(y11.isError, true)
    assert.match(text(y11), /years/)
    const bad = await client.callTool({ name: 'project_yield', arguments: { amountNim: 'abc' } })
    assert.equal(bad.isError, true)
    assert.match(text(bad), /not an amount I can project/)
    const rate0 = await client.callTool({ name: 'project_yield', arguments: { amountNim: '1000', annualRatePercent: 0 } })
    assert.equal(rate0.isError, true)
    assert.match(text(rate0), /more than 0 and at most 100/)
  } finally {
    await client.close()
  }
})

test('with the validators gate on, list_validators explains itself instead of crashing', async () => {
  const client = await connectWithEnv({ NIMBOOKS_MCP_NO_VALIDATORS: '1' }, ['--address', OWN])
  try {
    const res = await client.callTool({ name: 'list_validators', arguments: {} })
    assert.equal(res.isError, true, 'the gate routes through isError, not a crash')
    assert.match(text(res), /validators list/)
    assert.match(text(res), /annualRatePercent/, 'the answer suggests the offline path the tool has')
    // The server stays up for the next call.
    const again = await client.callTool({ name: 'list_validators', arguments: { limit: 5 } })
    assert.equal(again.isError, true)
  } finally {
    await client.close()
  }
})

test('project_yield needs a list for the typical rate, and says so', async () => {
  const client = await connectWithEnv({ NIMBOOKS_MCP_NO_VALIDATORS: '1' }, ['--address', OWN])
  try {
    const res = await client.callTool({ name: 'project_yield', arguments: { amountNim: '1000' } })
    assert.equal(res.isError, true)
    assert.match(text(res), /annualRatePercent|validators list/)
  } finally {
    await client.close()
  }
})

test('the server instructions mention the staking surface', async () => {
  const client = await connect()
  try {
    const instructions = client.getInstructions() ?? ''
    assert.match(instructions, /get_staking/)
    assert.match(instructions, /list_validators/)
    assert.match(instructions, /project_yield/)
    assert.match(instructions, /get_rewards/)
  } finally {
    await client.close()
  }
})

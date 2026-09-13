// D. Server boot.
//
// Drives the real built server over real stdio, through the MCP SDK's own
// client. Two things this proves that a unit test cannot:
//
//   1. The tool surface is exactly the six tools, with the limits stated in
//      their descriptions — that surface is the promise made to the assistant.
//   2. stdout carries nothing but the protocol. Any stray `console.log` in the
//      server would corrupt the JSON-RPC framing and every call below would
//      fail, so a green run here is the proof that logging stays on stderr.
//
// Only `create_payment_request` is called: it is a pure function, so this whole
// file runs offline.

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { decodeInvoice as appDecodeInvoice } from '../../src/lib/invoice.ts'

const SERVER = resolve('dist/index.js')
const BACKUP = resolve('test/fixtures/backup.json')
const OWN = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'

const EXPECTED_TOOLS = [
  'check_request_paid',
  'create_payment_request',
  'get_statement',
  'get_summary',
  'list_invoices',
  'list_transactions',
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

test('tools/list returns exactly the six tools', async () => {
  const client = await connect(['--backup', BACKUP, '--address', OWN])
  try {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS)
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 40, `${tool.name} has a real description`)
      assert.ok(tool.inputSchema, `${tool.name} has an input schema`)
    }
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

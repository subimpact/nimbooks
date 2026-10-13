// Live-RPC sanity for the supporters oracle. Node only, no browser. Talks to
// the real chain reader at rpc.nimiqwatch.com — expect no more than a couple
// of requests (paced).
//
// Usage: node test/live-supporters-sanity.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const BUNDLE = path.join(__dirname, 'tmp', 'supporters-bundle.cjs')
if (!fs.existsSync(BUNDLE)) {
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })
  execFileSync('npx', ['rolldown', 'functions/_lib/supporters.ts', '--format', 'cjs', '--platform', 'node', '--file', BUNDLE], { cwd: ROOT, stdio: 'inherit' })
}
const lib = require(BUNDLE)

;(async () => {
  const rows = await lib.fetchDonationRows()
  // Address never printed: only the summary leaves the server side.
  const summary = lib.summariseDonations(rows, lib.DONATION_ADDRESS)
  console.log(`rows read: ${rows.length}`)
  console.log(`donations: ${summary.count}`)
  console.log(`totalNim:  ${summary.totalNim}`)
  console.log('supporters:')
  for (const s of summary.supporters.slice(0, 10)) {
    console.log(`  - ${s.name}: ${s.amountNim} NIM (last ${new Date(s.lastAt).toISOString().slice(0, 10)})`)
  }

  const wool = summary.supporters[0]
  const okWool = wool && wool.name === 'Wool' && Math.abs(wool.amountNim - 21809.29948) < 1e-9
  const okTotal = Math.abs(summary.totalNim - 21809.29948) < 1e-6
  const okCount = summary.count === 1
  console.log(`\nWool 21,809.29948 NIM present: ${okWool ? 'yes' : 'NO'}`)
  console.log(`total is 21,809.29948 NIM (mining payouts excluded): ${okTotal ? 'yes' : 'NO'}`)
  console.log(`exactly one donation: ${okCount ? 'yes' : 'NO'}`)
  process.exit(okWool && okTotal && okCount ? 0 : 1)
})().catch((e) => {
  console.error('live sanity failed:', e.message)
  process.exit(1)
})
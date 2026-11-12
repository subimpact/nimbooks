// Oracle for tax CSV vendor formats and real transaction times.
// Run: node test/tax-csv-format-oracle.cjs
//
// Why: every export row read 00:00:00 because TaxLotRow kept only a day, so
// the real time was lost (and a raw seconds timestamp once produced 1970).
// Koinly now expects a Tag header with reward income, and Summ's current
// template has its own exact header plus a reference price so NIM is not
// valued at zero.
const { execSync } = require('child_process')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
const taxOut = path.join(os.tmpdir(), `tax-csv-engine-${process.pid}.cjs`)
const csvOut = path.join(os.tmpdir(), `tax-csv-formats-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/tax.ts --file ${taxOut} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })
execSync(`npx rolldown src/lib/taxCsv.ts --file ${csvOut} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

const { computeFifoGains } = require(taxOut)
const { buildTaxTransactionsCsv, buildTaxSummaryCsv } = require(csvOut)

const OWN = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const OTHER = 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB'
const OLD_DAY = '2018-07-27'
const REWARD_DAY = '2025-01-02'
const OLD_SECONDS = Date.parse(`${OLD_DAY}T12:34:56Z`) / 1000 // Nimiq 1.0 seconds
const REWARD_MS = Date.parse(`${REWARD_DAY}T05:06:07Z`)

const txs = [
  {
    hash: 'old-pow', sender: OTHER, recipient: OWN, value: String(100 * 1e5), fee: '0',
    timestamp: OLD_SECONDS, toType: 0, executionResult: true,
  },
  {
    hash: 'reward-2025', sender: OTHER, recipient: OWN, value: String(10 * 1e5), fee: '0',
    timestamp: REWARD_MS, toType: 0, executionResult: true, synthetic: 'reward',
  },
]
const prices = { [OLD_DAY]: 0.001, [REWARD_DAY]: 0.002 }
const report = computeFifoGains(txs, OWN, prices, 'usd', 1)

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

// Koinly: Tag header, reward tag, no UTC suffix, real times.
const koinly = buildTaxTransactionsCsv('koinly', report.rows, report.incomeRows, OWN, 'USD')
const koinlyLines = koinly.replace(/^\uFEFF/, '').split('\n')
const koinlyHeader = koinlyLines[0]
check('Koinly header has Tag', koinlyHeader.split(',').includes('Tag'), koinlyHeader)
check('Koinly header no longer has Label', !koinlyHeader.split(',').includes('Label'), koinlyHeader)
const rewardLine = koinlyLines.find((l) => l.includes('reward-2025'))
check('staking income row is tagged reward', !!rewardLine && rewardLine.split(',')[9] === 'reward', rewardLine)
check('Koinly dates have no UTC suffix', koinlyLines.slice(1).every((l) => !l.includes(' UTC')))
check('Koinly dates match YYYY-MM-DD HH:mm:ss', koinlyLines.slice(1).every((l) => DATE_RE.test(l.split(',')[0])), koinlyLines.slice(1).map((l) => l.split(',')[0]).join(' | '))
check('reward row carries its real 05:06:07 time', !!rewardLine && rewardLine.split(',')[0] === '2025-01-02 05:06:07', rewardLine && rewardLine.split(',')[0])

// Summ: exact current template, reference price and currency.
const SUMM_HEADER =
  'Timestamp (UTC),Type,Base Currency,Base Amount,Quote Currency (Optional),Quote Amount (Optional),Fee Currency (Optional),Fee Amount (Optional),From (Optional),To (Optional),Blockchain (Optional), ID (Optional),Description (Optional),Reference Price Per Unit (Optional),Reference Price Currency (Optional)'
const summ = buildTaxTransactionsCsv('cryptotaxcalculator', report.rows, report.incomeRows, OWN, 'USD')
const summLines = summ.split('\n')
check('Summ header equals the vendor template byte for byte', summLines[0] === SUMM_HEADER, summLines[0])
const summHeaders = summLines[0].split(',')
const refIdx = summHeaders.indexOf('Reference Price Per Unit (Optional)')
const refCurIdx = summHeaders.indexOf('Reference Price Currency (Optional)')
const summRows = summLines.slice(1)
check('Summ rows carry a reference price', summRows.length > 0 && summRows.every((l) => {
  const c = l.split(',')
  return c[refIdx] && Number(c[refIdx]) > 0
}), summRows.map((l) => l.split(',')[refIdx]).join(' | '))
check('Summ rows carry the report currency', summRows.every((l) => l.split(',')[refCurIdx] === 'USD'))
check('Summ old row keeps its 2018 date and real time', (() => {
  const row = summRows.find((l) => l.includes('old-pow'))
  return !!row && row.split(',')[0] === '2018-07-27 12:34:56'
})(), summRows.find((l) => l.includes('old-pow')))

// Summary: reproducibility fields.
const summary = buildTaxSummaryCsv(report, OWN, 'USD').replace(/^\uFEFF/, '')
const summaryLines = summary.split('\n')
const summaryHeader = summaryLines[0]
for (const col of ['method', 'price_source', 'fx_source', 'fx_fallback_days', 'app_version']) {
  check(`summary header has ${col}`, summaryHeader.includes(`"${col}"`), summaryHeader)
}
check('summary method is FIFO, single address', summary.includes('"FIFO, single address"'))
check('summary states the FX source', summary.includes('"none (USD)"'))
check('summary states the price source', summary.includes('"daily UTC close: DefiLlama, CoinGecko fallback"'))
check('summary carries app version', /"v\d+\.\d+\.\d+"/.test(summary), summary)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

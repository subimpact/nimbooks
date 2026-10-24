// Stake-link oracle: bundles src/lib/stakeLink.ts for node and checks the
// share-link parser and builder. No browser, no network.
// Usage: node test/stake-link-oracle.cjs
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = '/root/.hermes/cache/scratch/nb'
const OUT = path.join(OUT_DIR, 'stakeLink.cjs')
const IZ = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const IZ_FLAT = IZ.replace(/\s+/g, '')
const BAD = 'NQ00 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

fs.mkdirSync(OUT_DIR, { recursive: true })
execSync(`npx rolldown src/lib/stakeLink.ts --file ${OUT} --format cjs --platform node`, { cwd: ROOT, stdio: 'pipe' })
const { parseStakeLink, buildStakeLink } = require(OUT)

// 1. Bare route opens the panel with nothing filled in.
{
  const i = parseStakeLink('#/stake')
  check('bare #/stake parses', !!i)
  check('bare route: no amount, no validator, no warnings', i && i.amountLuna === null && i.validator === null && i.warnings.length === 0, JSON.stringify(i))
}

// 2. Amount only.
{
  const i = parseStakeLink('#/stake?amount=5')
  check('amount only: 5 NIM becomes 500,000 luna', i && i.amountLuna === 500000, JSON.stringify(i))
  const decimals = parseStakeLink('#/stake?amount=12.34567')
  check('amount: five decimals kept exactly', decimals && decimals.amountLuna === 1234567, JSON.stringify(decimals))
}

// 3. Validator spellings: spaced, flat and lowercase all clean to the same address.
for (const [label, encoded] of [
  ['spaced', encodeURIComponent(IZ)],
  ['flat', IZ_FLAT],
  ['lowercase', IZ_FLAT.toLowerCase()],
]) {
  const i = parseStakeLink(`#/stake?validator=${encoded}`)
  check(`validator ${label}: cleaned and kept`, i && i.validator === IZ_FLAT, JSON.stringify(i))
}

// 4. Bad checksum is dropped, warning included, the route still parses.
{
  const i = parseStakeLink(`#/stake?validator=${encodeURIComponent(BAD)}`)
  check('bad checksum: validator dropped', i && i.validator === null, JSON.stringify(i))
  check('bad checksum: warning says so', i && i.warnings.some((w) => /validator/i.test(w)), JSON.stringify(i && i.warnings))
}

// 5. Bad amounts are dropped with a warning.
for (const amount of ['0', '-1', '1.123456', 'abc', '21000000001']) {
  const i = parseStakeLink(`#/stake?amount=${encodeURIComponent(amount)}`)
  check(`bad amount ${amount}: dropped`, i && i.amountLuna === null, JSON.stringify(i))
  check(`bad amount ${amount}: warning`, i && i.warnings.some((w) => /amount/i.test(w)), JSON.stringify(i && i.warnings))
}
check('amount at the 21 billion NIM supply cap is accepted', parseStakeLink('#/stake?amount=21000000000')?.amountLuna === 2100000000000000)
check('amount just above the cap is dropped', parseStakeLink('#/stake?amount=21000000001')?.amountLuna === null)

// 6. Other routes never parse as a stake link.
for (const hash of ['#/verify', '#/verify/abc', '#/invoice/abc', '', '#/stake/', '#/staking']) {
  check(`non-stake hash ${JSON.stringify(hash)} returns null`, parseStakeLink(hash) === null)
}

// 7. Build and round trip.
{
  const link = buildStakeLink({ amountNim: 12.34567, validator: ` ${IZ.toLowerCase()} ` })
  const url = new URL(link)
  check('built link points at the public site', link.startsWith('https://nimbooks.subimpact.net/#/stake'), link)
  check('built link carries amount and clean validator', link.includes('amount=12.34567') && link.includes(`validator=${IZ_FLAT}`), link)
  const round = parseStakeLink(url.hash)
  check('round trip: amount', round && round.amountLuna === 1234567, JSON.stringify(round))
  check('round trip: validator', round && round.validator === IZ_FLAT, JSON.stringify(round))
  check('round trip: no warnings', round && round.warnings.length === 0, JSON.stringify(round))
}

check('bare build link', buildStakeLink() === 'https://nimbooks.subimpact.net/#/stake', buildStakeLink())
check('build drops an invalid amount', buildStakeLink({ amountNim: 0 }) === 'https://nimbooks.subimpact.net/#/stake', buildStakeLink({ amountNim: 0 }))
check('build drops an invalid validator', buildStakeLink({ validator: BAD }) === 'https://nimbooks.subimpact.net/#/stake', buildStakeLink({ validator: BAD }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

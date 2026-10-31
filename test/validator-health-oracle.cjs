// Validator health oracle: bundles src/lib/validatorHealth.ts for node and pins
// the rules that decide what the Earn card says about the user's own pool.
// All of them come from core-rs-albatross, not from taste:
//   - retired beats everything (a retired validator also keeps jailedFrom),
//   - a jail lasts JAIL_EPOCHS (8) epochs of 43,200 blocks and jailedFrom is
//     not cleared afterwards, so an old value is not a jail,
//   - a non-null inactivityFlag is a deactivated validator,
//   - no record and a failed read are never "ok".
// Usage: node test/validator-health-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'validatorHealth.ts')
const OUT = path.join(ROOT, 'test', 'tmp', 'vh.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

fs.mkdirSync(path.dirname(OUT), { recursive: true })
execFileSync(ROLLDOWN, [SRC, '--file', OUT, '--format', 'cjs', '--platform', 'node'], { stdio: 'ignore' })
const {
  classifyValidatorHealth,
  validatorHealthLine,
  jailEndsAt,
  jailLeftLabel,
  BLOCKS_PER_EPOCH,
  JAIL_EPOCHS,
  VALIDATOR_HEALTH_INFO,
} = require(OUT)

const HEAD = 65_632_474
const CLEAN = { inactivityFlag: null, retired: false, jailedFrom: null }

// 1. A healthy pool: every flag null/false.
{
  const h = classifyValidatorHealth(CLEAN, HEAD)
  check('all null: ok', h.status === 'ok', JSON.stringify(h))
  check('all null: no jail block or time', h.jailEndsBlock === null && h.jailEndsMs === null, JSON.stringify(h))
  check('all null: not stale', h.stale === false)
  const line = validatorHealthLine(h, 'ImpactZero')
  check('ok line: active and not jailed, muted, no button',
    line && line.tone === 'ok' && line.text === 'Validator is active and not jailed.' && !line.unstake,
    JSON.stringify(line))
}

// 2. A deactivated validator (inactivityFlag set): earns nothing until back.
{
  const h = classifyValidatorHealth({ ...CLEAN, inactivityFlag: HEAD - 5000 }, HEAD)
  check('inactivityFlag set: inactive', h.status === 'inactive', JSON.stringify(h))
  const line = validatorHealthLine(h, 'ImpactZero')
  check('inactive line: names the pool, warns, says the NIM is safe',
    line && line.tone === 'warn' &&
    line.text === 'ImpactZero is inactive, so your stake earns nothing until it comes back. Your NIM is safe.',
    JSON.stringify(line))
}

// 3. Retired beats jailed (a retired validator's record keeps the old jail).
{
  const jailed = { inactivityFlag: null, retired: true, jailedFrom: HEAD - 100 }
  const h = classifyValidatorHealth(jailed, HEAD)
  check('retired true: retired even when also jailed', h.status === 'retired', JSON.stringify(h))
  check('retired: no jail window reported', h.jailEndsBlock === null && h.jailEndsMs === null, JSON.stringify(h))
  const line = validatorHealthLine(h, 'ImpactZero')
  check('retired line: says it has retired and carries the way out',
    line && line.tone === 'warn' && line.unstake === true &&
    line.text === 'ImpactZero has retired, so your stake no longer earns. Unstake to move it.',
    JSON.stringify(line))
}

// 4. A recent jail: jailed, with the right end block and time left.
{
  const jailedFrom = HEAD - 10_000
  const h = classifyValidatorHealth({ ...CLEAN, jailedFrom }, HEAD)
  const wantEnd = jailedFrom + JAIL_EPOCHS * BLOCKS_PER_EPOCH + 1
  check('recent jail: jailed', h.status === 'jailed', JSON.stringify(h))
  check('recent jail: end block is jailedFrom + 8 * 43200 + 1', h.jailEndsBlock === wantEnd, `${h.jailEndsBlock} vs ${wantEnd}`)
  check('recent jail: about one block per second left',
    h.jailEndsMs === (wantEnd - HEAD) * 1000, `${h.jailEndsMs} ms`)
  check('jailEndsAt helper agrees', jailEndsAt(jailedFrom) === wantEnd)
  const line = validatorHealthLine(h, 'ImpactZero')
  // (8 * 43200 + 1 - 10000) blocks = 335,601 s = ~93 h: over 48 h, so days.
  check('long jail line: days, not hours', /is jailed for about 4 more days, so your stake earns nothing and unstaking waits until the jail ends\. Your NIM is safe\./.test(line.text), line.text)

  // Under 48 hours: hours.
  const short = classifyValidatorHealth({ ...CLEAN, jailedFrom: HEAD - (8 * BLOCKS_PER_EPOCH + 1) + 5 * 3600 }, HEAD)
  const shortLine = validatorHealthLine(short, 'ImpactZero')
  check('short jail line: hours when 5 h are left', /is jailed for about 5 more hours, /.test(shortLine.text), shortLine.text)
  check('jail left label: 1 hour is singular', jailLeftLabel(3_600_000) === '1 more hour', jailLeftLabel(3_600_000))
  check('jail left label: no time left says nothing', jailLeftLabel(0) === null && jailLeftLabel(null) === null)
  check('jail line without a height still names the jail',
    /is jailed, so your stake earns nothing and unstaking waits until the jail ends\./.test(
      validatorHealthLine(classifyValidatorHealth({ ...CLEAN, jailedFrom }, 0), 'ImpactZero').text
    ))
}

// 5. jailedFrom older than the 8 epochs: the field lingers, the jail is over.
{
  const old = HEAD - (JAIL_EPOCHS * BLOCKS_PER_EPOCH + 2)
  const h = classifyValidatorHealth({ ...CLEAN, jailedFrom: old }, HEAD)
  check('jail longer ago than 8 epochs: ok', h.status === 'ok', JSON.stringify(h))
}

// 6. The boundary: the block the jail ends at is the first free one.
{
  const jailedFrom = HEAD - 1000
  const ends = jailEndsAt(jailedFrom)
  const before = classifyValidatorHealth({ ...CLEAN, jailedFrom }, ends - 1)
  const at = classifyValidatorHealth({ ...CLEAN, jailedFrom }, ends)
  check('one block before the end: still jailed', before.status === 'jailed', JSON.stringify(before))
  check('exactly at the end block: ok, not jailed', at.status === 'ok', JSON.stringify(at))
}

// 7. No record (the RPC says the address is not a validator): unknown.
{
  const h = classifyValidatorHealth(null, HEAD)
  check('null record: unknown, never ok', h.status === 'unknown', JSON.stringify(h))
  check('null record: no line to show', validatorHealthLine(h, 'ImpactZero') === null)
}

// 8. A failed read: the previous answer is kept, marked stale, and nothing
//    claims a fresh ok. An unknown with nothing behind it stays silent.
{
  const staleOk = { ...classifyValidatorHealth(CLEAN, HEAD), stale: true }
  const line = validatorHealthLine(staleOk, 'ImpactZero')
  check('stale ok: says the check failed instead of claiming ok',
    line && line.text === 'Could not check the validator right now.' && !/active and not jailed/.test(line.text),
    JSON.stringify(line))
  const staleUnknown = { ...classifyValidatorHealth(null, HEAD), stale: true }
  check('stale unknown: the failure line, once a read existed',
    validatorHealthLine(staleUnknown, 'ImpactZero')?.text === 'Could not check the validator right now.')
  const staleJailed = { ...classifyValidatorHealth({ ...CLEAN, jailedFrom: HEAD - 100 }, HEAD), stale: true }
  check('stale jailed: keeps the warning, which is the safe direction',
    validatorHealthLine(staleJailed, 'ImpactZero')?.status === 'jailed')
}

// 9. Copy rules: no em dash or en dash anywhere the user can read it.
{
  const texts = []
  for (const rec of [
    CLEAN,
    { ...CLEAN, inactivityFlag: 1 },
    { ...CLEAN, retired: true },
    { ...CLEAN, jailedFrom: HEAD - 10_000 },
    null,
  ]) {
    const line = validatorHealthLine(classifyValidatorHealth(rec, HEAD), 'ImpactZero')
    if (line) texts.push(line.text)
  }
  texts.push(VALIDATOR_HEALTH_INFO)
  check('no em dash or en dash in the user-visible copy', texts.every((t) => !/[\u2013\u2014]/.test(t)), texts.join(' | '))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

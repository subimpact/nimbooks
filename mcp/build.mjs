// Build: esbuild, two targets.
//
//   node build.mjs          → dist/index.js      (the server, bin entry)
//   node build.mjs --tests  → dist-test/*.js     (tests + the live smoke)
//
// Runtime dependencies stay external — the point of this package is that it is
// small and auditable, and a bundled copy of the MCP SDK is neither. The test
// build is the one place a bundle happens: it pulls in the *app's* own
// `src/lib/invoice.ts` (outside this package) so the parity test can compare
// this server's link encoding against the real thing.

import { build } from 'esbuild'
import { chmodSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const tests = process.argv.includes('--tests')

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
}

if (tests) {
  const entries = readdirSync('test')
    .filter((f) => f.endsWith('.test.ts') || f === 'smoke.ts')
    .map((f) => join('test', f))
  await build({
    ...common,
    entryPoints: entries,
    outdir: 'dist-test',
    // The app's invoice and chain modules are bundled in on purpose (see
    // above); the MCP SDK and zod are not.
    packages: 'external',
    // The app's chain.ts reaches the EVM side through `import('./evm')`, which
    // would drag viem into a test that never calls it. The tests only touch
    // the Nimiq functions, so the branch stays unresolved.
    external: ['./evm'],
  })
} else {
  await build({
    ...common,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    packages: 'external',
    banner: { js: '#!/usr/bin/env node' },
  })
  // `bin` is run directly by MCP clients, so the shebang needs the bit to match.
  chmodSync('dist/index.js', 0o755)
}

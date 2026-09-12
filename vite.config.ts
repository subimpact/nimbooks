import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// @nimiq/core ships its wasm as an ES module import, which Vite only understands
// with this plugin (the library's own `./vite` export — no extra dependency).
// Only the lazily-imported Hub staking path pulls the wasm in; Pay users never
// download it. Named import on purpose: the package has no `"type": "module"`,
// so under NodeNext the default import resolves as a namespace (not callable)
// while the named export typechecks and is identical at runtime.
import { nimiq } from '@nimiq/core/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), nimiq()],
})

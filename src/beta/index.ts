// "New look (beta)" entry point. Everything beta lives behind this module and
// is reached only through a dynamic import() from App.tsx, so classic users
// (the default) download none of it: no Tailwind CSS, no Radix, no Lucide.
//
// Exports:
//   BetaShell             the sidebar + top bar + bottom tabs shell
//   BetaOverview          the Overview rebuilt on the kit (with the earn card)
//   BetaYieldCalculator   the calculator as a drawer / side sheet

import './beta.css'

export { default as BetaShell } from './BetaShell'
export { default as BetaOverview } from './BetaOverview'
export { default as BetaYieldCalculator } from './BetaYieldCalculator'
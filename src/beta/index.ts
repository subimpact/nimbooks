// "New look (beta)" entry point. Everything beta lives behind this module and
// is reached only through a dynamic import() from App.tsx, so classic users
// (the default) download none of it: no Tailwind CSS, no Radix, no vaul.
//
// Exports:
//   BetaEarnCard          the ported Earn card (same props as EarnCard)
//   BetaYieldCalculator   the ported calculator (same props as YieldCalculator)

import './beta.css'

export { default as BetaEarnCard } from './BetaEarnCard'
export { default as BetaYieldCalculator } from './BetaYieldCalculator'
// The sample wallet (demo mode): a public mainnet address the app reads from
// the chain, read-only. Its numbers are real chain state, not props.
//
// NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR: a live Nimiq Pay wallet staking with ImpactZero, so the demo
// shows Pay's internal transfers (HTLC hops), the Hide internal switch and
// staking rewards on real history. Keys are held by the owner.
//
// Until 2026-10-27 the sample wallet was NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX and came with a
// pre-signed receipt and a chain-paid request baked into localStorage. Both
// belonged to that address, so they were dropped with the switch; new ones
// signed on this address can be seeded here again.

export const DEMO_WALLET_ADDRESS = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'

/** Earlier sample-wallet addresses, still excluded from public wallet counts. */
export const FORMER_DEMO_WALLET_ADDRESSES = ['NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX']

/**
 * NimBooks onboarding tour — a pure, React-free state machine.
 *
 * The tour lives in the sample wallet (demo mode) only. It is a passive
 * walkthrough: every step advances on the coach card's Next button, nothing
 * on the screen is clickable while it runs, and the offer appears on every
 * single demo visit — nothing is persisted. Real connected wallets never see
 * it.
 */

export type TourPhase = 'idle' | 'offer' | 'active' | 'completed'

export type TourSpotlightId =
  | 'balance'
  | 'quick-send'
  | 'quick-receive'
  | 'request-tab'
  | 'history-tab'
  | 'receipts-tab'
  | 'stake'
  | 'export-tab'

export type TourStepDef = {
  id: string
  title: string
  body: string
  spotlights: readonly TourSpotlightId[]
  /** View to open when the step is entered (the App owns setView). */
  route?: 'dashboard' | 'history' | 'receipts' | 'request' | 'export'
  /** Primary button label; defaults to Next. */
  primaryLabel?: string
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'welcome',
    title: 'Your books, live from the chain',
    body: 'NimBooks reads your Nimiq wallet directly — balance, staking, and every payment, with fiat values in your currency.',
    spotlights: ['balance'],
    primaryLabel: 'Next',
  },
  {
    id: 'quick-send',
    title: 'Send NIM in one tap',
    body: 'The Send sheet asks your wallet for one confirmation - the amount is shown in your currency too.',
    spotlights: ['quick-send'],
    primaryLabel: 'Next',
  },
  {
    id: 'quick-receive',
    title: 'Receive NIM, or be paid',
    body: 'Hand over your address to anyone - or create a payment request link your customer pays, which reconciles itself the moment it lands on-chain. Cashlinks put the NIM inside a link anyone can claim.',
    spotlights: ['quick-receive'],
    primaryLabel: 'Next',
  },
  {
    id: 'request-tab',
    title: 'Requests live in their own tab',
    body: 'The Request tab is where your payment-request links and QR codes are made and tracked, until they settle.',
    spotlights: ['request-tab'],
    route: 'request',
    primaryLabel: 'Next',
  },
  {
    id: 'history-tab',
    title: 'Every payment, tagged',
    body: 'History covers sends, receives, staking rewards and relay hops, each labelled and valued in your currency.',
    spotlights: ['history-tab'],
    route: 'history',
    primaryLabel: 'Next',
  },
  {
    id: 'receipts-tab',
    title: 'Prove any payment',
    body: 'You can sign any real transfer as a verified receipt - share the verification link and anyone can check it forever.',
    spotlights: ['receipts-tab'],
    route: 'receipts',
    primaryLabel: 'Next',
  },
  {
    id: 'stake',
    title: 'Make your NIM work',
    body: 'Delegate to a validator and earn rewards - they show up in Overview as income, and you can unstake anytime.',
    spotlights: ['stake'],
    primaryLabel: 'Next',
  },
  {
    id: 'export-tab',
    title: 'Your books, exported',
    body: 'Download your statement or full CSV in one tap - no third party, no server copy. The file is yours.',
    spotlights: ['export-tab'],
    route: 'export',
    primaryLabel: 'Next',
  },
  {
    id: 'done',
    title: "That's it!",
    body: 'The books keep themselves. Reach out on X or Telegram if you have feedback.',
    spotlights: [],
    primaryLabel: 'Done',
  },
] as const

export type TourRuntimeState = {
  phase: TourPhase
  stepIndex: number
}

export const TOUR_STEP_COUNT = TOUR_STEPS.length

/** Pure, React-free — safe to call from anywhere. */
export function tourStepAt(index: number): TourStepDef | null {
  return TOUR_STEPS[index] ?? null
}

export function startTour(state: TourRuntimeState): TourRuntimeState {
  return { ...state, phase: 'active', stepIndex: 0 }
}

export function offerTour(state: TourRuntimeState): TourRuntimeState {
  return { ...state, phase: 'offer', stepIndex: 0 }
}

export function dismissOffer(state: TourRuntimeState): TourRuntimeState {
  return { ...state, phase: 'idle', stepIndex: 0 }
}

export function skipTour(state: TourRuntimeState): TourRuntimeState {
  return { ...state, phase: 'idle', stepIndex: 0 }
}

export function completeTour(state: TourRuntimeState): TourRuntimeState {
  return { ...state, phase: 'completed', stepIndex: 0 }
}

/** Advance on the primary button. */
export function advanceNext(state: TourRuntimeState): TourRuntimeState {
  if (state.phase !== 'active') return state
  const next = state.stepIndex + 1
  if (next >= TOUR_STEPS.length) return completeTour(state)
  return { ...state, stepIndex: next }
}

/**
 * NimBooks onboarding tour — a pure, React-free state machine.
 *
 * A step table drives everything: each step carries copy, zero or more
 * spotlight targets, and how it advances. Spotlights are inert when the tour
 * is not on their step (the host renders them as a plain element), and
 * `action` steps only move forward when the user really performs the action
 * (reported via reportTourAction), not by tapping Next.
 *
 * Persistence is per address; force-arm is a sessionStorage escape hatch so
 * the tour can be replayed for demos.
 */

export type TourPhase = 'idle' | 'offer' | 'active' | 'completed'
export type TourStepAdvance = 'next' | 'action'
export type TourPersistedStatus = 'never' | 'dismissed' | 'completed'

export type TourSpotlightId =
  | 'balance'
  | 'quick-send'
  | 'send-sheet'
  | 'request-tab'
  | 'history-tab'
  | 'receipts-tab'
  | 'stake'
  | 'export-tab'

export type TourAction = 'open-send'

export type TourStepDef = {
  id: string
  title: string
  body: string
  /** Shown in the coach card as an amber action line. */
  actionText?: string
  spotlights: readonly TourSpotlightId[]
  /** View to open when the step is entered (the App owns setView). */
  route?: 'dashboard' | 'history' | 'receipts' | 'request' | 'export'
  advance: TourStepAdvance
  /** For action steps, the action id that must be reported to advance. */
  action?: TourAction
  /** Primary button label; defaults to Next. */
  primaryLabel?: string
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'welcome',
    title: 'Your books, live from the chain',
    body: 'NimBooks reads your Nimiq wallet directly — balance, staking, and every payment, with fiat values in your currency.',
    spotlights: ['balance'],
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'quick-send',
    title: 'Send NIM in one tap',
    body: 'The Send sheet asks your wallet for one confirmation - the amount is shown in your currency too.',
    actionText: 'Tap Send NIM to open the sheet.',
    spotlights: ['quick-send'],
    advance: 'action',
    action: 'open-send',
  },
  {
    id: 'send-sheet',
    title: 'Or send a claimable link',
    body: 'A cashlink puts the NIM inside a link anyone can claim. Useful when the other party has no wallet yet.',
    spotlights: ['send-sheet'],
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'request-tab',
    title: 'Ask for payment with a link',
    body: 'A payment request is a shareable link or QR your customer pays - it reconciles itself the moment it lands on-chain.',
    spotlights: ['request-tab'],
    route: 'request',
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'history-tab',
    title: 'Every payment, tagged',
    body: 'History covers sends, receives, staking rewards and relay hops, each labelled and valued in your currency.',
    spotlights: ['history-tab'],
    route: 'history',
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'receipts-tab',
    title: 'Prove any payment',
    body: 'You can sign any real transfer as a verified receipt - share the verification link and anyone can check it forever.',
    spotlights: ['receipts-tab'],
    route: 'receipts',
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'stake',
    title: 'Make your NIM work',
    body: 'Delegate to a validator and earn rewards - they show up in Overview as income, and you can unstake anytime.',
    spotlights: ['stake'],
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'export-tab',
    title: 'Your books, exported',
    body: 'Download your statement or full CSV in one tap - no third party, no server copy. The file is yours.',
    spotlights: ['export-tab'],
    route: 'export',
    advance: 'next',
    primaryLabel: 'Next',
  },
  {
    id: 'done',
    title: "That's it!",
    body: 'The books keep themselves. Reach out on X or Telegram if you have feedback.',
    spotlights: [],
    advance: 'next',
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

export function isSpotlightActive(
  state: TourRuntimeState,
  id: TourSpotlightId
): boolean {
  if (state.phase !== 'active') return false
  const step = tourStepAt(state.stepIndex)
  return Boolean(step?.spotlights.includes(id))
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

/** Advance on the primary button — only valid for 'next' steps. */
export function advanceNext(state: TourRuntimeState): TourRuntimeState {
  if (state.phase !== 'active') return state
  const next = state.stepIndex + 1
  if (next >= TOUR_STEPS.length) return completeTour(state)
  return { ...state, stepIndex: next }
}

/**
 * Advance on a reported user action. Action steps (advance === 'action')
 * move forward ONLY when the reported action id matches the current step's
 * `action`; on any other step the report is a no-op.
 */
export function reportTourAction(
  state: TourRuntimeState,
  action: TourAction
): TourRuntimeState {
  if (state.phase !== 'active') return state
  const step = tourStepAt(state.stepIndex)
  if (!step || step.advance !== 'action') return state
  if (step.action !== action) return state
  const next = state.stepIndex + 1
  if (next >= TOUR_STEPS.length) return completeTour(state)
  return { ...state, stepIndex: next }
}

/** Decide whether to offer the tour given persisted status and force-arm. */
export function shouldOfferTour(opts: {
  status: TourPersistedStatus
  forceArmed: boolean
}): boolean {
  if (opts.forceArmed) return true
  return opts.status === 'never'
}

/** Normalise an address for use as a storage key (spaces stripped, upper). */
function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function tourStorageKey(address: string): string {
  return `nimbooks:tour:${normalizeAddress(address)}`
}

export type TourPersisted = 'dismissed' | 'completed'

export function loadTourStatus(address: string): TourPersistedStatus {
  try {
    const raw = localStorage.getItem(tourStorageKey(address))
    if (raw === 'dismissed' || raw === 'completed') return raw
    return 'never'
  } catch {
    return 'never'
  }
}

export function saveTourStatus(
  address: string,
  status: TourPersistedStatus
): void {
  try {
    const key = tourStorageKey(address)
    if (status === 'never') localStorage.removeItem(key)
    else localStorage.setItem(key, status)
  } catch {
    // Ignore quota / private mode
  }
}

const FORCE_TOUR_SESSION_KEY = 'nimbooks:forceTour'

export function armForceTour(): void {
  try {
    sessionStorage.setItem(FORCE_TOUR_SESSION_KEY, '1')
  } catch {
    // Ignore quota / private mode
  }
}

/** Reads AND removes the force-arm flag. */
export function consumeForceTour(): boolean {
  try {
    const v = sessionStorage.getItem(FORCE_TOUR_SESSION_KEY)
    if (!v) return false
    sessionStorage.removeItem(FORCE_TOUR_SESSION_KEY)
    return true
  } catch {
    return false
  }
}

export function isForceTourArmed(): boolean {
  try {
    return sessionStorage.getItem(FORCE_TOUR_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

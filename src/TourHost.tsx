import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  TOUR_STEP_COUNT,
  tourStepAt,
  type TourRuntimeState,
  type TourStepDef,
} from './lib/tour'

type Rect = { top: number; left: number; width: number; height: number; bottom: number } | null

function readRect(id: string): Rect {
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom }
}

/** A dock tab — put the coach card up top so it clears it. */
function isBottomSpotlight(id: string): boolean {
  return (
    id === 'request-tab' ||
    id === 'history-tab' ||
    id === 'receipts-tab' ||
    id === 'export-tab'
  )
}

function coachPlacement(step: TourStepDef | null, rect: Rect): 'top' | 'center' | 'bottom' {
  if (!step) return 'bottom'
  if (step.spotlights.length === 0) return 'center'
  // A dock tab sits low enough that the card belongs above it.
  if (step.spotlights.some((id) => isBottomSpotlight(id))) return 'top'
  if (rect && rect.bottom > window.innerHeight * 0.7) return 'top'
  return 'bottom'
}

function CoachCard({
  step,
  stepIndex,
  onNext,
  onSkip,
  onNavigate,
}: {
  step: TourStepDef
  stepIndex: number
  onNext: () => void
  onSkip: () => void
  onNavigate: (route: NonNullable<TourStepDef['route']>) => void
}) {
  const rect = useSpotlightRect(step)
  const placement = coachPlacement(step, rect)
  const primaryLabel = step.primaryLabel || 'Next'

  useEffect(() => {
    if (step.route) onNavigate(step.route)
  }, [step, onNavigate])

  // Escape skips the active tour (no persistence).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  return (
    <div className="tour-layer" data-tour-layer>
      <div className="tour-dim" />
      {rect && (
        <div
          className="tour-cutout"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
      <div
        className={`tour-coach tour-coach--${placement}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-coach-title"
      >
        <div className="tour-coach-card">
          <div className="tour-coach-top">
            <p className="tour-coach-step">
              {stepIndex + 1} / {TOUR_STEP_COUNT}
            </p>
            <button type="button" className="tour-coach-skip" onClick={onSkip}>
              Skip tour
            </button>
          </div>
          <h3 id="tour-coach-title">{step.title}</h3>
          <p>{step.body}</p>
          <button type="button" className="btn-primary" onClick={onNext}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Recompute the spotlight rect whenever the tour's step/phase changes. */
function useSpotlightRect(step: TourStepDef): Rect {
  const [rect, setRect] = useState<Rect>(null)
  const ids = useMemo(
    () => (step.spotlights.length ? step.spotlights[0] : null),
    [step]
  )
  useLayoutEffect(() => {
    if (!ids) {
      setRect(null)
      return
    }
    const recompute = () => setRect(clampRectForSystemBars(readRect(ids)))
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('orientationchange', recompute)
    // Re-read once the DOM settles (spotlighted element may mount late).
    const t = window.setTimeout(recompute, 120)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('orientationchange', recompute)
      window.clearTimeout(t)
    }
  }, [ids])
  return rect
}

/**
 * On edge-to-edge WebViews (Nimiq Pay renders under the system nav bar and
 * reports no safe-area inset) the bottom dock can sit behind the gesture bar,
 * so the raw rect of a dock tab lands in the hidden zone and the spotlight
 * ring glows around empty space. For normal-size targets, shift the cutout
 * up so it stays visible above the system bar; full-height sheets are left
 * untouched.
 */
function clampRectForSystemBars(r: Rect): Rect {
  if (!r) return r
  if (r.height > window.innerHeight * 0.6) return r
  const bottomClearance = 44
  const maxBottom = window.innerHeight - bottomClearance
  if (r.bottom <= maxBottom) return r
  const dy = r.bottom - maxBottom
  const top = Math.max(0, r.top - dy)
  return { top, left: r.left, width: r.width, height: r.height, bottom: top + r.height }
}

function OfferCard({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div className="tour-layer" data-tour-layer>
      <div className="tour-dim" />
      <div className="tour-centered" role="dialog" aria-modal="true" aria-labelledby="tour-offer-title">
        <div className="tour-offer-card">
          <h2 id="tour-offer-title">Take a quick tour of your books?</h2>
          <p>A 60-second walk through sending, requesting, staking and exporting.</p>
          <button type="button" className="btn-primary" onClick={onStart}>
            Let&apos;s go
          </button>
          <button type="button" className="btn-secondary" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TourHost({
  tour,
  onStart,
  onNext,
  onSkip,
  onDismiss,
  onNavigate,
}: {
  tour: TourRuntimeState
  onStart: () => void
  onNext: () => void
  onSkip: () => void
  onDismiss: () => void
  onNavigate: (route: 'dashboard' | 'history' | 'receipts' | 'request' | 'export') => void
}) {
  const step = tourStepAt(tour.stepIndex)

  // Route-step navigation: when an active step with a route is entered, tell
  // the App (which owns setView) to switch. Watches phase/stepIndex.
  useEffect(() => {
    if (tour.phase !== 'active' || !step?.route) return
    onNavigate(step.route)
  }, [tour.phase, tour.stepIndex, step, onNavigate])

  if (tour.phase === 'offer') {
    return <OfferCard onStart={onStart} onDismiss={onDismiss} />
  }

  if (tour.phase === 'active' && step) {
    return (
      <CoachCard
        step={step}
        stepIndex={tour.stepIndex}
        onNext={onNext}
        onSkip={onSkip}
        onNavigate={onNavigate}
      />
    )
  }

  return null
}

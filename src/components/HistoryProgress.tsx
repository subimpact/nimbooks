// One-line progress for the light-client history load.
//
// The app opens immediately and cached rows stay on screen; this line only
// explains the wait. It is mounted on the dashboard (above the balance) and at
// the top of History, driven by the status store in lib/lightHistory.ts.
//
// `active` is the app's existing history-load flag, so a warm-up that is
// running before history starts (the connect handshake) does not paint a line
// on an unrelated screen. `done` outlives the load for two seconds, then hides;
// `failed` stays until the user retries or the next load replaces it.

import { useEffect, useRef, useState } from 'react'
import {
  getLightStatus,
  subscribeLightStatus,
  type LightStatus,
} from '../lib/lightHistory'

const ACTIVE_PHASES = new Set<LightStatus['phase']>([
  'downloading',
  'connecting',
  'loading',
  'older',
  'fallback',
])

const DONE_VISIBLE_MS = 2000

function progressCopy(status: LightStatus, lang: string): string {
  switch (status.phase) {
    case 'downloading':
      return 'Downloading the Nimiq network client (first visit only)…'
    case 'connecting':
      return 'Connecting to the Nimiq network…'
    case 'loading':
      return status.rows > 0
        ? `Loading your history: ${status.rows.toLocaleString(lang)} transactions so far`
        : 'Loading your history…'
    case 'older':
      return 'Fetching history from before Nov 2024…'
    case 'fallback':
      return "Loading from Nimiq's public node instead…"
    case 'done':
      return 'Up to date'
    case 'failed':
      return "Couldn't reach the Nimiq network."
    default:
      return ''
  }
}

export default function HistoryProgress({
  active,
  lang = 'en',
  onRetry,
}: {
  /** True while the current address's history load is in progress. */
  active: boolean
  lang?: string
  /** Re-runs the existing history load. Required for the failed state. */
  onRetry?: () => void
}) {
  const [status, setStatus] = useState<LightStatus>(getLightStatus)
  // Only a transition to done during this mount earns the two-second "Up to
  // date": mounting later must not replay it.
  const [doneVisible, setDoneVisible] = useState(false)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearDone = () => {
      if (doneTimer.current !== null) {
        clearTimeout(doneTimer.current)
        doneTimer.current = null
      }
    }
    const unsubscribe = subscribeLightStatus((next) => {
      setStatus(next)
      clearDone()
      if (next.phase === 'done') {
        setDoneVisible(true)
        doneTimer.current = setTimeout(() => {
          doneTimer.current = null
          setDoneVisible(false)
        }, DONE_VISIBLE_MS)
      } else {
        setDoneVisible(false)
      }
    })
    return () => {
      unsubscribe()
      clearDone()
    }
  }, [])

  const visible =
    status.phase === 'failed' ||
    (status.phase === 'done' ? doneVisible : ACTIVE_PHASES.has(status.phase) && active)

  if (!visible) return null

  const failed = status.phase === 'failed'
  return (
    <div
      className={failed ? 'history-progress history-progress-failed' : 'history-progress'}
      role="status"
      aria-live="polite"
    >
      <div className="history-progress-line">
        <span className="history-progress-text">{progressCopy(status, lang)}</span>
        {failed && onRetry && (
          <button type="button" className="history-progress-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      {!failed && (
        <span className="history-progress-track" aria-hidden="true">
          <span className="history-progress-bar" />
        </span>
      )}
    </div>
  )
}

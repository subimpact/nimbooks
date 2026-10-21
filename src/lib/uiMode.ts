// UI mode: the classic look stays the default; the shadcn-style "New look
// (beta)" is opt-in. Stored under nimbooks:ui (listed in PRIVACY.md).
// A tester's link can carry ?ui=beta or ?ui=classic in the query string or in
// the hash fragment; an override sets the stored value once, so the choice
// sticks for them afterwards.
//
// Switching notifies subscribers instead of reloading the page: the screens
// that can swap (Earn card, yield calculator) read the mode with useUiMode()
// and change in place, so a session keeps its state.

import { useSyncExternalStore } from 'react'

export type UiMode = 'beta' | 'classic'

const KEY = 'nimbooks:ui'

function store(mode: UiMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* storage unavailable */
  }
}

function readStored(): UiMode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'beta' || saved === 'classic') return saved
  } catch {
    /* storage unavailable */
  }
  return 'classic'
}

function scanForOverride(params: string): UiMode | null {
  try {
    const ui = new URLSearchParams(params).get('ui')
    return ui === 'beta' || ui === 'classic' ? ui : null
  } catch {
    return null
  }
}

/** A mode requested by the URL: `?ui=beta|classic`, in the query string or in the hash fragment. */
export function readUrlUiMode(): UiMode | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  return (
    scanForOverride(window.location.search) ??
    scanForOverride(hash.includes('?') ? hash.slice(hash.indexOf('?')) : '')
  )
}

// The URL override sets the stored value once, so a shared link flips a tester
// over and the choice holds on their next visit too.
const fromUrl = readUrlUiMode()
if (fromUrl) store(fromUrl)

const listeners = new Set<() => void>()

export function getUiMode(): UiMode {
  return readStored()
}

export function setUiMode(mode: UiMode) {
  store(mode)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook: re-renders in place when the mode flips, no reload. */
export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribe, getUiMode)
}
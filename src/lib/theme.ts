// Theme management: light/dark with localStorage persistence + system preference.
// Applies `data-theme` on <html>; CSS variables in App.css switch on it.

export type Theme = 'dark' | 'light'

const KEY = 'nimbooks:theme'

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage unavailable */
  }
  // Fall back to the OS preference
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  // Keep the browser chrome (scrollbars, form controls) in sync
  root.style.colorScheme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage unavailable */
  }
}

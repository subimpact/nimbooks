// Bottom-sheet drilldown shell, shared by every Analytics entry point (the
// daily-flow day sheet today, the stat sheets next). Keeping one shell means
// the sheets can't drift apart in chrome, dismissal or scroll behaviour.
//
// Rendered inline rather than through a portal: nothing between <body> and
// <section class="analytics"> establishes a containing block, so the fixed
// overlay still covers the viewport from here.

import { useEffect, type ReactNode } from 'react'
import { dialogFocus } from './lib/dialogFocus'

export default function DetailSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogFocus}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}

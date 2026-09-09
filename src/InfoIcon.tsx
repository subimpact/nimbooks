import { useId, useState } from 'react'

// Circle-with-i info button that toggles an inline explainer under the card
// label. Inline (not a tooltip) because tooltips don't exist on mobile, and
// the app's other help affordances ("What are these types?") use the same
// toggle pattern.
export default function InfoIcon({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="info-wrap">
      <button
        type="button"
        className="info-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? 'Hide explanation' : 'Show explanation'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open && (
        <span className="info-text" id={id}>
          {text}
        </span>
      )}
    </span>
  )
}

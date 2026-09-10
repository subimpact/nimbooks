import { useState } from 'react'

/**
 * Tiny dependency-free confetti burst. Renders ~48 colored pieces that
 * explode from the center of the modal and fall away, then unmounts.
 * Pure CSS animation — no canvas, no library, ~1KB.
 *
 * Pieces are generated once in a lazy state initializer (React 19 purity:
 * no Math.random inside render or useMemo).
 */
function makePieces() {
  return Array.from({ length: 48 }, (_, i) => {
    const angle = (i / 48) * Math.PI * 2 + Math.random() * 0.4
    const dist = 90 + Math.random() * 140
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 40
    const colors = ['#e9b949', '#f4d03f', '#27ae60', '#2ecc71', '#e74c3c', '#3498db', '#9b59b6']
    return {
      left: `${50 + (dx / 2.2)}%`,
      top: `${50 + (dy / 2.2)}%`,
      bg: colors[i % colors.length],
      rot: Math.random() * 360,
      delay: `${(Math.random() * 0.15).toFixed(2)}s`,
      dur: `${(0.9 + Math.random() * 0.7).toFixed(2)}s`,
      w: 6 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      round: Math.random() > 0.6,
      dx: `${(dx * 0.6).toFixed(0)}px`,
    }
  })
}

export default function Confetti() {
  const [pieces] = useState(makePieces)

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: p.left,
            top: p.top,
            background: p.bg,
            width: p.w,
            height: p.h,
            borderRadius: p.round ? '50%' : '2px',
            transform: `rotate(${p.rot}deg)`,
            ['--cf-dx' as string]: p.dx,
            animationDelay: p.delay,
            animationDuration: p.dur,
          }}
        />
      ))}
    </div>
  )
}

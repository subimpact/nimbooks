import { useEffect, useRef } from 'react'

// Nimiq brand palette (nimiq.com, 2026)
const NIMIQ = {
  cyan: { r: 12, g: 166, b: 254 }, // #0ca6fe
  teal: { r: 19, g: 181, b: 157 }, // #13b59d
  navy: { r: 31, g: 36, b: 72 }, // #1f2348
}

interface HexCell {
  x: number
  y: number
  size: number
  row: number
  col: number
  phase: number
  seed: number
}

interface Ripple {
  x: number
  y: number
  t0: number
}

interface Cursor {
  x: number
  y: number
  active: boolean
}

const TAU = Math.PI * 2
const SQRT3 = Math.sqrt(3)
// ~30 fps: the wave is slow, 60 fps only costs battery. The 2 ms of slack
// matters: at a strict 33.3 ms a 60 Hz display misses the gate on every
// second frame and the field aliases down to 20 fps.
const FRAME_MS = 1000 / 30 - 2

/**
 * Deterministic per-cell noise in [0, 1), hashed from the cell's (row, col)
 * and a salt. Math.random() would reshuffle every hexagon's size, phase and
 * seed each time the grid is rebuilt, so the whole field visibly jumps when
 * the mobile URL bar slides away; the hash keeps a rebuilt cell identical.
 */
function cellNoise(row: number, col: number, salt: number): number {
  let h = Math.imul(row + 0x9e3779b1, 0x85ebca6b)
  h = Math.imul(h ^ (col + 0x165667b1), 0xc2b2ae35)
  h = Math.imul(h ^ salt, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

function hexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number
) {
  // Flat-top hexagon, vertices at 0/60/120/180/240/300 degrees: the Nimiq
  // hexagon stands on its stable bottom edge, points left and right.
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6
    const px = cx + size * Math.cos(a)
    const py = cy + size * Math.sin(a)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  )
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Hero background for the landing (connect) screen. The concept is lifted
 * from base.org's hero: a full-viewport animated canvas where a grid of
 * cells carries tiers of intensity, a travelling wave sweeps through them,
 * the cursor boosts cells nearby, and clicks drop ripples. base.org draws
 * candlestick bars; NimBooks draws Nimiq hexagons in Nimiq's brand palette.
 *
 * Performance rules:
 *  - devicePixelRatio capped at 2 (the wave costs fill calls, not pixels).
 *  - Cells rebuilt on resize, debounced, from a (row, col) hash so a rebuild
 *    reproduces the same field instead of reshuffling it.
 *  - The loop paints at most ~30 fps. Per frame it still allocates the edge
 *    and veil gradients, the stroke/fill color strings and (while ripples
 *    live) a filtered ripple array. The hot part, the cell array, is built
 *    once per layout.
 *  - prefers-reduced-motion: one static frame, no rAF, no pointer handlers;
 *    it is repainted on theme change and after a resize.
 */
export default function HeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<Cursor>({ x: -1, y: -1, active: false })
  const rippleRef = useRef<Ripple[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let cells: HexCell[] = []
    let w = 0
    let h = 0
    let running = true
    let raf = 0
    let lastPaint = -Infinity // first frame paints without waiting on the cap
    let resizeTimer = 0

    const layout = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Hex size scales with the viewport: 24 on phones, 34 on desktop.
      const size = w < 640 ? 24 : w < 1280 ? 30 : 34
      // Column pitch of 1.5 * size against a full SQRT3 row pitch: closer
      // than a tiling honeycomb, so neighbours overlap and the field reads as
      // an interleaved star lattice rather than a seamless comb. Odd rows sit
      // half a column to the right, which is what braids the two grids.
      const xStep = size * 1.5
      const yStep = size * SQRT3

      cells = []
      // Half-cell offset + one extra ring: straight boundaries clip partial
      // hexes, and the edge fades (drawn per frame below) dissolve whatever
      // sticks out, so the field emerges from darkness instead of showing
      // sliced cells.
      const cols = Math.ceil(w / xStep) + 3
      const rows = Math.ceil(h / yStep) + 3
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = col * xStep + (row % 2 ? xStep / 2 : 0) - xStep / 2
          const cy = row * yStep - yStep / 2
          cells.push({
            x: cx,
            y: cy,
            size: size * (0.92 + cellNoise(row, col, 1) * 0.16),
            row,
            col,
            phase: cellNoise(row, col, 2) * TAU,
            seed: cellNoise(row, col, 3),
          })
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      cursorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, active: true }
    }
    const onLeave = () => {
      cursorRef.current.active = false
    }
    const onDown = (e: PointerEvent) => {
      // A modal or confirm sheet covers the field: its taps belong to it, and
      // a ripple nobody can see is pure work.
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('.modal-overlay, .confirm-overlay')) return
      const r = canvas.getBoundingClientRect()
      const ripple = { x: e.clientX - r.left, y: e.clientY - r.top, t0: performance.now() }
      rippleRef.current.push(ripple)
      if (rippleRef.current.length > 4) rippleRef.current.shift()
    }

    // Battery guard: a hidden tab paints nothing, so stop the loop while the
    // page is in the background (the mini app can stay mounted in the Pay
    // WebView for hours) and resume the moment it is visible again.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        raf = requestAnimationFrame(draw)
      }
    }

    // paint() renders exactly one frame and schedules nothing, so the static
    // (reduced-motion) path can call it without any risk of starting a loop.
    const paint = (now: number) => {
      const bg = hexToRgb(cssVar('--bg', '#0f1117')) ?? { r: 15, g: 17, b: 23 }
      const light = (bg.r + bg.g + bg.b) / 3 > 128
      // Nimiq cyan strokes; teal fills only where the wave crests.
      const cyan = light
        ? { r: 11, g: 127, b: 242 } // darker cyan for light backgrounds
        : NIMIQ.cyan
      const teal = light
        ? { r: 13, g: 138, b: 118 } // darker teal for light backgrounds
        : NIMIQ.teal

      ctx.clearRect(0, 0, w, h)

      const cursor = cursorRef.current
      const ripples = rippleRef.current
      const t = now

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]

        // Travelling wave: two superposed sines sweep diagonally and
        // horizontally; each cell also carries a static base so the field
        // never reads as a flat checkerboard.
        const w1 = 0.5 + 0.5 * Math.sin(t * 0.00035 + c.row * 0.55 + c.col * 0.32 + c.phase)
        const w2 = 0.5 + 0.5 * Math.sin(t * 0.00018 - c.col * 0.45 + c.phase * 1.7)
        let tier = 0.16 + 0.26 * c.seed + 0.5 * w1 + 0.34 * w2
        let boost = 0

        if (cursor.active && cursor.x >= 0) {
          const dx = c.x - cursor.x
          const dy = c.y - cursor.y
          const d2 = dx * dx + dy * dy
          if (d2 < 32400) {
            boost = 0.6 * Math.exp(-d2 / 9000) // ~180px falloff
          }
        }
        for (let r = 0; r < ripples.length; r++) {
          const rp = ripples[r]
          const age = (now - rp.t0) / 1000
          if (age > 1.4) continue
          const dx = c.x - rp.x
          const dy = c.y - rp.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const front = 60 + age * 260 // expanding ring
          const d = dist - front
          if (d > -46 && d < 60) {
            boost = Math.max(boost, 0.85 * (1 - Math.abs(d) / 60) * (1 - age / 1.4))
          }
        }

        tier = Math.max(0, Math.min(1, tier + boost))

        // Hex swells with its tier; the crest gets a teal fill, the body a
        // cyan stroke whose alpha follows the tier like a candlestick's
        // body thickness follows its price move.
        const s = c.size * (0.9 + 0.16 * tier)
        hexPath(ctx, c.x, c.y, s)

        const strokeA = 0.10 + 0.42 * tier
        ctx.strokeStyle = `rgba(${cyan.r},${cyan.g},${cyan.b},${strokeA.toFixed(3)})`
        ctx.lineWidth = 1 + tier
        ctx.stroke()

        if (tier > 0.55) {
          const fillA = (tier - 0.55) * 0.5
          ctx.fillStyle = `rgba(${teal.r},${teal.g},${teal.b},${fillA.toFixed(3)})`
          ctx.fill()
        }
      }

      // Edge fades: dissolve the clipped half-hexes at the four boundaries
      // into the page background, matching the NimTerra atlas pattern.
      const fade = 90
      const vGrad = ctx.createLinearGradient(0, 0, 0, fade)
      vGrad.addColorStop(0, `rgba(${bg.r},${bg.g},${bg.b},1)`)
      vGrad.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},0)`)
      ctx.fillStyle = vGrad
      ctx.fillRect(0, 0, w, fade)
      ctx.fillRect(0, h - fade, w, fade)
      const hGrad = ctx.createLinearGradient(0, 0, fade, 0)
      hGrad.addColorStop(0, `rgba(${bg.r},${bg.g},${bg.b},1)`)
      hGrad.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},0)`)
      ctx.fillStyle = hGrad
      ctx.fillRect(0, 0, fade, h)
      ctx.fillRect(w - fade, 0, fade, h)

      // Content veil: a soft center-weighted dim so the hexagons stay lively
      // around the edges but never fight the connect-panel text. Uses the
      // page background color, so it works in both themes.
      const veil = ctx.createRadialGradient(
        w / 2,
        h * 0.4,
        Math.min(w, h) * 0.15,
        w / 2,
        h * 0.4,
        Math.max(w, h) * 0.75
      )
      veil.addColorStop(0, `rgba(${bg.r},${bg.g},${bg.b},0.5)`)
      veil.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},0)`)
      ctx.fillStyle = veil
      ctx.fillRect(0, 0, w, h)

      // Drop old ripples.
      if (ripples.length) {
        rippleRef.current = ripples.filter((r) => (now - r.t0) / 1000 <= 1.4)
      }
    }

    // The rAF chain stays at display rate; painting is throttled to FRAME_MS.
    // Every wave term reads absolute `now`, so a skipped frame changes how
    // often the field is redrawn, never how fast it moves.
    const draw = (now: number) => {
      if (!running) return
      raf = requestAnimationFrame(draw)
      if (now - lastPaint < FRAME_MS) return
      lastPaint = now
      paint(now)
    }

    // Resizes arrive in bursts (a drag, the mobile URL bar). Rebuild once the
    // dust settles instead of once per event.
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        layout()
        if (reduce) paint(0)
      }, 150)
    }

    // Reduced motion means no loop, so nothing would ever repaint the static
    // frame in the new palette when the theme toggle flips `data-theme`.
    const themeObserver = reduce ? new MutationObserver(() => paint(0)) : null

    layout()

    if (reduce) {
      // One static frame at t = 0: base + seed only (waves are frozen).
      paint(0)
      running = false
      window.addEventListener('resize', onResize)
      themeObserver?.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
      })
    } else {
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerleave', onLeave)
      window.addEventListener('pointerdown', onDown, { passive: true })
      window.addEventListener('resize', onResize)
      document.addEventListener('visibilitychange', onVisibility)
      raf = requestAnimationFrame(draw)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      clearTimeout(resizeTimer)
      themeObserver?.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} className="hero-bg" aria-hidden="true" />
}

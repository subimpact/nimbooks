import type { ReactNode } from 'react'

// Inline sketches of the screens the feature explainers describe. Plain SVG
// shapes, no images and no network, coloured with the app's own variables so
// they follow the light and dark themes. Decorative only: the steps say the same
// thing in words. Motion lives in App.css (.la-grow, .la-pop, .la-dash) and runs
// only when the reader has not asked for reduced motion.

const W = 320
const H = 140

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg className="la" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <rect className="la-frame" x="0.5" y="0.5" width={W - 1} height={H - 1} rx="14" />
      {children}
    </svg>
  )
}

/** A fixed, deterministic 9x9 pattern that reads as a QR code at this size. */
function QrGlyph({ x, y, cell = 4 }: { x: number; y: number; cell?: number }) {
  const on = (r: number, c: number) => (r * 7 + c * 13 + r * c * 3) % 5 < 2
  let d = ''
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (on(r, c)) d += `M${x + c * cell} ${y + r * cell}h${cell}v${cell}h-${cell}z`
    }
  }
  return <path className="la-qr" d={d} />
}

function Balance() {
  return (
    <>
      <rect className="la-card" x="14" y="14" width="292" height="56" rx="12" />
      <text className="la-cap" x="28" y="31">Total value</text>
      <text className="la-big" x="28" y="60">€1,284.37</text>
      <rect className="la-chip" x="236" y="24" width="56" height="22" rx="11" />
      <circle className="la-eu" cx="249" cy="35" r="5.5" />
      <text className="la-chiptxt" x="258" y="38">EUR</text>
      <rect className="la-card" x="14" y="80" width="292" height="46" rx="12" />
      <text className="la-cap" x="28" y="97">NIM balance</text>
      <text className="la-txt" x="28" y="115">2,450 NIM</text>
      <rect className="la-gold la-grow" x="170" y="106" width="44" height="6" rx="3" />
      <rect className="la-green la-grow" x="216" y="106" width="52" height="6" rx="3" />
      <rect className="la-blue la-grow" x="270" y="106" width="22" height="6" rx="3" />
    </>
  )
}

function History() {
  const rows = [
    { tag: 'stake', cls: 'la-gold', amt: '-500 NIM' },
    { tag: 'swap', cls: 'la-blue', amt: '+12.5 NIM' },
    { tag: 'reward', cls: 'la-green', amt: '+0.84 NIM' },
    { tag: 'Cashlink', cls: 'la-gold', amt: '-40 NIM' },
  ]
  return (
    <>
      {rows.map((r, i) => {
        const y = 12 + i * 31
        return (
          <g key={r.tag}>
            <rect className="la-card" x="14" y={y} width="292" height="26" rx="9" />
            <rect className={`la-tag ${r.cls}`} x="24" y={y + 6} width="66" height="14" rx="7" />
            <text className="la-tagtxt" x="57" y={y + 16} textAnchor="middle">{r.tag}</text>
            <rect className="la-line-fill" x="100" y={y + 11} width={70 + (i % 2) * 30} height="4" rx="2" />
            <text className="la-txt" x="296" y={y + 17} textAnchor="end">{r.amt}</text>
          </g>
        )
      })}
    </>
  )
}

function Analytics() {
  const flow = [22, -12, 30, 8, -26, 16, 34, -10, 14]
  const internal = [0, 0, 14, 0, 20, 0, 0, 10, 0]
  const base = 88
  return (
    <>
      <rect className="la-pill la-pill-on" x="18" y="12" width="36" height="18" rx="9" />
      <text className="la-pilltxt la-onfill" x="36" y="24" textAnchor="middle">All</text>
      <rect className="la-pill" x="60" y="12" width="36" height="18" rx="9" />
      <text className="la-pilltxt" x="78" y="24" textAnchor="middle">30d</text>
      <rect className="la-pill" x="102" y="12" width="36" height="18" rx="9" />
      <text className="la-pilltxt" x="120" y="24" textAnchor="middle">7d</text>
      <rect className="la-pill" x="196" y="12" width="104" height="18" rx="9" />
      <text className="la-pilltxt" x="248" y="24" textAnchor="middle">Hide internal</text>
      <line className="la-axis" x1="16" y1={base} x2="304" y2={base} />
      {flow.map((v, i) => {
        const x = 22 + i * 32
        const h = Math.abs(v)
        const y = v >= 0 ? base - h : base
        const inner = internal[i]
        return (
          <g key={i}>
            {inner > 0 && (
              <rect className="la-ghost la-grow" x={x - 4} y={base - inner} width="26" height={inner} rx="3" />
            )}
            <rect
              className={`${v >= 0 ? 'la-green' : 'la-red'} la-grow`}
              x={x}
              y={y}
              width="18"
              height={h}
              rx="3"
            />
          </g>
        )
      })}
    </>
  )
}

function SendReceive() {
  return (
    <>
      <rect className="la-gold" x="24" y="22" width="130" height="38" rx="19" />
      <path className="la-arrow-on" d="M50 48v-12M45 41l5-5 5 5" />
      <text className="la-btntxt" x="66" y="46">Send NIM</text>
      <rect className="la-outline" x="166" y="22" width="130" height="38" rx="19" />
      <text className="la-btntxt la-ink" x="231" y="46" textAnchor="middle">Receive NIM</text>
      <rect className="la-card" x="24" y="76" width="272" height="30" rx="10" />
      <text className="la-soft-txt" x="38" y="95">Note (optional)</text>
      <rect className="la-line-fill" x="170" y="91" width="110" height="4" rx="2" />
      <text className="la-sub" x="24" y="124">Amount shown in your currency too</text>
    </>
  )
}

function Staking() {
  return (
    <>
      <rect className="la-card" x="14" y="10" width="292" height="28" rx="10" />
      <rect className="la-pinned" x="22" y="18" width="70" height="13" rx="6.5" />
      <text className="la-tagtxt la-onfill" x="57" y="28" textAnchor="middle">Builder</text>
      <rect className="la-line-fill" x="98" y="21" width="92" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="236" y="20" width="58" height="6" rx="3" />
      <rect className="la-card" x="14" y="44" width="292" height="28" rx="10" />
      <rect className="la-line-fill" x="26" y="55" width="110" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="236" y="54" width="40" height="6" rx="3" />
      <rect className="la-card" x="14" y="78" width="292" height="28" rx="10" />
      <rect className="la-line-fill" x="26" y="89" width="84" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="236" y="88" width="24" height="6" rx="3" />
      <text className="la-cap" x="20" y="124">Cooling down</text>
      <rect className="la-track" x="20" y="128" width="280" height="6" rx="3" />
      <rect className="la-green la-grow" x="20" y="128" width="168" height="6" rx="3" />
    </>
  )
}

function Requests() {
  return (
    <>
      <rect className="la-card" x="14" y="12" width="292" height="116" rx="12" />
      <text className="la-cap" x="28" y="32">Request</text>
      <text className="la-big" x="28" y="60">25.00 NIM</text>
      <text className="la-sub" x="28" y="78">For: Invoice #42</text>
      <text className="la-mono" x="28" y="100">nimbooks:invoice:4u010r140g</text>
      <rect className="la-green la-pop" x="210" y="24" width="82" height="22" rx="11" />
      <text className="la-pilltxt la-onfill" x="251" y="38" textAnchor="middle">Paid</text>
      <rect className="la-qrbox" x="232" y="58" width="56" height="56" rx="6" />
      <QrGlyph x={238} y={64} cell={5} />
    </>
  )
}

function Receipts() {
  return (
    <>
      <rect className="la-card" x="14" y="12" width="196" height="116" rx="12" />
      <text className="la-cap" x="28" y="32">Amount</text>
      <text className="la-txt" x="28" y="48">25.00 NIM</text>
      <text className="la-cap" x="28" y="68">Sender and recipient</text>
      <rect className="la-line-fill" x="28" y="76" width="150" height="5" rx="2.5" />
      <rect className="la-line-fill" x="28" y="86" width="120" height="5" rx="2.5" />
      <text className="la-mono" x="28" y="112">tx 3f77f5cfaa65</text>
      <circle className="la-seal" cx="262" cy="70" r="36" />
      <path className="la-check la-dash" d="M246 71l11 11 21-22" />
    </>
  )
}

function Cashlinks() {
  return (
    <>
      <rect className="la-card" x="14" y="12" width="292" height="30" rx="15" />
      <rect className="la-chain" x="28" y="21" width="14" height="10" rx="5" />
      <rect className="la-chain" x="36" y="21" width="14" height="10" rx="5" />
      <text className="la-mono" x="60" y="31">hub.nimiq.com/cashlink/#…</text>
      <text className="la-big" x="24" y="88">40 NIM</text>
      <rect className="la-green-soft" x="150" y="70" width="152" height="24" rx="12" />
      <text className="la-pilltxt la-green-txt" x="226" y="86" textAnchor="middle">Ready to claim</text>
      <rect className="la-outline" x="24" y="102" width="92" height="22" rx="11" />
      <text className="la-pilltxt la-ink" x="70" y="117" textAnchor="middle">Revert</text>
      <text className="la-sub" x="130" y="117">Unclaimed NIM comes back</text>
    </>
  )
}

function Statements() {
  const rows = [
    { label: 'Opening (1 Jan)', w: 70 },
    { label: 'Received', w: 96 },
    { label: 'Sent', w: 60 },
    { label: 'Fees', w: 14 },
    { label: 'Closing (31 Dec)', w: 110, strong: true },
  ]
  return (
    <>
      <rect className="la-card" x="14" y="10" width="292" height="120" rx="12" />
      {rows.map((r, i) => {
        const y = 30 + i * 21
        return (
          <g key={r.label}>
            {i > 0 && <line className="la-axis" x1="28" y1={y - 10} x2="292" y2={y - 10} />}
            <text className={r.strong ? 'la-txt' : 'la-sub'} x="28" y={y + 4}>{r.label}</text>
            <rect
              className={`${r.strong ? 'la-gold' : 'la-line-fill'} la-grow`}
              x={292 - r.w}
              y={y - 2}
              width={r.w}
              height="6"
              rx="3"
            />
          </g>
        )
      })}
    </>
  )
}

function Tax() {
  return (
    <>
      <rect className="la-card" x="14" y="12" width="292" height="72" rx="12" />
      <text className="la-txt" x="28" y="34">2025</text>
      <rect className="la-gold la-grow" x="88" y="26" width="120" height="8" rx="4" />
      <text className="la-sub" x="216" y="34">Gain</text>
      <rect className="la-green la-grow" x="88" y="52" width="70" height="8" rx="4" />
      <text className="la-sub" x="166" y="60">Income</text>
      <rect className="la-pill" x="14" y="96" width="292" height="30" rx="15" />
      <text className="la-pilltxt" x="160" y="115" textAnchor="middle">Koinly · CoinTracking · CryptoTaxCalculator</text>
    </>
  )
}

function Exports() {
  return (
    <>
      <rect className="la-card" x="22" y="16" width="78" height="108" rx="8" />
      <rect className="la-gold" x="22" y="16" width="78" height="20" rx="8" />
      <text className="la-tagtxt la-onfill" x="61" y="30" textAnchor="middle">CSV</text>
      <rect className="la-line-fill" x="34" y="48" width="54" height="4" rx="2" />
      <rect className="la-line-fill" x="34" y="60" width="44" height="4" rx="2" />
      <rect className="la-line-fill" x="34" y="72" width="54" height="4" rx="2" />
      <rect className="la-line-fill" x="34" y="84" width="36" height="4" rx="2" />
      <path className="la-arrow" d="M124 60h26M144 53l7 7-7 7" />
      <rect className="la-qrbox" x="172" y="20" width="76" height="76" rx="10" />
      <QrGlyph x={181} y={29} cell={6} />
      <rect className="la-pill la-pill-on" x="172" y="104" width="76" height="20" rx="10" />
      <text className="la-pilltxt la-onfill" x="210" y="118" textAnchor="middle">48 hours</text>
    </>
  )
}

function Portfolio() {
  return (
    <>
      <rect className="la-card" x="16" y="10" width="176" height="120" rx="8" />
      <rect className="la-gold" x="16" y="10" width="176" height="24" rx="8" />
      <text className="la-tagtxt la-onfill" x="104" y="25" textAnchor="middle">Portfolio report</text>
      <rect className="la-line-fill" x="28" y="46" width="60" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="120" y="45" width="56" height="6" rx="3" />
      <rect className="la-line-fill" x="28" y="62" width="48" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="120" y="61" width="36" height="6" rx="3" />
      <rect className="la-line-fill" x="28" y="78" width="72" height="5" rx="2.5" />
      <rect className="la-green la-grow" x="120" y="77" width="48" height="6" rx="3" />
      <line className="la-axis" x1="28" y1="96" x2="180" y2="96" />
      <text className="la-txt" x="28" y="114">Grand total</text>
      <rect className="la-gold la-grow" x="120" y="108" width="56" height="6" rx="3" />
      <rect className="la-lock" x="222" y="56" width="44" height="34" rx="7" />
      <path className="la-shackle" d="M230 56v-8a14 14 0 0 1 28 0" />
      <text className="la-pilltxt la-green-txt" x="244" y="110" textAnchor="middle">Unlocked</text>
    </>
  )
}

function Mcp() {
  return (
    <>
      <rect className="la-term" x="14" y="12" width="168" height="116" rx="10" />
      <circle className="la-dot" cx="28" cy="26" r="3" />
      <circle className="la-dot" cx="38" cy="26" r="3" />
      <circle className="la-dot" cx="48" cy="26" r="3" />
      <text className="la-termtxt" x="26" y="52">$ npx -y nimbooks-mcp</text>
      <text className="la-termtxt la-termok" x="26" y="72">six tools ready</text>
      <text className="la-termtxt" x="26" y="92">read only, no signing</text>
      <rect className="la-card" x="196" y="16" width="110" height="46" rx="12" />
      <text className="la-sub" x="208" y="36">How much came</text>
      <text className="la-sub" x="208" y="50">in last month?</text>
      <rect className="la-gold-soft" x="196" y="74" width="110" height="46" rx="12" />
      <rect className="la-gold la-grow" x="210" y="106" width="16" height="8" rx="3" />
      <rect className="la-gold la-grow" x="232" y="98" width="16" height="16" rx="3" />
      <rect className="la-gold la-grow" x="254" y="92" width="16" height="22" rx="3" />
      <text className="la-sub" x="208" y="88">From your books</text>
    </>
  )
}

function Privacy() {
  return (
    <>
      <rect className="la-card" x="14" y="16" width="134" height="108" rx="12" />
      <rect className="la-lock" x="40" y="72" width="50" height="34" rx="7" />
      <path className="la-shackle" d="M48 72v-9a17 17 0 0 1 34 0v9" />
      <circle className="la-keyhole" cx="65" cy="88" r="4" />
      <text className="la-cap" x="28" y="40">Your keys</text>
      <text className="la-sub" x="28" y="114">Stay in your wallet</text>
      <rect className="la-card" x="162" y="16" width="144" height="108" rx="12" />
      <circle className="la-blue" cx="178" cy="38" r="4" />
      <text className="la-sub" x="190" y="41">Public chain: read</text>
      <circle className="la-green" cx="178" cy="62" r="4" />
      <text className="la-sub" x="190" y="65">Your wallet: signs</text>
      <rect className="la-line-fill" x="176" y="82" width="110" height="5" rx="2.5" />
      <text className="la-sub" x="176" y="110">No account, no email</text>
    </>
  )
}

const ART: Record<string, () => ReactNode> = {
  balance: Balance,
  history: History,
  analytics: Analytics,
  'send-receive': SendReceive,
  staking: Staking,
  requests: Requests,
  receipts: Receipts,
  cashlinks: Cashlinks,
  statements: Statements,
  tax: Tax,
  exports: Exports,
  portfolio: Portfolio,
  mcp: Mcp,
  privacy: Privacy,
}

/** The sketch for one feature, or nothing for a slug without one. */
export default function FeatureArt({ slug }: { slug: string }) {
  const draw = ART[slug]
  if (!draw) return null
  return <Frame>{draw()}</Frame>
}

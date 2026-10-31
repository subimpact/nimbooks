import { useEffect, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import FeatureArt from './LandingArt'
import QrCode from './QrCode'
import { dialogFocus } from './lib/dialogFocus'
import { NIMIQ_PAY_APP_URL } from './lib/device'
import { DONATION_ADDRESS, DONATION_QR_VALUE } from './lib/support'
import {
  BOOK_FEATURES,
  EARN_FEATURES,
  FEATURES,
  featureBySlug,
  type FeatureDef,
  type SampleEntry,
} from './lib/features'

// What NimBooks does, before you connect. Below 1024px: a card row per story
// that open full-screen explainers. From 1024px: the same two stories as two
// groups beside the explainer, and the "Open on your phone" code. Both read
// FEATURES (lib/features.ts).
//
// Two stories, in this order: earn on your NIM first (the reason to open
// NimBooks), then the books it keeps for you. The books fold away on a phone
// behind one button, so the first screen is about earning.
//
// Addresses: #/learn opens the landing scrolled to the features, and
// #/learn/<slug> opens that explainer. Closing it leaves the plain landing.

const DESKTOP_QUERY = '(min-width: 1024px)'
const SHEET_TITLE_ID = 'learn-sheet-title'
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function subscribeDesktop(onChange: () => void): () => void {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const isDesktopNow = (): boolean => window.matchMedia(DESKTOP_QUERY).matches
const notDesktop = (): boolean => false

/** The feature a `#/learn/<slug>` hash names, or null for anything else. */
function slugFromHash(hash: string): string | null {
  const m = /^#\/learn\/([a-z0-9-]+)$/.exec(hash)
  return m && featureBySlug(m[1]) ? m[1] : null
}
const slugNow = (): string | null => slugFromHash(window.location.hash)
const learnHash = (slug: string): string => `#/learn/${slug}`
/** The page address without its fragment: the plain landing. */
const landingUrl = (): string => `${window.location.pathname}${window.location.search}`

const HOW_IT_WORKS = [
  {
    title: 'Connect',
    body: 'Sign in with Nimiq Pay (the wallet app) or the Nimiq Hub (browser sign-in). Or try the sample wallet first.',
  },
  {
    title: 'Your books build themselves',
    body: 'NimBooks reads the public Nimiq chain. There is nothing to import or type in.',
  },
  {
    title: 'Export or prove',
    body: 'Download statements and CSV files, or sign a receipt that anyone can check.',
  },
]

const TRUST = [
  {
    title: 'Read-only until you sign',
    body: 'Looking at your books never asks for a signature.',
  },
  {
    title: 'Your keys never leave your wallet',
    body: 'NimBooks asks your wallet to sign. Your wallet keeps the keys.',
  },
  {
    title: 'No account, no email',
    body: 'There is nothing to sign up for. Your wallet is your sign-in.',
  },
]

/** Public facts about the donation address: it is the owner's, shown on chain. */
const TOP_SUPPORTERS = 20

interface LandingProps {
  /** Starts the sample wallet on the screen an explainer asked for, or on the guided tour. */
  onSampleEntry: (entry: SampleEntry) => void
  /** Sign-in is already in progress: the explainer buttons wait. */
  busy: boolean
}

export default function Landing({ onSampleEntry, busy }: LandingProps) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktopNow, notDesktop)
  // The explainer on show: the sheet on a phone, the panel on desktop.
  const [openSlug, setOpenSlug] = useState<string | null>(slugNow)
  // On a phone the book features start folded away: the first screen is about
  // earning. Desktop shows both groups at once (see the render below).
  const [booksOpen, setBooksOpen] = useState(false)

  // Back, forward and a hand-edited hash move the explainer with them.
  useEffect(() => {
    const sync = () => setOpenSlug(slugNow())
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  // On first show. #/learn scrolls to the features. A shared #/learn/<slug> on a
  // phone gets an entry of its own on top of the plain landing, so Back closes
  // the sheet rather than leaving NimBooks.
  useEffect(() => {
    if (window.location.hash === '#/learn') {
      document.getElementById('learn-features')?.scrollIntoView({ block: 'start' })
    }
    const slug = slugNow()
    if (slug && !isDesktopNow() && !window.history.state?.nbLearn) {
      window.history.replaceState(null, '', landingUrl())
      window.history.pushState({ nbLearn: true }, '', learnHash(slug))
    }
  }, [])

  // A card, or a row in the desktop list. A phone sheet gets its own entry, so
  // Back closes it. On desktop the address follows the selection, so it can be shared.
  const openFeature = (slug: string) => {
    if (desktop) {
      if (slugNow() !== slug) window.history.replaceState(window.history.state, '', learnHash(slug))
    } else if (!window.history.state?.nbLearn) {
      window.history.replaceState(null, '', landingUrl())
      window.history.pushState({ nbLearn: true }, '', learnHash(slug))
    } else if (slugNow() !== slug) {
      window.history.pushState({ nbLearn: true }, '', learnHash(slug))
    }
    setOpenSlug(slug)
  }

  // An entry we pushed is popped with Back. A hash that was loaded or typed is
  // cleared in place. Either way the address ends up as the plain landing.
  const closeFeature = () => {
    setOpenSlug(null)
    if (window.history.state?.nbLearn) window.history.back()
    else window.history.replaceState(window.history.state, '', landingUrl())
  }

  // The sample wallet takes over the page, so the explainer's address goes too:
  // a later Back or reload must not bring the sheet back.
  const enterSample = (entry: SampleEntry) => {
    setOpenSlug(null)
    window.history.replaceState(null, '', landingUrl())
    onSampleEntry(entry)
  }
  const tryFeature = (feature: FeatureDef) => enterSample({ ...feature.tryView, tour: false })
  const takeTour = () => enterSample({ view: 'dashboard', tour: true })

  const shown = featureBySlug(openSlug)
  const support = <SupportSection />


  if (desktop) {
    const panel = shown ?? FEATURES[0]
    // Two groups in one list: earn first, the books second, so the explorer
    // tells the same story as the phone cards.
    const groupButton = (f: FeatureDef) => (
      <button
        key={f.slug}
        type="button"
        data-feature={f.slug}
        data-group={f.group}
        aria-current={f.slug === panel.slug ? 'true' : undefined}
        onClick={() => openFeature(f.slug)}
      >
        <span className="learn-list-icon" aria-hidden="true">{f.icon}</span>
        <span>{f.title}</span>
      </button>
    )
    return (
      <>
        <section className="learn-explorer" id="learn-features" aria-labelledby="learn-explorer-title">
          <div className="learn-head">
            <h2 id="learn-explorer-title">Earn on your NIM, keep your books</h2>
            <p>Pick a feature to see how it works, before you connect. Earn comes first.</p>
          </div>
          <div className="learn-explorer-body">
            <nav className="learn-list" aria-label="Features">
              <h3 className="learn-list-title learn-list-title--earn" id="learn-earn-title">Earn on your NIM</h3>
              {EARN_FEATURES.map(groupButton)}
              <h3 className="learn-list-title" id="learn-books-title">Your books, kept for you</h3>
              {BOOK_FEATURES.map(groupButton)}
            </nav>
            <article className="learn-panel" aria-labelledby="learn-panel-title">
              <FeatureExplainer
                feature={panel}
                level={3}
                titleId="learn-panel-title"
                busy={busy}
                onTry={tryFeature}
                onTour={takeTour}
              />
            </article>
          </div>
        </section>
        <HowItWorks />
        <TrustStrip />
        {support}
      </>
    )
  }

  return (
    <>
      <div className="learn-features" id="learn-features">
        <section className="learn-section learn-earn" aria-labelledby="learn-earn-title">
          <div className="learn-head">
            <h2 id="learn-earn-title">Earn on your NIM</h2>
            <p>Stake, follow the rewards, and see what your validator is doing. Tap a card to see how it works.</p>
          </div>
          <ul className="learn-cards learn-cards--earn">
            {EARN_FEATURES.map((f) => (
              <li key={f.slug}>
                <button type="button" className="learn-card" data-feature={f.slug} data-group={f.group} onClick={() => openFeature(f.slug)}>
                  <span className="learn-card-icon" aria-hidden="true">{f.icon}</span>
                  <span className="learn-card-title">{f.title}</span>
                  <span className="learn-card-line">{f.oneLiner}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="learn-section learn-books" aria-labelledby="learn-books-title">
          <div className="learn-head">
            <h2 id="learn-books-title">Your books, kept for you</h2>
            <p>Every payment, request and receipt, read from the chain and kept on this device. Nothing to type in.</p>
          </div>
          <button
            type="button"
            className="btn-secondary learn-books-toggle"
            aria-expanded={booksOpen}
            aria-controls="learn-books-cards"
            onClick={() => setBooksOpen((v) => !v)}
          >
            {booksOpen ? 'Show fewer book features' : `Show all ${BOOK_FEATURES.length} book features`}
          </button>
          {booksOpen && (
            <ul className="learn-cards" id="learn-books-cards">
              {BOOK_FEATURES.map((f) => (
                <li key={f.slug}>
                  <button type="button" className="learn-card" data-feature={f.slug} data-group={f.group} onClick={() => openFeature(f.slug)}>
                    <span className="learn-card-icon" aria-hidden="true">{f.icon}</span>
                    <span className="learn-card-title">{f.title}</span>
                    <span className="learn-card-line">{f.oneLiner}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <HowItWorks />
      <TrustStrip />
      {support}
      <p className="learn-builders">
        Building with AI? NimBooks has a read-only MCP server for AI assistants.{' '}
        <a href="/mcp/" target="_blank" rel="noopener">
          MCP setup guide
        </a>
      </p>
      {shown && (
        <LearnSheet feature={shown} busy={busy} onTry={tryFeature} onTour={takeTour} onClose={closeFeature} />
      )}
    </>
  )
}

/**
 * "Open on your phone": the Nimiq Pay link as a code, under the connect panel on
 * desktop. Renders nothing on a phone, where the page is already on the phone.
 */
export function PhoneQr() {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktopNow, notDesktop)
  if (!desktop) return null
  return (
    <aside className="learn-phone-qr" aria-labelledby="learn-qr-title">
      <h2 id="learn-qr-title">Open on your phone</h2>
      <QrCode value={NIMIQ_PAY_APP_URL} size={156} label="QR code that opens NimBooks in Nimiq Pay" />
      <p>Scan it with your phone's camera. NimBooks runs inside the Nimiq Pay app, where your NIM wallet lives.</p>
    </aside>
  )
}

function HowItWorks() {
  return (
    <section className="learn-how" aria-labelledby="learn-how-title">
      <h2 id="learn-how-title">How it works</h2>
      <ol className="learn-how-steps">
        {HOW_IT_WORKS.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span>{s.body}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function TrustStrip() {
  return (
    <section className="learn-trust" aria-label="Trust">
      <ul>
        {TRUST.map((t) => (
          <li key={t.title}>
            <span className="learn-tick" aria-hidden="true">✓</span>
            <span>
              <strong>{t.title}</strong>
              {t.body}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Whole NIM, decimals dropped: a decimal that small is noise, not news. */
const wholeNim = (nim: number): string => Math.floor(nim).toLocaleString('en-GB')

/** The public donation summary, fetched once. Errors keep the address card. */
type SupportState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: SupportersJson }

interface SupportersJson {
  totalNim?: number
  count?: number
  supporters?: { name: string; amountNim: number }[]
}

/** The section after the trust strip: why to give, the address, and the public totals. */
function SupportSection() {
  const [state, setState] = useState<SupportState>({ status: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const control = new AbortController()
    const load = async () => {
      try {
        const res = await fetch('/api/supporters', { signal: control.signal })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as SupportersJson
        setState({ status: 'ok', data })
      } catch (e) {
        // Aborted (unmounted) is not an error — the component is gone anyway.
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({ status: 'error' })
      }
    }
    void load()
    return () => control.abort()
  }, [])

  // The landing has no toast of its own; the button itself confirms.
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(DONATION_ADDRESS)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = DONATION_ADDRESS
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* nothing more to try */
      }
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const loaded = state.status === 'ok'
  const data = loaded ? state.data : null
  const supporters = (loaded && data?.supporters) || []
  const shown = supporters.slice(0, TOP_SUPPORTERS)
  const total = loaded && typeof data?.totalNim === 'number' ? data.totalNim : null

  return (
    <section className="learn-support" id="learn-support" aria-labelledby="learn-support-title">
      <h2 id="learn-support-title">Support NimBooks</h2>
      <p className="learn-support-lead">
        NimBooks is free and built by one person. If it saves you time, you can support it by sending some NIM to the address below.
      </p>
      <p className="learn-support-lead">
        Staking with ImpactZero, the validator run by the person who builds NimBooks, also supports it and keeps your NIM earning.
      </p>
      <div className="learn-support-card">
        <QrCode
          value={DONATION_QR_VALUE}
          size={132}
          label="QR code of the NimBooks donation address"
        />
        <p className="mono learn-support-addr">{DONATION_ADDRESS}</p>
        <button type="button" className="btn-secondary" onClick={() => void copyAddress()}>
          {copied ? 'Address copied ✓' : 'Copy address'}
        </button>
      </div>
      {loaded && (
        <div className="learn-support-pool">
          {total !== null && (
            <p className="learn-support-total">
              Total raised: <strong>{wholeNim(total)} NIM</strong>
            </p>
          )}
          {shown.length === 0 ? (
            <p className="learn-support-empty">Be the first supporter</p>
          ) : (
            <ul className="learn-support-list" aria-label="Supporters">
              {shown.map((s, i) => (
                // Names can repeat (two "Anonymous supporter" senders stay separate rows).
                <li key={`${s.name}-${i}`}>
                  <span>{s.name}</span>
                  <span className="learn-support-nim">{wholeNim(s.amountNim)} NIM</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/** "On chain: …" shows its label in bold. Anything else is plain text. */
function labelled(text: string): ReactNode {
  const m = /^([A-Za-z][A-Za-z' ]{1,30}):\s/.exec(text)
  if (!m) return text
  return (
    <>
      <strong>{m[1]}:</strong> {text.slice(m[0].length)}
    </>
  )
}

function FeatureExplainer({
  feature,
  level,
  titleId,
  busy,
  onTry,
  onTour,
}: {
  feature: FeatureDef
  /** 2 in the phone sheet (it is the dialog's title), 3 under the desktop heading. */
  level: 2 | 3
  titleId: string
  busy: boolean
  onTry: (feature: FeatureDef) => void
  onTour: () => void
}) {
  const Title = level === 2 ? 'h2' : 'h3'
  return (
    <div className="learn-explainer">
      <div className="learn-ex-head">
        <span className="learn-ex-icon" aria-hidden="true">{feature.icon}</span>
        <div>
          <Title id={titleId} className="learn-ex-title">
            {feature.title}
          </Title>
          <span className="learn-badge">{feature.availability}</span>
        </div>
      </div>
      <p className="learn-oneliner">{feature.oneLiner}</p>
      <div className="learn-art">
        <FeatureArt slug={feature.slug} />
      </div>
      <p className="learn-h">How to use it</p>
      <ol className="learn-steps">
        {feature.steps.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span>{s.body}</span>
          </li>
        ))}
      </ol>
      <p className="learn-h">Behind the scenes</p>
      <ul className="learn-bullets">
        {feature.behindTheScenes.map((b) => (
          <li key={b}>{labelled(b)}</li>
        ))}
      </ul>
      <p className="learn-h">Good to know</p>
      <ul className="learn-bullets">
        {feature.goodToKnow.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
      <div className="learn-actions">
        <button type="button" className="btn-primary" onClick={() => onTry(feature)} disabled={busy}>
          Try it in the sample wallet
        </button>
        <button type="button" className="btn-secondary" onClick={onTour} disabled={busy}>
          Take the guided tour
        </button>
      </div>
    </div>
  )
}

/** The full-screen explainer on a phone. Escape, the close button and Back close it. */
function LearnSheet({
  feature,
  busy,
  onTry,
  onTour,
  onClose,
}: {
  feature: FeatureDef
  busy: boolean
  onTry: (feature: FeatureDef) => void
  onTour: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The page behind a full-screen sheet stays put while it is open.
  useEffect(() => {
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = was
    }
  }, [])

  // Tab stays inside the sheet and wraps at either end.
  const trapFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    const outside = !e.currentTarget.contains(active)
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="learn-overlay">
      <div
        className="learn-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
        ref={dialogFocus}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="learn-sheet-top">
          <span className="learn-kicker">NimBooks features</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <FeatureExplainer
          feature={feature}
          level={2}
          titleId={SHEET_TITLE_ID}
          busy={busy}
          onTry={onTry}
          onTour={onTour}
        />
      </div>
    </div>
  )
}

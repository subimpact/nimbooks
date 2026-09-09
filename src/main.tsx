import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import VerifyPage from './VerifyPage'
import InvoicePage from './InvoicePage'
import { applyTheme, getInitialTheme } from './lib/theme'
import { hashRouteFromQuery } from './lib/device'
import { checkHubRedirect, isHubRedirectReturn } from './lib/wallet'

// Apply the saved/system theme before first paint to avoid a flash.
applyTheme(getInitialTheme())

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="card verify-card">
            <h1>⚠️ Something went wrong</h1>
            <p className="details">{this.state.error.message}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function Router() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Bare `#/verify` is the interactive verifier — paste a receipt link there.
  if (hash === '#/verify' || hash.startsWith('#/verify/')) {
    return <VerifyPage key={hash} />
  }
  if (hash.startsWith('#/invoice/')) {
    return <InvoicePage key={hash} />
  }
  return <App />
}

function start() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <Router />
      </ErrorBoundary>
    </StrictMode>
  )
}

// A route that arrived as `?route=…&p=…` — from a host that forwards the query
// string but drops the fragment — goes back on the hash before the router
// reads it. An existing hash always wins: it is the route the user asked for.
const queryRoute = window.location.hash ? null : hashRouteFromQuery(window.location.search)
if (queryRoute) window.location.replace(queryRoute)

// A Hub login from a mobile browser comes back as a full-page redirect. Take
// the response off the URL and restore the route *before* the router reads the
// hash, so the user lands back on the invoice they were paying, signed in.
if (isHubRedirectReturn()) {
  void checkHubRedirect()
    .catch((e) => console.warn('Hub redirect check failed:', e))
    .finally(start)
} else {
  start()
}

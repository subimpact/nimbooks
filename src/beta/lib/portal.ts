// Radix portals in beta must land INSIDE the .ui-beta root (theme tokens and
// the scoped base reset live on it). SidebarProvider's mobile Sheet, the
// yield calculator drawer and any Select render through their components'
// Portal with this container. Default stays document.body when no provider
// is above (harmless: nothing styles off-scope portals, and every real use
// is under the shell).
import * as React from 'react'

export const BetaPortalContext = React.createContext<HTMLElement | null>(null)

/** The element Radix should portal into, or undefined for the document body. */
export function useBetaPortalContainer(): HTMLElement | undefined {
  return React.useContext(BetaPortalContext) ?? undefined
}
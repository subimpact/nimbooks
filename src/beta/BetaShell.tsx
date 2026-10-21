// Beta shell: the house layout (SidebarProvider + AppSidebar + SidebarInset +
// TopBar) wrapped around the app's five sections. Mirrors darkfall-admin's
// App.tsx composition; the classic chrome (hero background, topbar, tab dock)
// is not rendered in beta, so this is the whole frame.
//
// On phones (< 768px) the shadcn sidebar is the off-canvas Sheet, AND a fixed
// bottom tab bar carries the same five sections: NimBooks runs one-handed
// inside the Nimiq Pay WebView, where a side drawer is a second hand away.
//
// The shell root carries .ui-beta (the scoped theme root) and doubles as the
// Radix portal container, so every beta Sheet, Drawer and Select stays inside
// the scoped look. Overlays and sheets sit at z-50, above anything classic.

import { useState, type ComponentProps, type ReactNode } from 'react'
import { cn } from 'cn'
import {
  BookOpenIcon,
  LayoutDashboardIcon,
  HistoryIcon,
  ReceiptTextIcon,
  SendIcon,
  DownloadIcon,
  LogOutIcon,
  LeafIcon,
  MoonIcon,
  RefreshCwIcon,
  SunIcon,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@beta/components/ui/sidebar'
import { Separator } from '@beta/components/ui/separator'
import { Badge } from '@beta/components/ui/badge'
import { Button } from '@beta/components/ui/button'
import { TooltipProvider } from '@beta/components/ui/tooltip'
import { BetaPortalContext } from '@beta/lib/portal'

export type BetaView = 'dashboard' | 'history' | 'receipts' | 'request' | 'export'

const NAV: Array<{ view: BetaView; label: string; icon: typeof LayoutDashboardIcon }> = [
  { view: 'dashboard', label: 'Overview', icon: LayoutDashboardIcon },
  { view: 'history', label: 'History', icon: HistoryIcon },
  { view: 'receipts', label: 'Receipts', icon: ReceiptTextIcon },
  { view: 'request', label: 'Request', icon: SendIcon },
  { view: 'export', label: 'Export', icon: DownloadIcon },
]

export default function BetaShell({
  view,
  onNavigate,
  address,
  versionLabel,
  onVersion,
  onDisconnect,
  theme,
  onToggleTheme,
  onStake,
  onRefresh,
  refreshing,
  countdown,
  notices,
  children,
}: {
  view: BetaView
  onNavigate: (view: BetaView) => void
  /** Connected NIM address (footer). */
  address: string | null
  /** The version badge text, e.g. "v1.36.0 beta"; opens the changelog modal. */
  versionLabel: string
  onVersion: () => void
  onDisconnect: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onStake: () => void
  /** Re-pulls balances and history (with spinner and countdown states). */
  onRefresh: () => void
  refreshing: boolean
  /** Seconds to the next automatic refresh; hidden in demo mode. */
  countdown: number | null
  /** The classic error and toast banners, shown between the top bar and content. */
  notices?: ReactNode
  /** The five sections, rendered into the content column. */
  children: ReactNode
}) {
  // The shell root is the portal container: fixed overlays (Sheet, Drawer,
  // Select) are positioned relative to the viewport anyway, and staying
  // inside .ui-beta keeps every theme token alive.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)

  const sectionTitle = NAV.find((item) => item.view === view)?.label ?? ''

  return (
    <div className="ui-beta" ref={setPortalHost} data-probe="beta-shell">
      <BetaPortalContext.Provider value={portalHost}>
        <TooltipProvider delayDuration={150}>
          <SidebarProvider>
            <BetaSidebar
              view={view}
              onNavigate={onNavigate}
              address={address}
              versionLabel={versionLabel}
              onVersion={onVersion}
              onDisconnect={onDisconnect}
            />
            <SidebarInset className="tw:min-w-0">
              <BetaTopBar
                title={sectionTitle}
                theme={theme}
                onToggleTheme={onToggleTheme}
                onStake={onStake}
                onRefresh={onRefresh}
                refreshing={refreshing}
                countdown={countdown}
                onDisconnect={onDisconnect}
              />
              {notices}
              {/* Classic content (wrapped .classic-in-beta) keeps its own bottom
                  spacing; the room for the fixed bottom tab bar is mobile-only. */}
              <div className="tw:mx-auto tw:flex tw:w-full tw:max-w-[960px] tw:flex-col tw:gap-4 tw:px-3 tw:pt-4 tw:pb-[calc(96px+env(safe-area-inset-bottom,0px))] tw:min-[640px]:px-5 tw:md:pb-6">
                {children}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </BetaPortalContext.Provider>
      <BetaBottomTabs view={view} onNavigate={onNavigate} />
    </div>
  )
}

function BetaSidebar({
  view,
  onNavigate,
  address,
  versionLabel,
  onVersion,
  onDisconnect,
}: {
  view: BetaView
  onNavigate: (view: BetaView) => void
  address: string | null
  versionLabel: string
  onVersion: () => void
  onDisconnect: () => void
}) {
  // On a phone the sidebar is a modal Sheet: Radix makes everything outside it
  // inert while it is open, so every action closes it first. The changelog is
  // a classic modal outside the Sheet, so it opens only once the Sheet is gone
  // (otherwise its switch, the way back to classic, cannot be tapped).
  const { isMobile, setOpenMobile } = useSidebar()
  const closeThen = (fn: () => void, delayMs = 0) => () => {
    if (!isMobile) return fn()
    setOpenMobile(false)
    if (delayMs > 0) window.setTimeout(fn, delayMs)
    else fn()
  }
  return (
    <Sidebar collapsible="icon" className="tw:border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="tw:pointer-events-none">
              <div>
                <div className="tw:flex tw:aspect-square tw:size-8 tw:items-center tw:justify-center tw:rounded-lg tw:bg-primary tw:text-primary-foreground">
                  <BookOpenIcon className="tw:size-5" />
                </div>
                <span className="tw:grid tw:flex-1 tw:text-left tw:text-sm tw:leading-tight">
                  <span className="tw:truncate tw:font-semibold">NimBooks</span>
                  <span className="tw:truncate tw:text-xs tw:text-muted-foreground">Beta look</span>
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Sections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.view}>
                  <SidebarMenuButton
                    isActive={view === item.view}
                    tooltip={item.label}
                    onClick={closeThen(() => onNavigate(item.view))}
                    aria-current={view === item.view ? 'page' : undefined}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="tw:gap-2">
        {address && (
          <span className="tw:block tw:truncate tw:rounded-md tw:px-2 tw:py-1 tw:font-mono tw:text-xs tw:text-muted-foreground">
            {address.slice(0, 12)}...
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="tw:justify-start tw:text-xs"
          onClick={closeThen(onVersion, 350)}
          data-probe="beta-version-badge"
        >
          <Badge variant="outline" className="tw:pointer-events-none">
            {versionLabel}
          </Badge>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tw:justify-start"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
        >
          <LogOutIcon />
          <span>Disconnect</span>
        </Button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function BetaTopBar({
  title,
  theme,
  onToggleTheme,
  onStake,
  onRefresh,
  refreshing,
  countdown,
  onDisconnect,
}: {
  title: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onStake: () => void
  onRefresh: () => void
  refreshing: boolean
  countdown: number | null
  onDisconnect: () => void
}) {
  return (
    <header className="tw:sticky tw:top-0 tw:z-20 tw:flex tw:h-14 tw:w-full tw:items-center tw:gap-1.5 tw:border-b tw:bg-background/95 tw:px-2 tw:backdrop-blur tw:supports-backdrop-filter:bg-background/80 tw:sm:gap-2 tw:sm:px-4">
      <SidebarTrigger className="tw:-ml-1 tw:shrink-0" />
      <Separator orientation="vertical" className="tw:h-5! tw:self-center tw:max-sm:hidden" />
      <h1 className="tw:truncate tw:text-sm tw:font-semibold">{title}</h1>
      <div className="tw:ml-auto tw:flex tw:shrink-0 tw:items-center tw:gap-1 tw:sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onStake}
          title="Stake"
          aria-label="Stake"
          data-tour="stake"
        >
          <LeafIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCwIcon className={refreshing ? 'tw:animate-spin' : ''} />
        </Button>
        {countdown !== null && (
          <span className="tw:text-[10px] tw:text-muted-foreground">{countdown}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDisconnect}
          title="Disconnect wallet"
          aria-label="Disconnect wallet"
        >
          <LogOutIcon />
        </Button>
      </div>
    </header>
  )
}

function BetaBottomTabs({
  view,
  onNavigate,
}: ComponentProps<typeof BetaBottomTabsImpl>) {
  // A fixed bar would be a stray element on desktop; gone at md and up.
  return (
    <nav
      aria-label="Sections"
      data-probe="beta-tabs"
      className="tw:fixed tw:inset-x-0 tw:bottom-0 tw:z-40 tw:border-t tw:bg-background tw:md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <BetaBottomTabsImpl view={view} onNavigate={onNavigate} />
    </nav>
  )
}

function BetaBottomTabsImpl({
  view,
  onNavigate,
}: {
  view: BetaView
  onNavigate: (view: BetaView) => void
}) {
  return (
    <div className="tw:grid tw:grid-cols-5">
      {NAV.map((item) => (
        <button
          key={item.view}
          type="button"
          className={cn(
            'tw:flex tw:min-h-[52px] tw:min-w-[44px] tw:flex-col tw:items-center tw:justify-center tw:gap-0.5 tw:px-1 tw:py-2 tw:text-[10px] tw:leading-tight tw:text-muted-foreground',
            view === item.view && 'tw:text-foreground'
          )}
          aria-current={view === item.view ? 'page' : undefined}
          onClick={() => onNavigate(item.view)}
        >
          <item.icon className="tw:size-5" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
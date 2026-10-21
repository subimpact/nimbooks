// vaul drawer, dressed for NimBooks: bottom sheet with a grab handle, 16px
// safe-area bottom padding, and the Radix portal pointed at the .ui-beta host
// so nothing beta can land outside the scoped root. z-50 on both overlay and
// sheet: the classic bottom tab bar is fixed at z-index 20 and must sit under
// an open sheet, never over its content.
import { Drawer as VaulDrawer } from 'vaul'
import type { ComponentProps } from 'react'

import { cn } from './cn'

export const Drawer = VaulDrawer.Root
export const DrawerTitle = VaulDrawer.Title
export const DrawerDescription = VaulDrawer.Description

/** Bottom sheet content: rounded top, a visible handle, safe-area padding. */
export function DrawerContent({ className, children, ...props }: ComponentProps<typeof VaulDrawer.Content>) {
  return (
    <VaulDrawer.Content
      className={cn(
        'tw:fixed tw:inset-x-0 tw:bottom-0 tw:z-50 tw:mx-auto tw:w-full tw:max-w-[520px] ' +
          'tw:rounded-t-2xl tw:border-x tw:border-t tw:border-[var(--color-beta-border)] ' +
          'tw:bg-[var(--color-beta-card)] tw:px-4 tw:pt-3 tw:pb-[calc(16px+env(safe-area-inset-bottom,0px))] ' +
          'tw:text-[var(--color-beta-fg)]',
        className
      )}
      {...props}
    >
      <VaulDrawer.Handle className="beta-drawer-handle" />
      {children}
    </VaulDrawer.Content>
  )
}

/** Portal that stays inside the beta root (pass `container={hostEl}`). */
export function DrawerPortal(props: ComponentProps<typeof VaulDrawer.Portal>) {
  return <VaulDrawer.Portal {...props} />
}

export function DrawerOverlay({ className, ...props }: ComponentProps<typeof VaulDrawer.Overlay>) {
  return (
    <VaulDrawer.Overlay
      className={cn('tw:fixed tw:inset-0 tw:z-50 tw:bg-black/60', className)}
      {...props}
    />
  )
}
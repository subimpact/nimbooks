// Drawer (vaul): the bottom sheet the yield calculator opens in on phones.
// Modelled on the shadcn drawer, with Radix's portal pointed at the .ui-beta
// host via the shared beta portal container.
"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import { cn } from "cn"

import { useBetaPortalContainer } from "@beta/lib/portal"

function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  const container = useBetaPortalContainer()
  return <DrawerPrimitive.Portal data-slot="drawer-portal" container={container} {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "tw:fixed tw:inset-0 tw:z-50 tw:bg-black/10 tw:data-open:animate-in tw:data-open:fade-in-0 tw:data-closed:animate-out tw:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "tw:group/drawer-content tw:fixed tw:z-50 tw:flex tw:h-auto tw:flex-col tw:inset-x-0 tw:bottom-0 tw:mt-24 tw:max-h-[85vh] tw:overflow-y-auto tw:rounded-t-xl tw:border-t tw:bg-popover tw:px-4 tw:pb-6 tw:pt-3 tw:text-sm tw:text-popover-foreground tw:data-open:animate-in tw:data-open:fade-in-0 tw:duration-100",
          "tw:md:max-h-[80vh]",
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          data-slot="drawer-grab"
          className="tw:pointer-events-none tw:absolute tw:top-2 tw:left-1/2 tw:-translate-x-1/2 tw:h-1 tw:w-9 tw:rounded-full tw:bg-muted-foreground/40"
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("tw:flex tw:flex-col tw:gap-1.5 tw:p-4", className)}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("tw:mt-auto tw:flex tw:flex-col tw:gap-2 tw:p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("tw:text-base tw:font-medium tw:text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("tw:text-sm tw:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
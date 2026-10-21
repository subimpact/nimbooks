// shadcn-style Switch on Radix: a 48x28 track inside a 44px tap target, knob
// pushed to the right when checked. Used by beta screens; the visual states
// are two plain classes in beta.css, so the states cannot depend on variant
// spelling. The changelog opt-in switch itself is hand-rolled in classic CSS:
// it must work before this module has ever loaded (it is the way in).
import * as RadixSwitch from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'

import { cn } from './cn'

export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        'beta-switch tw:inline-flex tw:h-11 tw:w-12 tw:items-center tw:justify-center tw:rounded-full',
        className
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="beta-switch-track">
        <span className="beta-switch-knob" />
      </RadixSwitch.Thumb>
    </RadixSwitch.Root>
  )
}
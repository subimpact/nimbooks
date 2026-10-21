// shadcn-style Button: cva variants, 44px minimum height (touch target in the
// Nimiq Pay WebView), no hover-only affordances.
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from './cn'

const buttonVariants = cva(
  // Base: label weight, radius 999 for pills, focus ring, and a pressed state
  // so a tap always visibly answers.
  'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-full tw:font-semibold ' +
    'tw:whitespace-nowrap tw:transition-[filter,opacity] active:tw:brightness-90 ' +
    'tw:disabled:pointer-events-none tw:disabled:opacity-50',
  {
    variants: {
      variant: {
        // Gold gradient: the app's own --gradient-gold, on the beta root so
        // light and dark themes both resolve it.
        primary:
          'tw:min-h-11 tw:px-5 tw:text-[15px] tw:text-[var(--color-beta-primary-fg)] ' +
          'tw:shadow-[var(--beta-shadow)] tw:bg-[var(--gradient-gold)]',
        secondary:
          'tw:min-h-11 tw:px-5 tw:text-[15px] tw:rounded-xl tw:bg-[var(--color-beta-card-2)] ' +
          'tw:text-[var(--color-beta-fg)] tw:border tw:border-[var(--color-beta-border)]',
        ghost: 'tw:min-h-11 tw:px-3 tw:text-[15px] tw:text-[var(--color-beta-muted)]',
        link:
          'tw:min-h-11 tw:px-1 tw:text-[15px] tw:text-[var(--color-beta-primary)] ' +
          'tw:underline tw:underline-offset-2',
      },
    },
    defaultVariants: { variant: 'primary' },
  }
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />
}
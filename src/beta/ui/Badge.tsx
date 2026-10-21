// shadcn-style Badge: small pill for states and rates.
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from './cn'

const badgeVariants = cva(
  'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:px-2.5 tw:py-1 tw:text-[13px] tw:font-semibold',
  {
    variants: {
      variant: {
        // Gold-tinted, the app's accent.
        gold:
          'tw:bg-[color-mix(in_srgb,var(--color-beta-primary)_16%,transparent)] ' +
          'tw:text-[var(--color-beta-primary)] tw:border tw:border-[color-mix(in_srgb,var(--color-beta-primary)_35%,transparent)]',
        muted: 'tw:bg-[var(--color-beta-card-2)] tw:text-[var(--color-beta-muted)]',
        green:
          'tw:bg-[color-mix(in_srgb,var(--color-beta-green)_16%,transparent)] tw:text-[var(--color-beta-green)]',
      },
    },
    defaultVariants: { variant: 'muted' },
  }
)

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
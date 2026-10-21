// shadcn-style Card: one surface, its title block and a content area. Radius
// and border follow the app's 16px token; colour comes from the .ui-beta
// tokens so the same classes work in dark and light.
import type { ComponentProps } from 'react'

import { cn } from './cn'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'tw:rounded-[var(--beta-radius)] tw:border tw:border-[var(--color-beta-border)] ' +
          'tw:bg-[var(--color-beta-card)] tw:p-4',
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('tw:flex tw:items-center tw:justify-between tw:gap-2', className)} {...props} />
}

export function CardLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'tw:text-[11px] tw:font-bold tw:uppercase tw:tracking-wide tw:text-[var(--color-beta-muted)]',
        className
      )}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('tw:mt-2', className)} {...props} />
}
// Segmented control: the beta stand-in for the classic period switch
// (horizons 1/3/5 years). A radiogroup of buttons, 44px tall each, no
// hover-only state; the selection answers to a tap.
import type { ComponentProps } from 'react'

import { cn } from './cn'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
}

export function Segmented<T extends string | number>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
} & Omit<ComponentProps<'div'>, 'onChange'>) {
  return (
    <div
      role="group"
      className={cn(
        'tw:flex tw:rounded-[var(--beta-radius-sm)] tw:bg-[var(--color-beta-card-2)] tw:p-1',
        className
      )}
      {...props}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={cn(
            'tw:min-h-11 tw:flex-1 tw:rounded-lg tw:px-3 tw:text-[15px] tw:font-semibold tw:transition-colors',
            option.value === value
              ? 'tw:bg-[var(--color-beta-card)] tw:text-[var(--color-beta-fg)] tw:shadow-[0_1px_3px_rgba(0,0,0,0.25)]'
              : 'tw:text-[var(--color-beta-muted)]'
          )}
          aria-pressed={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
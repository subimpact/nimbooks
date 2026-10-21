// shadcn's class merge helper: clsx for conditional names, tailwind-merge to
// let a later `tw:` class override an earlier one.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
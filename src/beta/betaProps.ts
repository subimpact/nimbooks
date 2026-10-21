// Prop types shared between the classic screens and the beta ports, so the
// two can never drift on inputs. Type-only: erased at build, so neither
// bundle grows and nothing crosses the lazy chunk boundary at runtime.

import type { ComponentProps } from 'react'
import type EarnCard from '../EarnCard'
import type YieldCalculator from '../YieldCalculator'

/** The props the classic and beta Earn cards share. */
export type EarnProps = ComponentProps<typeof EarnCard>
/** The props the classic yield calculator and the beta one share. */
export type CalcProps = ComponentProps<typeof YieldCalculator>
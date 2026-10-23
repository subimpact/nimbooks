// Staking terms: the four things the Nimiq Council's Cycle 3 ideas ask every
// Earn position to show (how it works, that the rate varies, what can go
// wrong, how long getting out takes), the restake loop for pools that pay
// rewards straight to the wallet, and a calendar reminder (mini apps have no
// push notifications).
//
// Pure and local: no network, no React. Copy lives here so the classic card,
// the beta card and the stake panel can never drift apart.

import { projectStake } from './yieldCalc'

/** Which pool a position is with, as far as the terms copy needs to know. */
export interface TermsValidator {
  name: string
  fee: number | null
  payoutType?: string
}

/** The four rows of a staking-terms block. */
export interface StakeTerms {
  howItWorks: string
  rate: string
  risk: string
  exit: string
}

const MAX_FREETEXT = 100

/**
 * A short human label for a validator's payout schedule.
 *
 * The API's `payoutSchedule` is free text: cron ('0 *(slash)6 * * *'), prose
 * ('Every 12 hours'), a sentence, or nothing. Cron is translated or dropped
 * (never shown raw); the rest is shown as given, trimmed and length-capped.
 * Null means "nothing to say".
 */
export function payoutScheduleLabel(raw: string | undefined | null): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  // Five whitespace-separated fields that look like cron: translate or drop.
  const parts = text.split(/\s+/)
  if (parts.length === 5 && parts.every((p) => /^[0-9*/,+-]+$/.test(p))) {
    if (parts[0] === '0' && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      return 'every hour'
    }
    const hourly = parts[0] === '0' && /^\*\/\d+$/.test(parts[1]) && parts.slice(2).every((p) => p === '*')
    if (hourly) {
      const n = Number(parts[1].slice(2))
      if (Number.isInteger(n) && n >= 1 && n <= 23) return n === 1 ? 'every hour' : `every ${n} hours`
      return null
    }
    const minutely = /^\*\/\d+$/.test(parts[0]) && parts.slice(1).every((p) => p === '*')
    if (minutely) {
      const n = Number(parts[0].slice(2))
      if (Number.isInteger(n) && n >= 1 && n <= 23) return n === 1 ? 'every minute' : `every ${n} minutes`
      return null
    }
    return null
  }

  const every = /^every\s+(\d+\s+)?(minute|minutes|hour|hours|day|days)$/i.exec(text)
  if (every) {
    const label = text.toLowerCase().replace(/\s+/g, ' ')
    if (label === 'every 1 minute') return 'every minute'
    if (label === 'every 1 hour') return 'every hour'
    return label
  }

  return text.length >= 1 && text.length <= MAX_FREETEXT ? text : null
}

/** `0.025` -> '2.5%', `0` -> '0%'. Locale-independent. */
function formatFee(fee: number): string {
  return `${Number((fee * 100).toFixed(2))}%`
}

/**
 * What restaking rewards adds over a year, NIM: the difference between a
 * compounding stake and one whose rewards are paid out. Null when there is
 * nothing to gain or nothing to gain it on.
 */
export function restakeGainNim({
  stakedNim,
  rate,
  now = Date.now(),
}: {
  stakedNim: number
  rate: number | null
  now?: number
}): number | null {
  if (rate === null || !(rate > 0) || !(stakedNim > 0)) return null
  const year = (compound: boolean) =>
    projectStake({ principalNim: stakedNim, annualRateNow: rate, months: 12, compound, now }).firstYearNim
  return year(true) - year(false)
}

/**
 * The four staking-terms rows for a position (or, with a null validator, for
 * staking in general).
 */
export function stakeTerms({
  validator,
  hasStaker,
  scheduleLabel,
}: {
  validator: TermsValidator | null
  hasStaker: boolean
  scheduleLabel: string | null
}): StakeTerms {
  const name = validator?.name?.trim() || null
  const feePart = validator && validator.fee !== null ? ` (${formatFee(validator.fee)} fee)` : ''

  const howItWorks =
    hasStaker && name
      ? `Nimiq proof-of-stake. Your NIM stays in your own staking record; ${name}${feePart} produces blocks with it and pays you the rewards.`
      : 'Nimiq proof-of-stake. Your NIM stays in your own staking record; the pool you pick produces blocks with it and pays you the rewards.'

  const rate =
    "Varies. It falls slowly as new NIM issuance declines, and moves with the pool's fee and how much NIM is staked network-wide."

  const baseRisk =
    'If the pool goes offline or is jailed, it earns nothing for those days. Under normal circumstances you cannot lose the staked NIM itself.'
  let risk = baseRisk
  if (name) {
    const schedSuffix = scheduleLabel
      ? scheduleLabel.startsWith('every')
        ? ` ${scheduleLabel}`
        : ` (schedule: ${scheduleLabel})`
      : ''
    if (validator?.payoutType === 'restake') {
      risk += ` ${name} adds your rewards to your stake${schedSuffix}.`
    } else if (validator?.payoutType === 'direct') {
      risk += ` ${name} pays rewards into your wallet${schedSuffix}, so you rely on the pool to pay.`
    } else {
      risk += ` ${name} does not say how it pays rewards, so you rely on the pool to pay.`
    }
  } else {
    risk += ' Pools pay rewards themselves, each on its own schedule.'
  }

  const exit =
    'Unstaking usually takes 12 hours to 4 days, in three steps: deactivate, retire, withdraw.'

  return { howItWorks, rate, risk, exit }
}

/** RFC 5545 TEXT escaping: backslash first, then ; , and newlines. */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC timestamp in the iCalendar basic format. */
function icsStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(
    d.getUTCMinutes()
  )}${p(d.getUTCSeconds())}Z`
}

/**
 * A weekly recurring "Restake your NIM rewards" event: the next day at 09:00
 * local time, 15 minutes long. Returns both a downloadable .ics and a Google
 * Calendar template link.
 *
 * Mini apps have no push notifications, so a calendar reminder is the honest
 * way to bring someone back to the restake loop.
 */
export function restakeReminder({ nowMs, appUrl }: { nowMs: number; appUrl: string }): {
  ics: string
  googleUrl: string
} {
  // Local setters on purpose: 09:00 means 09:00 where the user is, and the
  // UTC stamp below carries the right offset.
  const start = new Date(nowMs)
  start.setDate(start.getDate() + 1)
  start.setHours(9, 0, 0, 0)
  const end = new Date(start.getTime() + 15 * 60 * 1000)

  const title = 'Restake your NIM rewards'
  const description = `Open NimBooks and restake the rewards your pool paid out: ${appUrl}`
  const dtStart = icsStamp(start.getTime())
  const dtEnd = icsStamp(end.getTime())
  const dtStamp = icsStamp(nowMs)

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//NimBooks//Restake reminder//EN',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${nowMs}-restake@nimbooks.subimpact.net`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    'RRULE:FREQ=WEEKLY',
    `SUMMARY:${title}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const ics = lines.join('\r\n') + '\r\n'

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description,
    dates: `${dtStart}/${dtEnd}`,
    recur: 'RRULE:FREQ=WEEKLY',
  })
  const googleUrl = `https://calendar.google.com/calendar/render?${params.toString()}`

  return { ics, googleUrl }
}

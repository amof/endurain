/**
 * Calendar period math for the summary view. Every function works on date-only
 * strings (`YYYY-MM-DD`) or month strings (`YYYY-MM`) and computes purely
 * calendrical results in UTC, so the output never drifts with the viewer's
 * timezone (the classic `new Date('YYYY-MM-DD')` off-by-one trap).
 *
 * Period ranges return an **inclusive** end date to match the activities list
 * endpoint, whose date filter is `date(start_time) BETWEEN start AND end`
 * inclusive on both bounds. Week boundaries use the viewer's configured first
 * day of the week.
 */

import {
  monthEnd,
  monthLabel,
  monthStart,
  parseIsoDate,
  shiftMonths,
  shiftWeeks,
  todayIsoDate,
  weekEnd,
  weekStart,
  yearRange,
  type PeriodRange,
} from '@/utils/datetime'

export { monthEnd, monthLabel, monthStart, shiftMonths, shiftWeeks, weekEnd, weekStart, yearRange }
export type { PeriodRange }

/** Today's date as `YYYY-MM-DD` (the default week anchor). */
export function currentWeekAnchor(): string {
  return todayIsoDate()
}

/** The current month as `YYYY-MM` (the default month anchor). */
export function currentMonth(): string {
  return todayIsoDate().slice(0, 7)
}

/** The current calendar year (the default year anchor). */
export function currentYear(): number {
  return Number(todayIsoDate().slice(0, 4))
}

/**
 * Formats a date-only string as a localized medium date, pinned to UTC so the
 * day never shifts with the viewer's timezone.
 *
 * @param iso - The `YYYY-MM-DD` date.
 * @param locale - BCP-47 locale tag.
 * @returns The localized medium-style date (e.g. "Jun 15, 2026").
 */
export function formatPeriodDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    parseIsoDate(iso),
  )
}

/**
 * The localized full weekday name for a Monday-based day index.
 *
 * @param dayIndex - `0` = Monday … `6` = Sunday.
 * @param locale - BCP-47 locale tag.
 * @returns The localized weekday name (e.g. "Monday").
 */
export function weekdayLabel(dayIndex: number, locale: string): string {
  // 2024-01-01 is a Monday; add the index to land on the right weekday.
  const date = new Date(Date.UTC(2024, 0, 1 + dayIndex))
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date)
}

/**
 * The localized full month name for a 1-based month number.
 *
 * @param monthNumber - `1` = January … `12` = December.
 * @param locale - BCP-47 locale tag.
 * @returns The localized month name (e.g. "January").
 */
export function monthNameLabel(monthNumber: number, locale: string): string {
  const date = new Date(Date.UTC(2024, monthNumber - 1, 1))
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(date)
}

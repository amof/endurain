import type { Schemas } from '@/types'

import {
  monthEnd,
  monthStart,
  parseIsoDate,
  toIsoDate,
  weekEnd,
  weekStart,
  yearRange,
} from '@/utils/datetime'

/** How much time one period of the global map's timeline covers. */
export type PeriodSize = 'week' | 'month' | 'year'

/**
 * One period of the global map's timeline: a calendar week, month or year.
 *
 * @property start - Its first date (`YYYY-MM-DD`).
 * @property end - Its last date (`YYYY-MM-DD`), inclusive.
 */
export interface Period {
  start: string
  end: string
}

/**
 * Returns the period of a size that holds a date.
 *
 * @param iso - Any `YYYY-MM-DD` date.
 * @param size - The period size.
 * @param firstDayOfWeek - The viewer's first weekday, for weeks.
 * @returns The period holding `iso`.
 */
export function periodOf(
  iso: string,
  size: PeriodSize,
  firstDayOfWeek: Schemas['WeekDay'],
): Period {
  if (size === 'week') {
    return { start: weekStart(iso, firstDayOfWeek), end: weekEnd(iso, firstDayOfWeek) }
  }
  if (size === 'year') {
    const { startDate, endDate } = yearRange(Number(iso.slice(0, 4)))
    return { start: startDate, end: endDate }
  }
  const month = iso.slice(0, 7)
  return { start: monthStart(month), end: monthEnd(month) }
}

/**
 * Lists every period from the one holding `first` to the one holding `last`, empty ones included, so the timeline
 * keeps time linear and shows the gaps.
 *
 * @param first - The earliest date to cover (`YYYY-MM-DD`).
 * @param last - The latest date to cover (`YYYY-MM-DD`).
 * @param size - The period size.
 * @param firstDayOfWeek - The viewer's first weekday, for weeks.
 * @returns The periods in order; empty when `last` is before `first`.
 */
export function periodsBetween(
  first: string,
  last: string,
  size: PeriodSize,
  firstDayOfWeek: Schemas['WeekDay'],
): Period[] {
  const periods: Period[] = []
  let period = periodOf(first, size, firstDayOfWeek)
  while (period.start <= last) {
    periods.push(period)
    const next = toIsoDate(new Date(parseIsoDate(period.end).getTime() + 86_400_000))
    period = periodOf(next, size, firstDayOfWeek)
  }
  return periods
}

/**
 * Tells whether a date range shares at least one day with a period.
 *
 * @param period - The period.
 * @param startDate - The range's first date (`YYYY-MM-DD`).
 * @param endDate - The range's last date (`YYYY-MM-DD`), inclusive.
 * @returns Whether the two overlap.
 */
export function overlapsPeriod(period: Period, startDate: string, endDate: string): boolean {
  return startDate <= period.end && endDate >= period.start
}

/**
 * Counts, for each period, the date ranges that share at least one day with it.
 *
 * @param periods - Consecutive periods, in order, as {@link periodsBetween} lists them.
 * @param ranges - The date ranges (`YYYY-MM-DD`, end inclusive) to count.
 * @returns The count of each period, in the same order.
 */
export function periodCounts(
  periods: readonly Period[],
  ranges: ReadonlyArray<{ startDate: string; endDate: string }>,
): number[] {
  const counts = periods.map(() => 0)
  for (const { startDate, endDate } of ranges) {
    // Binary search for the first period that ends on or after the range's start.
    let low = 0
    let high = periods.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((periods[middle]?.end ?? '') < startDate) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    for (let index = low; index < periods.length; index++) {
      if ((periods[index]?.start ?? '') > endDate) {
        break
      }
      counts[index] = (counts[index] ?? 0) + 1
    }
  }
  return counts
}

/**
 * Finds the nearest period with a non-zero count before or after a given one.
 *
 * @param counts - The count of each period, in order.
 * @param from - The index to search from, excluded.
 * @param direction - `-1` to search earlier periods, `1` later ones.
 * @returns The index found, or `null` when there is none in that direction.
 */
export function nearestNonEmpty(
  counts: readonly number[],
  from: number,
  direction: -1 | 1,
): number | null {
  for (let index = from + direction; index >= 0 && index < counts.length; index += direction) {
    if ((counts[index] ?? 0) > 0) {
      return index
    }
  }
  return null
}

import { computed, ref, watch, type Ref } from 'vue'

import type { ActivityBadgeType } from '@/components/ui/activity-type-badge'
import type { ActivityTrack, Journey, Outing } from '@/features/activities/types'
import type { Period, PeriodSize } from '@/features/activities/utils/mapPeriods'
import type { Schemas } from '@/types'

import { activityBadgeCategory } from '@/features/activities/utils/activityType'
import { findJourneys } from '@/features/activities/utils/journeys'
import {
  nearestNonEmpty,
  overlapsPeriod,
  periodCounts,
  periodsBetween,
} from '@/features/activities/utils/mapPeriods'

/**
 * One track with the dates it is drawn under: its journey's for a journey's track, so a journey shows whole in every
 * period it overlaps.
 *
 * @property track - The track.
 * @property startDate - The first date it is drawn under (`YYYY-MM-DD`).
 * @property endDate - The last date it is drawn under (`YYYY-MM-DD`), inclusive.
 */
interface FiledTrack {
  track: ActivityTrack
  startDate: string
  endDate: string
}

/**
 * The global map's derived state: the journeys among the viewer's tracks, the period shown on the timeline, the
 * tracks it draws and what happened in it, and the outings the viewer selected.
 *
 * A journey is drawn whole in every period it overlaps, while the counts take each activity in the period it
 * happened in. A new list of periods, after a refetch or a change of period size, keeps the time shown: it moves to
 * the latest period with activities within the period shown before, else to the period holding its start, else to the
 * latest period. A selection belongs to the period it was made in, so a change of period clears it.
 *
 * @param tracks - Every track of the viewer.
 * @param firstDayOfWeek - The viewer's first weekday, for weekly periods.
 * @returns The journey of each activity; the period size and index (both writable); the periods and the number of
 *   activities in each; the period shown (`null` for all time), the tracks it draws, its number of activities and
 *   journeys and its activities per sport category; the nearest earlier and later periods with activities (`null`
 *   when there is none); and the selected activity ids (writable), their outings, most recent first, and the ids
 *   they highlight.
 */
export function useGlobalMap(
  tracks: Readonly<Ref<readonly ActivityTrack[]>>,
  firstDayOfWeek: Readonly<Ref<Schemas['WeekDay']>>,
) {
  const journeyOf = computed(() => {
    const byActivity = new Map<string, Journey>()
    for (const journey of findJourneys(tracks.value)) {
      for (const id of journey.activityIds) {
        byActivity.set(id, journey)
      }
    }
    return byActivity
  })

  const filed = computed<FiledTrack[]>(() =>
    tracks.value.map((track) => {
      const journey = journeyOf.value.get(track.activityId)
      return {
        track,
        startDate: journey?.startDate ?? track.startDate,
        endDate: journey?.endDate ?? track.endDate,
      }
    }),
  )

  const size = ref<PeriodSize | 'all'>('all')
  const index = ref(0)

  const periods = computed<Period[]>(() => {
    const periodSize = size.value
    if (periodSize === 'all' || tracks.value.length === 0) {
      return []
    }
    let first = '9999-12-31'
    let last = '0000-01-01'
    for (const { startDate, endDate } of tracks.value) {
      first = startDate < first ? startDate : first
      last = endDate > last ? endDate : last
    }
    return periodsBetween(first, last, periodSize, firstDayOfWeek.value)
  })
  const counts = computed(() => periodCounts(periods.value, tracks.value))
  const period = computed<Period | null>(() => periods.value[index.value] ?? null)

  watch(periods, (next, previous) => {
    const before = previous[index.value]
    const latest = Math.max(0, next.length - 1)
    if (!before) {
      index.value = latest
      return
    }
    const overlapping = next.flatMap((candidate, position) =>
      overlapsPeriod(candidate, before.start, before.end) ? [position] : [],
    )
    const withActivities = overlapping.filter((position) => (counts.value[position] ?? 0) > 0)
    index.value = withActivities[withActivities.length - 1] ?? overlapping[0] ?? latest
  })

  const visibleTracks = computed<readonly ActivityTrack[]>(() => {
    const current = period.value
    if (!current) {
      return tracks.value
    }
    return filed.value
      .filter(({ startDate, endDate }) => overlapsPeriod(current, startDate, endDate))
      .map(({ track }) => track)
  })

  /** The activities that happened in the period shown: every one for all time. */
  const periodTracks = computed<readonly ActivityTrack[]>(() => {
    const current = period.value
    return current
      ? tracks.value.filter((track) => overlapsPeriod(current, track.startDate, track.endDate))
      : tracks.value
  })
  const activityCount = computed(() => periodTracks.value.length)
  const journeyCount = computed(
    () =>
      new Set(
        periodTracks.value.flatMap((track) => journeyOf.value.get(track.activityId)?.id ?? []),
      ).size,
  )
  const categoryCounts = computed(() => {
    const result: Record<ActivityBadgeType, number> = {
      running: 0,
      cycling: 0,
      swimming: 0,
      hiking: 0,
      other: 0,
    }
    for (const track of periodTracks.value) {
      result[activityBadgeCategory(track.activityType)] += 1
    }
    return result
  })

  const previousIndex = computed(() => nearestNonEmpty(counts.value, index.value, -1))
  const nextIndex = computed(() => nearestNonEmpty(counts.value, index.value, 1))

  /** The ids of the tracks under the last click. */
  const selectedIds = ref<string[]>([])
  watch(
    () => `${size.value}:${period.value?.start ?? ''}`,
    () => {
      selectedIds.value = []
    },
  )

  const startOf = computed(
    () => new Map(tracks.value.map((track) => [track.activityId, Date.parse(track.startTime)])),
  )
  /** The selected outings: a journey once however many of its tracks were hit, or a single activity. */
  const outings = computed<Outing[]>(() => {
    const seen = new Map<string, Outing>()
    for (const id of selectedIds.value) {
      const journey = journeyOf.value.get(id) ?? null
      const key = journey?.id ?? id
      if (!seen.has(key)) {
        seen.set(key, { id: key, journey, activityIds: journey?.activityIds ?? [id] })
      }
    }
    const started = (outing: Outing): number => startOf.value.get(outing.activityIds[0] ?? '') ?? 0
    return [...seen.values()].sort((a, b) => started(b) - started(a))
  })
  const highlighted = computed<ReadonlySet<string>>(
    () => new Set(outings.value.flatMap((outing) => outing.activityIds)),
  )

  return {
    journeyOf,
    size,
    index,
    periods,
    counts,
    period,
    visibleTracks,
    activityCount,
    journeyCount,
    categoryCounts,
    previousIndex,
    nextIndex,
    selectedIds,
    outings,
    highlighted,
  }
}

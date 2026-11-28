import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { point } from 'leaflet'

import type { GeoPoint, MapOverviewTrack } from '@/composables/useMapProvider'
import type { ActivityTrack, ActivityTrackDto } from '@/features/activities/types'

import { apiFetch } from '@/services/http'
import { useGlobalMap } from '@/features/activities/composables/useGlobalMap'
import { fetchActivityTracks, mapActivityTrack } from '@/features/activities/services/activities'
import { findJourneys } from '@/features/activities/utils/journeys'
import {
  nearestNonEmpty,
  overlapsPeriod,
  periodCounts,
  periodOf,
  periodsBetween,
} from '@/features/activities/utils/mapPeriods'
import { decodePolyline } from '@/features/activities/utils/polyline'
import { clusterPoints, idsNear, mountLeafletOverview } from '@/providers/leafletOverviewMap'
import { activityUuid } from './fixtures/activity'

vi.mock('@/services/http', () => ({ apiFetch: vi.fn<typeof apiFetch>() }))

afterEach(() => {
  vi.mocked(apiFetch).mockReset()
})

/** Roughly 1 km of latitude. */
const KM = 0.009

const HOME: GeoPoint = { lat: 45, lng: 6 }
const WORK: GeoPoint = { lat: 45 + 10 * KM, lng: 6 }

let nextId = 1

/** A track from `from` to `to`, with a midpoint off the straight line so it is never a loop by accident. */
function track(from: GeoPoint, to: GeoPoint, start: string, end: string): ActivityTrack {
  return {
    activityId: activityUuid(nextId++),
    activityType: 'hike',
    startTime: start,
    endTime: end,
    startDate: start.slice(0, 10),
    endDate: end.slice(0, 10),
    points: [from, { lat: (from.lat + to.lat) / 2, lng: from.lng + 5 * KM }, to],
  }
}

/** A point `km` north of home. */
function north(km: number): GeoPoint {
  return { lat: HOME.lat + km * KM, lng: HOME.lng }
}

describe('decodePolyline', () => {
  it('decodes the worked example of the encoded polyline format', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
  })

  it('decodes an empty track to no points', () => {
    expect(decodePolyline('')).toEqual([])
  })
})

describe('fetchActivityTracks', () => {
  it('follows the cursor past an empty slice and decodes each track', async () => {
    const dto: ActivityTrackDto = {
      activity_id: activityUuid(1),
      activity_type: 'run',
      started_at: '2026-07-01T07:00:00Z',
      ended_at: '2026-07-01T08:00:00Z',
      start_date: '2026-07-01',
      end_date: '2026-07-01',
      track: '_p~iF~ps|U_ulLnnqC',
    }
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ items: [dto], num_records: 200, next_cursor: 'first' })
      .mockResolvedValueOnce({ items: [], num_records: 200, next_cursor: 'second' })
      .mockResolvedValueOnce({
        items: [{ ...dto, activity_id: activityUuid(2) }],
        num_records: 200,
        next_cursor: null,
      })

    const tracks = await fetchActivityTracks()

    expect(tracks.map((t) => t.activityId)).toEqual([activityUuid(1), activityUuid(2)])
    expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual([
      '/activities/tracks?num_records=200',
      '/activities/tracks?num_records=200&cursor=first',
      '/activities/tracks?num_records=200&cursor=second',
    ])
    expect(tracks[0]).toEqual(mapActivityTrack(dto))
    expect(tracks[0]?.points).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
    ])
  })
})

describe('periods', () => {
  it('finds the week, month and year holding a date', () => {
    expect(periodOf('2026-07-15', 'week', 'monday')).toEqual({
      start: '2026-07-13',
      end: '2026-07-19',
    })
    expect(periodOf('2026-07-15', 'week', 'sunday')).toEqual({
      start: '2026-07-12',
      end: '2026-07-18',
    })
    expect(periodOf('2024-02-10', 'month', 'monday')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    })
    expect(periodOf('2026-07-15', 'year', 'monday')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    })
  })

  it('lists every period between two dates, empty ones included', () => {
    expect(periodsBetween('2025-11-20', '2026-02-03', 'month', 'monday')).toEqual([
      { start: '2025-11-01', end: '2025-11-30' },
      { start: '2025-12-01', end: '2025-12-31' },
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
    ])
  })

  it('counts a range in every period it shares a day with', () => {
    const week = { start: '2026-07-13', end: '2026-07-19' }
    expect(overlapsPeriod(week, '2026-07-18', '2026-07-21')).toBe(true)
    expect(overlapsPeriod(week, '2026-07-10', '2026-07-13')).toBe(true)
    expect(overlapsPeriod(week, '2026-07-20', '2026-07-21')).toBe(false)
  })

  it('counts the ranges of each period, a range across two periods in both', () => {
    const months = periodsBetween('2026-01-01', '2026-04-30', 'month', 'monday')

    expect(
      periodCounts(months, [
        { startDate: '2026-01-10', endDate: '2026-01-10' },
        { startDate: '2026-01-31', endDate: '2026-02-02' },
        { startDate: '2026-04-30', endDate: '2026-04-30' },
      ]),
    ).toEqual([2, 1, 0, 1])
  })

  it('finds the nearest period with activities on either side, past the empty ones', () => {
    const counts = [1, 0, 0, 2, 0]

    expect(nearestNonEmpty(counts, 3, -1)).toBe(0)
    expect(nearestNonEmpty(counts, 0, 1)).toBe(3)
    expect(nearestNonEmpty(counts, 3, 1)).toBeNull()
  })
})

describe('useGlobalMap', () => {
  /** A one-day track on a date, too short to be part of a journey. */
  function outing(date: string): ActivityTrack {
    return track(north(0), north(10), `${date}T07:00:00Z`, `${date}T08:00:00Z`)
  }

  it('starts a period size on its latest period and keeps the period shown when the tracks are read again', async () => {
    const tracks = ref([outing('2026-01-05'), outing('2026-03-10'), outing('2026-05-02')])
    const map = useGlobalMap(tracks, ref('monday'))

    map.size.value = 'month'
    await nextTick()
    expect(map.period.value?.start).toBe('2026-05-01')

    map.index.value = 2
    tracks.value = tracks.value.map((current) => ({ ...current }))
    await nextTick()
    expect(map.period.value?.start).toBe('2026-03-01')
    expect(map.visibleTracks.value.map((current) => current.startDate)).toEqual(['2026-03-10'])
  })

  it('keeps the time shown when the period size changes', async () => {
    const map = useGlobalMap(
      ref([outing('2026-03-03'), outing('2026-03-17'), outing('2026-06-01')]),
      ref('monday'),
    )
    map.size.value = 'month'
    await nextTick()
    map.index.value = 0

    map.size.value = 'week'
    await nextTick()
    // The latest week of March with an activity.
    expect(map.period.value).toEqual({ start: '2026-03-16', end: '2026-03-22' })

    map.size.value = 'year'
    await nextTick()
    expect(map.period.value?.start).toBe('2026-01-01')
  })

  it('draws a journey whole in every period it overlaps, and counts each activity in its own', async () => {
    const trek = [
      track(north(0), north(20), '2026-07-31T07:00:00Z', '2026-07-31T16:00:00Z'),
      track(north(20), north(40), '2026-08-01T07:00:00Z', '2026-08-01T16:00:00Z'),
    ]
    const autumn = outing('2026-10-04')
    const map = useGlobalMap(ref([...trek, autumn]), ref('monday'))
    map.size.value = 'month'
    await nextTick()

    expect(map.counts.value).toEqual([1, 1, 0, 1])
    map.index.value = 1
    expect(map.visibleTracks.value).toEqual(trek)
    expect(map.activityCount.value).toBe(1)
    expect(map.journeyCount.value).toBe(1)
    expect(map.categoryCounts.value).toEqual({
      running: 0,
      cycling: 0,
      swimming: 0,
      hiking: 1,
      other: 0,
    })
    expect(map.nextIndex.value).toBe(3)
    expect(map.previousIndex.value).toBe(0)
  })

  it('counts every activity and journey for all time', () => {
    const trek = [
      track(north(0), north(20), '2026-07-31T07:00:00Z', '2026-07-31T16:00:00Z'),
      track(north(20), north(40), '2026-08-01T07:00:00Z', '2026-08-01T16:00:00Z'),
    ]
    const map = useGlobalMap(ref([...trek, outing('2026-10-04')]), ref('monday'))

    expect(map.period.value).toBeNull()
    expect(map.activityCount.value).toBe(3)
    expect(map.journeyCount.value).toBe(1)
  })

  it('lists a journey once however many of its tracks were hit, most recent outing first', () => {
    const trek = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20), north(40), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
    ]
    const later = outing('2026-08-02')
    const map = useGlobalMap(ref([...trek, later]), ref('monday'))

    map.selectedIds.value = [trek[1]?.activityId ?? '', trek[0]?.activityId ?? '', later.activityId]

    expect(map.outings.value.map((current) => current.activityIds)).toEqual([
      [later.activityId],
      trek.map((current) => current.activityId),
    ])
    expect(map.outings.value[1]?.journey?.id).toBe(trek[0]?.activityId)
    expect(map.highlighted.value).toEqual(
      new Set([later.activityId, ...trek.map((current) => current.activityId)]),
    )
  })

  it('lists every journey with an activity in the period shown, most recent first', async () => {
    const july = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20), north(40), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
    ]
    const august = [
      track(north(100), north(120), '2026-08-08T07:00:00Z', '2026-08-08T16:00:00Z'),
      track(north(120), north(140), '2026-08-09T07:00:00Z', '2026-08-09T16:00:00Z'),
    ]
    const single = outing('2026-07-25')
    const map = useGlobalMap(ref([...july, single, ...august]), ref('monday'))

    expect(map.journeyOutings.value.map((current) => current.activityIds)).toEqual([
      august.map((current) => current.activityId),
      july.map((current) => current.activityId),
    ])
    expect(map.journeyOutings.value[0]?.journey?.id).toBe(august[0]?.activityId)

    map.size.value = 'month'
    await nextTick()
    map.index.value = 0
    expect(map.journeyOutings.value.map((current) => current.activityIds)).toEqual([
      july.map((current) => current.activityId),
    ])
  })

  it('draws and counts only the activities of journeys when asked, and keeps only journeys selected', async () => {
    const trek = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20), north(40), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
    ]
    const single = outing('2026-08-02')
    const map = useGlobalMap(ref([...trek, single]), ref('monday'))
    map.selectedIds.value = [single.activityId, trek[0]?.activityId ?? '']

    map.journeysOnly.value = true
    await nextTick()

    expect(map.visibleTracks.value).toEqual(trek)
    expect(map.outings.value.map((current) => current.activityIds)).toEqual([
      trek.map((current) => current.activityId),
    ])
    expect(map.activityCount.value).toBe(2)
    expect(map.journeyCount.value).toBe(1)
    expect(map.categoryCounts.value.hiking).toBe(2)

    map.size.value = 'month'
    await nextTick()
    // The periods end with the last journey, so the map opens on July rather than on August.
    expect(map.counts.value).toEqual([2])
    expect(map.period.value?.start).toBe('2026-07-01')

    map.journeysOnly.value = false
    await nextTick()
    expect(map.counts.value).toEqual([2, 1])
    expect(map.period.value?.start).toBe('2026-07-01')
  })

  it('shows every activity again once the viewer has no journey left', async () => {
    const trek = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20), north(40), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
    ]
    const single = outing('2026-08-02')
    const tracks = ref([...trek, single])
    const map = useGlobalMap(tracks, ref('monday'))
    map.journeysOnly.value = true
    expect(map.hasJourneys.value).toBe(true)

    tracks.value = [trek[0] as ActivityTrack, single]
    await nextTick()

    expect(map.hasJourneys.value).toBe(false)
    expect(map.journeysOnly.value).toBe(false)
    expect(map.visibleTracks.value).toEqual(tracks.value)
  })

  it('clears the selection when another period is shown', async () => {
    const tracks = [outing('2026-01-05'), outing('2026-03-10')]
    const map = useGlobalMap(ref(tracks), ref('monday'))
    map.size.value = 'month'
    await nextTick()

    map.selectedIds.value = [tracks[1]?.activityId ?? '']
    map.index.value = 0
    await nextTick()

    expect(map.outings.value).toEqual([])
  })
})

describe('findJourneys', () => {
  it('chains a multi-day trek whose days start where the previous ended', () => {
    const days = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20.3), north(40), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
      track(north(40), north(60), '2026-07-20T07:00:00Z', '2026-07-20T16:00:00Z'),
    ]

    expect(findJourneys(days)).toEqual([
      {
        id: days[0]?.activityId,
        activityIds: days.map((day) => day.activityId),
        startDate: '2026-07-18',
        endDate: '2026-07-20',
      },
    ])
  })

  it('links across a rest day but not across a longer pause or a gap in place', () => {
    const tracks = [
      track(north(0), north(20), '2026-07-01T07:00:00Z', '2026-07-01T16:00:00Z'),
      track(north(20), north(40), '2026-07-03T07:00:00Z', '2026-07-03T16:00:00Z'),
      track(north(40), north(60), '2026-07-06T07:00:00Z', '2026-07-06T16:00:00Z'),
      track(north(65), north(80), '2026-07-07T07:00:00Z', '2026-07-07T16:00:00Z'),
    ]

    expect(findJourneys(tracks).map((journey) => journey.activityIds)).toEqual([
      [tracks[0]?.activityId, tracks[1]?.activityId],
    ])
  })

  it('never chains loops, such as daily runs from home', () => {
    const loops = [1, 2, 3].map((day) => ({
      ...track(HOME, HOME, `2026-07-0${day}T07:00:00Z`, `2026-07-0${day}T08:00:00Z`),
    }))

    expect(findJourneys(loops)).toEqual([])
  })

  it('does not chain commutes through home and work', () => {
    const commutes = [1, 2, 3].flatMap((day) => [
      track(HOME, WORK, `2026-07-0${day}T07:00:00Z`, `2026-07-0${day}T07:40:00Z`),
      track(WORK, HOME, `2026-07-0${day}T17:00:00Z`, `2026-07-0${day}T17:40:00Z`),
    ])

    expect(findJourneys(commutes)).toEqual([])
  })

  it('never links at a place used in three different weeks, such as work on a one-way commute', () => {
    // To work on Monday and home on Tuesday, three weeks running.
    const commutes = [
      ['2026-07-06', '2026-07-07'],
      ['2026-07-13', '2026-07-14'],
      ['2026-07-20', '2026-07-21'],
    ].flatMap(([monday, tuesday]) => [
      track(HOME, WORK, `${monday}T07:00:00Z`, `${monday}T07:40:00Z`),
      track(WORK, HOME, `${tuesday}T17:00:00Z`, `${tuesday}T17:40:00Z`),
    ])

    expect(findJourneys(commutes)).toEqual([])
  })

  it('keeps an out-and-back trek whole, though it passes the same hut twice', () => {
    const hut = north(20)
    const days = [
      track(north(0), hut, '2026-07-13T07:00:00Z', '2026-07-13T16:00:00Z'),
      track(hut, north(40), '2026-07-14T07:00:00Z', '2026-07-14T16:00:00Z'),
      track(north(40), hut, '2026-07-15T07:00:00Z', '2026-07-15T16:00:00Z'),
      track(hut, north(0), '2026-07-16T07:00:00Z', '2026-07-16T16:00:00Z'),
    ]

    expect(findJourneys(days).map((journey) => journey.activityIds)).toEqual([
      days.map((day) => day.activityId),
    ])
  })

  it('keeps a loop from a hut on a rest day inside the trek', () => {
    const hut = north(20)
    const days = [
      track(north(0), hut, '2026-07-13T07:00:00Z', '2026-07-13T16:00:00Z'),
      track(hut, hut, '2026-07-14T09:00:00Z', '2026-07-14T13:00:00Z'),
      track(hut, north(40), '2026-07-15T07:00:00Z', '2026-07-15T16:00:00Z'),
    ]

    expect(findJourneys(days).map((journey) => journey.activityIds)).toEqual([
      days.map((day) => day.activityId),
    ])
  })

  it('does not make a journey of one stage and a loop where it ended', () => {
    const hut = north(20)
    const days = [
      track(north(0), hut, '2026-07-13T07:00:00Z', '2026-07-13T16:00:00Z'),
      track(hut, hut, '2026-07-14T09:00:00Z', '2026-07-14T13:00:00Z'),
    ]

    expect(findJourneys(days)).toEqual([])
  })

  it('closes a round trek once it is back at its start', () => {
    const tracks = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T16:00:00Z'),
      track(north(20), north(0), '2026-07-19T07:00:00Z', '2026-07-19T16:00:00Z'),
      track(north(0), north(30), '2026-07-20T07:00:00Z', '2026-07-20T16:00:00Z'),
    ]

    expect(findJourneys(tracks).map((journey) => journey.activityIds)).toEqual([
      [tracks[0]?.activityId, tracks[1]?.activityId],
    ])
  })

  it('leaves a chain within one day as separate activities', () => {
    const tracks = [
      track(north(0), north(20), '2026-07-18T07:00:00Z', '2026-07-18T11:00:00Z'),
      track(north(20), north(40), '2026-07-18T13:00:00Z', '2026-07-18T16:00:00Z'),
    ]

    expect(findJourneys(tracks)).toEqual([])
  })
})

describe('clusterPoints', () => {
  it('groups the points within the radius of the first point of their group, each point once', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 39 },
      { x: 200, y: 200 },
      { x: 205, y: 210 },
      { x: 500, y: 0 },
    ]

    expect(clusterPoints(points, 40)).toEqual([[0, 1, 2], [3, 4], [5]])
  })

  it('leaves apart two points in neighbouring cells that are farther than the radius', () => {
    expect(
      clusterPoints(
        [
          { x: 39, y: 0 },
          { x: 81, y: 0 },
        ],
        40,
      ),
    ).toEqual([[0], [1]])
  })
})

describe('idsNear', () => {
  it('returns every line within the tolerance, not only the topmost', () => {
    const lines = [
      { id: 'a', points: [point(0, 0), point(100, 0)] },
      { id: 'b', points: [point(0, 5), point(100, 5)] },
      { id: 'c', points: [point(0, 50), point(100, 50)] },
    ]

    expect(idsNear(point(50, 2), lines, 8)).toEqual(['a', 'b'])
    expect(idsNear(point(50, 30), lines, 8)).toEqual([])
  })
})

describe('mountLeafletOverview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  /** Mounts an 800 by 600 pixel overview of the tracks; jsdom has no layout or canvas, so both are stubbed. */
  function mountOverview(tracks: MapOverviewTrack[], dots = true) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: () => () => {} }) as never,
    )
    const target = document.createElement('div')
    Object.defineProperties(target, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    document.body.append(target)
    const onSelect = vi.fn<(ids: string[]) => void>()
    mountLeafletOverview(
      target,
      { tracks, highlighted: new Set(), dots, onSelect, clusterLabel: String },
      () => {},
    )
    return { target, onSelect }
  }

  /** Presses a key on the map itself, as a viewer who tabbed to it does. */
  function press(target: HTMLElement, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }

  it('lists the tracks drawn across its centre when Enter is pressed on it', () => {
    const { target, onSelect } = mountOverview([
      { id: 'across', color: 'red', points: [HOME, { lat: 45.2, lng: 6.2 }] },
      {
        id: 'aside',
        color: 'red',
        points: [
          { lat: 45, lng: 6.2 },
          { lat: 45.05, lng: 6.15 },
        ],
      },
    ])

    expect(target.tabIndex).toBe(0)
    press(target, 'a')
    expect(onSelect).not.toHaveBeenCalled()
    press(target, 'Enter')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(['across'])
  })

  it('lists a track drawn as a dot at its centre when Enter is pressed on it', () => {
    const { target, onSelect } = mountOverview([
      { id: 'dot', color: 'red', points: [HOME, { lat: 45.0001, lng: 6.0001 }] },
    ])

    press(target, 'Enter')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(['dot'])
  })

  it('draws every track as its line, with no dot or bubble, when dots are off', () => {
    const tiny = (id: string): MapOverviewTrack => ({
      id,
      color: 'red',
      points: [HOME, { lat: 45.0001, lng: 6.0001 }],
    })
    // Two tracks too small to read, close together: a bubble when dots are on.
    expect(
      mountOverview([tiny('a'), tiny('b')]).target.querySelectorAll('.leaflet-marker-icon'),
    ).toHaveLength(1)
    document.body.replaceChildren()

    const { target, onSelect } = mountOverview([tiny('a'), tiny('b')], false)

    expect(target.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0)
    press(target, 'Enter')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(['a', 'b'])
  })
})

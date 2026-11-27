import type { GeoPoint } from '@/composables/useMapProvider'
import type { ActivityTrack, Journey } from '@/features/activities/types'

import { weekStart } from '@/utils/datetime'

/** How close one activity's end and the next one's start must be to link, and the radius of a place, in metres. */
export const LINK_DISTANCE_METRES = 1000
/** The longest pause between two activities of a journey, in milliseconds. */
export const LINK_GAP_MS = 48 * 3_600_000
/**
 * The number of different weeks with a start or an end at a place that makes it a frequent place. Weeks rather than
 * days, so a hut a trek stays at, or passes again on its way back, is not taken for home.
 */
export const FREQUENT_PLACE_WEEKS = 3

const EARTH_RADIUS_METRES = 6_371_000
const METRES_PER_DEGREE = (EARTH_RADIUS_METRES * Math.PI) / 180
/** The size of a grid cell, in degrees of latitude: one link distance. */
const CELL_DEGREES = LINK_DISTANCE_METRES / METRES_PER_DEGREE

/**
 * Returns the great-circle distance between two points.
 *
 * @param a - The first point.
 * @param b - The second point.
 * @returns The distance in metres.
 */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const toRadians = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRadians
  const dLng = (b.lng - a.lng) * toRadians
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRadians) * Math.cos(b.lat * toRadians) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A start or an end of a track, with the first day of the week it happened in (weeks start on Monday). */
interface Endpoint {
  point: GeoPoint
  week: string
}

/** The grid column of a longitude in a row, with the row's own scale so neighbours agree. */
function columnOf(lng: number, row: number): number {
  const scale = Math.cos(((row + 0.5) * CELL_DEGREES * Math.PI) / 180)
  return Math.floor((lng * scale) / CELL_DEGREES)
}

/**
 * Builds the frequent-place test over every track's start and end. The endpoints sit in a grid of cells one link
 * distance wide, so a lookup only measures the endpoints of the cells around the point.
 *
 * @param tracks - Every track of the viewer.
 * @returns A test telling whether a point is a frequent place.
 */
function frequentPlaceTest(tracks: readonly ActivityTrack[]): (point: GeoPoint) => boolean {
  const grid = new Map<string, Endpoint[]>()
  const add = (endpoint: Endpoint): void => {
    const row = Math.floor(endpoint.point.lat / CELL_DEGREES)
    const key = `${row}:${columnOf(endpoint.point.lng, row)}`
    const cell = grid.get(key)
    if (cell) {
      cell.push(endpoint)
    } else {
      grid.set(key, [endpoint])
    }
  }
  for (const track of tracks) {
    const first = track.points[0]
    const last = track.points[track.points.length - 1]
    if (first && last) {
      add({ point: first, week: weekStart(track.startDate, 'monday') })
      add({ point: last, week: weekStart(track.endDate, 'monday') })
    }
  }

  return (point) => {
    const weeks = new Set<string>()
    const row = Math.floor(point.lat / CELL_DEGREES)
    for (let r = row - 1; r <= row + 1; r++) {
      const column = columnOf(point.lng, r)
      for (let c = column - 1; c <= column + 1; c++) {
        for (const endpoint of grid.get(`${r}:${c}`) ?? []) {
          if (distanceMetres(point, endpoint.point) <= LINK_DISTANCE_METRES) {
            weeks.add(endpoint.week)
          }
        }
      }
    }
    return weeks.size >= FREQUENT_PLACE_WEEKS
  }
}

/** The first and last point of a track with at least two points. */
function endsOf(track: ActivityTrack): { start: GeoPoint; end: GeoPoint } | null {
  const start = track.points[0]
  const end = track.points[track.points.length - 1]
  return start && end && track.points.length >= 2 ? { start, end } : null
}

/**
 * Finds the journeys among the viewer's tracks: chains of activities, each starting within {@link LINK_GAP_MS} of
 * the one before, where each stage starts within {@link LINK_DISTANCE_METRES} of where the previous stage ended. A
 * loop (an activity that ends where it started) never links two stages, but one that starts where the journey is,
 * such as a hike from a hut on a rest day, is part of it. A journey closes once it is back at its own start, and no
 * link is made at a frequent place (home, work, a club), so loops from home and commutes do not chain. A chain of
 * fewer than two stages, or that stays within one local day, is not a journey.
 *
 * @param tracks - Every track of the viewer, in any order.
 * @returns The journeys, in chronological order.
 */
export function findJourneys(tracks: readonly ActivityTrack[]): Journey[] {
  const isFrequentPlace = frequentPlaceTest(tracks)
  const ordered = tracks
    .flatMap((track) => {
      const ends = endsOf(track)
      return ends
        ? [
            {
              track,
              ...ends,
              loop: distanceMetres(ends.start, ends.end) <= LINK_DISTANCE_METRES,
              startMs: Date.parse(track.startTime),
              endMs: Date.parse(track.endTime),
            },
          ]
        : []
    })
    .sort((a, b) => a.startMs - b.startMs)
  type Entry = (typeof ordered)[number]

  const journeys: Journey[] = []
  /** The activities of the chain being built, in order. */
  let chain: Entry[] = []
  /** The chain's last stage, where the journey is; `null` while the chain holds only a loop. */
  let stage: Entry | null = null
  /** When the chain's latest activity ended, in milliseconds. */
  let endedMs = 0

  const continues = (next: Entry): boolean => {
    const first = chain[0]
    if (!first || !stage) {
      return false
    }
    const gap = next.startMs - endedMs
    return (
      gap >= 0 &&
      gap <= LINK_GAP_MS &&
      distanceMetres(stage.end, first.start) > LINK_DISTANCE_METRES &&
      distanceMetres(stage.end, next.start) <= LINK_DISTANCE_METRES &&
      !isFrequentPlace(stage.end)
    )
  }

  const close = (): void => {
    const first = chain[0]
    const last = chain[chain.length - 1]
    const stages = chain.filter((entry) => !entry.loop).length
    if (stages >= 2 && first && last && first.track.startDate !== last.track.endDate) {
      journeys.push({
        id: first.track.activityId,
        activityIds: chain.map((entry) => entry.track.activityId),
        startDate: first.track.startDate,
        endDate: last.track.endDate,
      })
    }
  }

  for (const entry of ordered) {
    if (continues(entry)) {
      chain.push(entry)
      stage = entry.loop ? stage : entry
      endedMs = Math.max(endedMs, entry.endMs)
    } else {
      close()
      chain = [entry]
      stage = entry.loop ? null : entry
      endedMs = entry.endMs
    }
  }
  close()
  return journeys
}

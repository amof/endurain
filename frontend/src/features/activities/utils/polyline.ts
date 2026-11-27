import type { GeoPoint } from '@/composables/useMapProvider'

/** The scale of an encoded polyline with five decimals. */
const PRECISION = 1e5

/**
 * Decodes a Google encoded polyline with five decimals, the format the tracks endpoint answers with.
 *
 * @param encoded - The encoded polyline.
 * @returns The points, in order; empty for an empty string.
 */
export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = []
  let index = 0
  let lat = 0
  let lng = 0

  /** Reads one signed delta starting at `index`. */
  const readDelta = (): number => {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    lat += readDelta()
    lng += readDelta()
    points.push({ lat: lat / PRECISION, lng: lng / PRECISION })
  }
  return points
}

/**
 * The Leaflet provider's overview map: many tracks on one canvas. A track too small to read at the current zoom is
 * drawn as a dot instead of a line, and nearby dots merge into a bubble counting their tracks, so a lone activity far
 * from the others stays visible when the map is zoomed out.
 *
 * The pure {@link idsNear} and {@link clusterPoints} helpers are exported so hit-testing and grouping can be
 * unit-tested without a real map.
 */
import {
  canvas,
  circleMarker,
  divIcon,
  latLngBounds,
  layerGroup,
  LineUtil,
  map as createMap,
  marker,
  point,
  polyline,
  type CircleMarker,
  type LatLng,
  type LatLngBounds,
  type Map as LeafletMap,
  type Point,
  type Polyline,
} from 'leaflet'

import type {
  MapOverviewInstance,
  MapOverviewOptions,
  MapOverviewTrack,
} from '@/composables/useMapProvider'

import { formatNumber } from '@/utils/formatNumber'

/** How close to a track, in screen pixels, a click selects it. */
const SELECT_TOLERANCE_PX = 8
/** The on-screen extent, in pixels, from which a track is drawn as a line rather than a dot. */
const READABLE_TRACK_PX = 24
/** How close together, in pixels, dots are merged into one bubble. */
const CLUSTER_RADIUS_PX = 40
/** The deepest zoom a fit to tracks goes to, so a short track is not shown at street level. */
const FIT_MAX_ZOOM = 15
/** The margin kept around fitted tracks, in pixels. */
const FIT_PADDING = point(32, 32)
/** Line weight of an overview track. */
const OVERVIEW_WEIGHT = 3
/** Line weight of a highlighted or hovered overview track. */
const HIGHLIGHT_WEIGHT = 5
/** Opacity of an overview track while no track is highlighted. */
const OVERVIEW_OPACITY = 0.8
/** Opacity of the tracks and dots left out of the highlight. */
const DIMMED_OPACITY = 0.25
/** Radius of a dot, and of a highlighted one, in pixels. */
const DOT_RADIUS = 5
const HIGHLIGHT_DOT_RADIUS = 7
/** Outline of a dot, so it stands out on any tile. */
const DOT_OUTLINE = '#ffffff'
/** Bubble diameters, in pixels, for fewer than 10, fewer than 100, and more tracks. */
const BUBBLE_SIZES = [28, 34, 40] as const
/** The bubble's look; `display` is left to Leaflet's marker styles, so the label centres itself. */
const BUBBLE_CLASS =
  'rounded-full border-2 border-white bg-primary font-sans text-meta font-medium text-primary-foreground tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * Finds the lines that pass within a distance of a point, all of them rather than the topmost only, so a click
 * where tracks overlap can offer every one.
 *
 * @param at - The clicked point, in pixels.
 * @param lines - Each line's id and its points, in the same pixels.
 * @param tolerance - The largest distance that counts as a hit, in pixels.
 * @returns The ids of the lines within `tolerance`, in input order.
 */
export function idsNear(
  at: Point,
  lines: ReadonlyArray<{ id: string; points: readonly Point[] }>,
  tolerance: number,
): string[] {
  return lines
    .filter(({ points }) =>
      points.some((current, index) => {
        const previous = points[index - 1]
        return previous
          ? LineUtil.pointToSegmentDistance(at, previous, current) <= tolerance
          : points.length === 1 && at.distanceTo(current) <= tolerance
      }),
    )
    .map(({ id }) => id)
}

/**
 * Gathers points into groups, greedily: each point not yet in a group starts one and takes every other ungrouped
 * point within `radius` of it. A grid of cells `radius` wide keeps each lookup to the cells around the point.
 *
 * @param points - The points, in pixels.
 * @param radius - The largest distance from a group's first point to any other of its points, in pixels.
 * @returns The groups as indices into `points`, each point in exactly one group.
 */
export function clusterPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number,
): number[][] {
  const cellOf = (value: number): number => Math.floor(value / radius)
  const cells = new Map<string, number[]>()
  points.forEach((at, index) => {
    const key = `${cellOf(at.x)}:${cellOf(at.y)}`
    const cell = cells.get(key)
    if (cell) {
      cell.push(index)
    } else {
      cells.set(key, [index])
    }
  })

  const grouped = new Uint8Array(points.length)
  const groups: number[][] = []
  points.forEach((seed, index) => {
    if (grouped[index]) {
      return
    }
    grouped[index] = 1
    const group = [index]
    const column = cellOf(seed.x)
    const row = cellOf(seed.y)
    for (let x = column - 1; x <= column + 1; x++) {
      for (let y = row - 1; y <= row + 1; y++) {
        for (const other of cells.get(`${x}:${y}`) ?? []) {
          const candidate = points[other]
          if (
            !grouped[other] &&
            candidate &&
            Math.hypot(candidate.x - seed.x, candidate.y - seed.y) <= radius
          ) {
            grouped[other] = 1
            group.push(other)
          }
        }
      }
    }
    groups.push(group)
  })
  return groups
}

/**
 * One track the map knows, with what is derived from it once.
 *
 * @property track - The track as last given.
 * @property bounds - Its bounding box.
 * @property line - Its polyline, built the first time it is drawn.
 */
interface Entry {
  track: MapOverviewTrack
  bounds: LatLngBounds
  line: Polyline | null
}

/**
 * Mounts an overview map of many tracks, fitted to them.
 *
 * @param target - The element to render into.
 * @param options - The tracks, the highlight and the callbacks.
 * @param addTiles - Adds the provider's tile layer to the map.
 * @returns The handle to update, recenter and destroy the map.
 */
export function mountLeafletOverview(
  target: HTMLElement,
  options: MapOverviewOptions,
  addTiles: (map: LeafletMap) => void,
): MapOverviewInstance {
  // Canvas draws thousands of polylines far faster than one SVG element each.
  const map = createMap(target, { attributionControl: true, preferCanvas: true })
  addTiles(map)
  // Leaflet's hover reach is half the line weight plus this tolerance, so hover and click agree.
  const renderer = canvas({ tolerance: SELECT_TOLERANCE_PX - OVERVIEW_WEIGHT / 2 })
  const markers = layerGroup().addTo(map)

  let current = options
  /** Every track seen so far, so a track that leaves the period and comes back keeps its polyline. */
  const entries = new Map<string, Entry>()
  /** The current tracks. */
  let shown: Entry[] = []
  /** The tracks drawn as lines at the current zoom. */
  let drawn = new Set<Entry>()
  /** The tracks drawn as dots at the current zoom. */
  let dots = new Map<Entry, CircleMarker>()

  const isHighlighted = (entry: Entry): boolean => current.highlighted.has(entry.track.id)
  const isDimmed = (entry: Entry): boolean => current.highlighted.size > 0 && !isHighlighted(entry)

  /** The resting style of a line, given the current highlight. */
  const lineStyleOf = (entry: Entry) => ({
    weight: isHighlighted(entry) ? HIGHLIGHT_WEIGHT : OVERVIEW_WEIGHT,
    opacity: isHighlighted(entry) ? 1 : isDimmed(entry) ? DIMMED_OPACITY : OVERVIEW_OPACITY,
  })

  /** The style of a dot, given the current highlight. */
  const dotStyleOf = (entry: Entry) => {
    const opacity = isDimmed(entry) ? DIMMED_OPACITY : 1
    return {
      radius: isHighlighted(entry) ? HIGHLIGHT_DOT_RADIUS : DOT_RADIUS,
      opacity,
      fillOpacity: opacity,
    }
  }

  /** The entry of a track, reused while its points and colour stay the same; `null` when it has no point. */
  const entryFor = (track: MapOverviewTrack): Entry | null => {
    const known = entries.get(track.id)
    if (known && known.track.points === track.points && known.track.color === track.color) {
      return known
    }
    if (known?.line && drawn.has(known)) {
      map.removeLayer(known.line)
      drawn.delete(known)
    }
    if (track.points.length === 0) {
      entries.delete(track.id)
      return null
    }
    const entry: Entry = { track, bounds: latLngBounds(track.points), line: null }
    entries.set(track.id, entry)
    return entry
  }

  /** The polyline of a track, built on first use. */
  const lineOf = (entry: Entry): Polyline => {
    if (!entry.line) {
      const line = polyline(entry.track.points, {
        renderer,
        color: entry.track.color,
        ...lineStyleOf(entry),
      })
      line.on('mouseover', () => line.setStyle({ weight: HIGHLIGHT_WEIGHT, opacity: 1 }))
      line.on('mouseout', () => line.setStyle(lineStyleOf(entry)))
      entry.line = line
    }
    return entry.line
  }

  /** Fits the viewport to the current tracks, or shows the world when there are none. */
  const fit = (): void => {
    const bounds = latLngBounds([])
    for (const entry of shown) {
      bounds.extend(entry.bounds)
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM })
    } else {
      map.setView([0, 0], 2)
    }
  }

  /** Zooms in on a group of tracks, or selects them when the map cannot zoom in any further. */
  const zoomTo = (members: readonly Entry[]): void => {
    const bounds = latLngBounds([])
    for (const member of members) {
      bounds.extend(member.bounds)
    }
    if (map.getBoundsZoom(bounds, false, FIT_PADDING) > map.getZoom()) {
      map.fitBounds(bounds, { padding: FIT_PADDING })
    } else {
      current.onSelect(members.map((member) => member.track.id))
    }
  }

  /** Applies the current highlight to the lines and dots whose style it changes. */
  const restyle = (): void => {
    for (const entry of drawn) {
      const line = lineOf(entry)
      const style = lineStyleOf(entry)
      if (line.options.weight !== style.weight || line.options.opacity !== style.opacity) {
        line.setStyle(style)
      }
    }
    for (const [entry, dot] of dots) {
      dot.setStyle(dotStyleOf(entry))
    }
    for (const id of current.highlighted) {
      const entry = entries.get(id)
      if (entry && drawn.has(entry)) {
        lineOf(entry).bringToFront()
      }
    }
  }

  /** Splits the current tracks into lines and dots for the current zoom, and merges nearby dots into bubbles. */
  const layout = (): void => {
    const zoom = map.getZoom()
    const lines = new Set<Entry>()
    const small: Entry[] = []
    for (const entry of shown) {
      const southWest = map.project(entry.bounds.getSouthWest(), zoom)
      const northEast = map.project(entry.bounds.getNorthEast(), zoom)
      const extent = Math.max(northEast.x - southWest.x, southWest.y - northEast.y)
      if (extent >= READABLE_TRACK_PX) {
        lines.add(entry)
      } else {
        small.push(entry)
      }
    }
    for (const entry of drawn) {
      if (!lines.has(entry)) {
        map.removeLayer(lineOf(entry))
      }
    }
    for (const entry of lines) {
      if (!drawn.has(entry)) {
        lineOf(entry).addTo(map)
      }
    }
    drawn = lines

    markers.clearLayers()
    dots = new Map()
    const centres = small.map((entry) => map.project(entry.bounds.getCenter(), zoom))
    for (const group of clusterPoints(centres, CLUSTER_RADIUS_PX)) {
      const members = group.flatMap((index) => small[index] ?? [])
      const [first] = members
      if (!first) {
        continue
      }
      if (members.length === 1) {
        const dot = circleMarker(first.bounds.getCenter(), {
          renderer,
          color: DOT_OUTLINE,
          weight: 2,
          fillColor: first.track.color,
          bubblingMouseEvents: false,
          ...dotStyleOf(first),
        })
        dot.on('click', () => {
          current.onSelect([first.track.id])
          map.fitBounds(first.bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM })
        })
        dots.set(first, dot)
        markers.addLayer(dot)
        continue
      }
      let x = 0
      let y = 0
      for (const index of group) {
        x += centres[index]?.x ?? 0
        y += centres[index]?.y ?? 0
      }
      const count = members.length
      const size = BUBBLE_SIZES[count < 10 ? 0 : count < 100 ? 1 : 2]
      const label = document.createElement('span')
      label.className = 'flex size-full items-center justify-center'
      label.textContent = formatNumber(count)
      const bubble = marker(map.unproject(point(x / count, y / count), zoom), {
        icon: divIcon({ html: label, className: BUBBLE_CLASS, iconSize: [size, size] }),
        keyboard: true,
        riseOnHover: true,
        title: current.clusterLabel(count),
      })
      bubble.on('click', () => zoomTo(members))
      markers.addLayer(bubble)
    }
    restyle()
  }

  /** Takes a new list of tracks, reusing the entries of the tracks already known. */
  const setTracks = (tracks: readonly MapOverviewTrack[]): void => {
    shown = tracks.flatMap((track) => entryFor(track) ?? [])
  }

  /** The ids of the tracks within reach of a point: the lines drawn through it and the dots drawn on it. */
  const idsAt = (latlng: LatLng): string[] => {
    const zoom = map.getZoom()
    const at = map.project(latlng, zoom)
    const reach = latLngBounds(
      map.unproject(at.subtract([SELECT_TOLERANCE_PX, SELECT_TOLERANCE_PX]), zoom),
      map.unproject(at.add([SELECT_TOLERANCE_PX, SELECT_TOLERANCE_PX]), zoom),
    )
    // Only the tracks whose box the point reaches are measured, so a pick costs the points of the nearby tracks.
    const near = [...drawn, ...dots.keys()]
      .filter((entry) => entry.bounds.intersects(reach))
      .map((entry) => ({
        id: entry.track.id,
        points: drawn.has(entry)
          ? entry.track.points.map((position) => map.project(position, zoom))
          : [map.project(entry.bounds.getCenter(), zoom)],
      }))
    return idsNear(at, near, SELECT_TOLERANCE_PX)
  }

  map.on('click', (event) => current.onSelect(idsAt(event.latlng)))
  // From the keyboard, Leaflet moves the map with the arrow keys and zooms it with + and -, and Enter on the map lists
  // the tracks at its centre. Enter on a bubble is the bubble's own.
  map.on('keydown', ({ originalEvent }) => {
    if (originalEvent.key === 'Enter' && originalEvent.target === map.getContainer()) {
      originalEvent.preventDefault()
      current.onSelect(idsAt(map.getCenter()))
    }
  })

  setTracks(options.tracks)
  fit()
  layout()
  map.on('zoomend', layout)

  // Leaflet measures its container once; a layout change around the map would otherwise crop or offset it.
  const resizeObserver = new ResizeObserver(() => map.invalidateSize())
  resizeObserver.observe(target)

  return {
    update(next: MapOverviewOptions): void {
      const tracksChanged = next.tracks !== current.tracks
      current = next
      if (!tracksChanged) {
        restyle()
        return
      }
      setTracks(next.tracks)
      const view = map.getBounds()
      if (shown.length > 0 && !shown.some((entry) => view.intersects(entry.bounds))) {
        fit()
      }
      layout()
    },
    recenter: fit,
    destroy(): void {
      resizeObserver.disconnect()
      map.remove()
    },
  }
}

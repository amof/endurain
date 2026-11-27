<script setup lang="ts">
import { ref, watch } from 'vue'

import type { GeoPoint } from '@/composables/useMapProvider'

import MapRecenterButton from '@/features/activities/components/MapRecenterButton.vue'
import { useMountedMap } from '@/features/activities/composables/useMountedMap'

const props = withDefaults(
  defineProps<{
    /** Ordered GPS coordinates forming the route polyline. */
    points: GeoPoint[]
    /** Whether the map responds to pan/zoom. */
    interactive?: boolean
  }>(),
  { interactive: true },
)

const container = ref<HTMLElement | null>(null)

/** Resolves the start/finish emphasis points from the track ends. */
function endpoints(points: GeoPoint[]): { start?: GeoPoint; finish?: GeoPoint } {
  const first = points[0]
  const last = points[points.length - 1]
  return first && last ? { start: first, finish: last } : {}
}

const { instance, mountMap } = useMountedMap(container, (target, provider) =>
  props.points.length === 0
    ? null
    : provider.mount(target, {
        track: { points: props.points, ...endpoints(props.points) },
        interactive: props.interactive,
      }),
)

/** Re-fits the map to the whole track after the user has panned or zoomed. */
function recenter(): void {
  instance()?.recenter()
}

watch(
  () => props.points,
  (points) => {
    const map = instance()
    if (!map) {
      mountMap()
      return
    }
    map.update({
      track: { points, ...endpoints(points) },
      interactive: props.interactive,
    })
  },
)
</script>

<template>
  <!-- Fills its parent, which controls the height (e.g. a gallery slide).
       `isolate` creates stacking contexts so Leaflet's internal panes and
       controls (z-index up to 1000) stay contained and never paint over the
       sticky navbar (z-40), the bottom nav or the recenter control. -->
  <div class="relative isolate size-full overflow-hidden bg-muted">
    <div
      ref="container"
      class="isolate size-full"
      role="img"
      :aria-label="$t('activities.map.label')"
    />
    <MapRecenterButton
      v-if="interactive && points.length > 0"
      :label="$t('activities.map.recenter')"
      @click="recenter"
    />
  </div>
</template>

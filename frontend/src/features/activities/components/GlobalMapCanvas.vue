<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crosshair } from '@lucide/vue'

import type { MapOverviewOptions, MapOverviewTrack } from '@/composables/useMapProvider'

import MapRecenterButton from '@/features/activities/components/MapRecenterButton.vue'
import { useMountedMap } from '@/features/activities/composables/useMountedMap'

const props = defineProps<{
  /** The tracks to draw. */
  tracks: MapOverviewTrack[]
  /** The ids of the selected tracks, drawn emphasised. */
  highlighted: ReadonlySet<string>
  /** Whether a track too small to read at the current zoom becomes a dot, merged with nearby ones into a bubble. */
  dots: boolean
}>()

const emit = defineEmits<{
  /** The ids of every track under a click, or at the centre on Enter; empty when there is none. */
  select: [ids: string[]]
}>()

const { t } = useI18n()
const hintId = useId()
const container = ref<HTMLElement | null>(null)

/** The render options for the current props. */
function options(): MapOverviewOptions {
  return {
    tracks: props.tracks,
    highlighted: props.highlighted,
    dots: props.dots,
    onSelect: (ids) => emit('select', ids),
    clusterLabel: (count) => t('activities.globalMap.cluster', { count }),
  }
}

const { instance } = useMountedMap(container, (target, provider) =>
  provider.mountOverview(target, options()),
)
watch(
  () => [props.tracks, props.highlighted, props.dots],
  () => instance()?.update(options()),
)

/** Fits the map to the current tracks. */
function recenter(): void {
  instance()?.recenter()
}

defineExpose({ recenter })
</script>

<template>
  <!-- `isolate` keeps Leaflet's panes and controls (z-index up to 1000) under the sticky navbar and the controls
       drawn over the map. -->
  <div class="relative isolate size-full overflow-hidden bg-muted">
    <div
      ref="container"
      class="peer isolate size-full outline-none"
      role="application"
      :aria-label="t('activities.globalMap.label')"
      :aria-describedby="hintId"
    />
    <p :id="hintId" class="sr-only">{{ t('activities.globalMap.keyboardHint') }}</p>
    <!-- While the map has keyboard focus: a ring drawn over its tiles, and a mark at its centre, where Enter picks the
         tracks. -->
    <span
      class="pointer-events-none absolute inset-0 z-10 hidden ring-3 ring-ring/50 ring-inset peer-focus-visible:block"
      aria-hidden="true"
    />
    <Crosshair
      class="pointer-events-none absolute top-1/2 left-1/2 z-10 hidden size-6 -translate-x-1/2 -translate-y-1/2 text-foreground peer-focus-visible:block"
      aria-hidden="true"
    />
    <MapRecenterButton :label="t('activities.globalMap.recenter')" @click="recenter" />
  </div>
</template>

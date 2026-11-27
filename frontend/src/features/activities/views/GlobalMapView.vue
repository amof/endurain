<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { MapOverviewTrack } from '@/composables/useMapProvider'

import GlobalMapCanvas from '@/features/activities/components/GlobalMapCanvas.vue'
import GlobalMapPanel from '@/features/activities/components/GlobalMapPanel.vue'
import GlobalMapTimeline from '@/features/activities/components/GlobalMapTimeline.vue'
import { activityTrackColors } from '@/components/ui/activity-type-badge'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentUser } from '@/features/auth/composables/useCurrentUser'
import { useActivityTracksQuery } from '@/features/activities/composables/useActivities'
import { useGlobalMap } from '@/features/activities/composables/useGlobalMap'
import { activityBadgeCategory } from '@/features/activities/utils/activityType'
import { formatMediumDate, monthLabel, yearLabel } from '@/utils/datetime'

const { t, locale } = useI18n()
const { data: currentUser } = useCurrentUser()
const units = computed(() => currentUser.value?.units ?? 'metric')
const firstDayOfWeek = computed(() => currentUser.value?.firstDayOfWeek ?? 'monday')

const { data, isPending, isError, refetch } = useActivityTracksQuery()
const tracks = computed(() => data.value ?? [])

const {
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
} = useGlobalMap(tracks, firstDayOfWeek)

/** The track colour of each activity category, from the same tokens as the activity badges. */
const trackColors = activityTrackColors()

const canvas = useTemplateRef<InstanceType<typeof GlobalMapCanvas>>('canvas')
// Picking another period size fits the map to the period it lands on; moving through time then keeps the viewport.
watch(size, () => canvas.value?.recenter(), { flush: 'post' })

const mapTracks = computed<MapOverviewTrack[]>(() =>
  visibleTracks.value.map((track) => ({
    id: track.activityId,
    points: track.points,
    color: trackColors[activityBadgeCategory(track.activityType)],
  })),
)

const periodLabel = computed(() => {
  const current = period.value
  if (!current) {
    return t('activities.globalMap.allTime')
  }
  if (size.value === 'year') {
    return yearLabel(current.start, locale.value)
  }
  if (size.value === 'month') {
    return monthLabel(current.start, locale.value)
  }
  return t('activities.globalMap.weekRange', {
    start: formatMediumDate(current.start, locale.value),
    end: formatMediumDate(current.end, locale.value),
  })
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-page-title">{{ t('activities.globalMap.title') }}</h1>

    <Skeleton v-if="isPending" class="h-112 w-full rounded-card lg:h-160" aria-busy="true" />
    <ErrorState
      v-else-if="isError && !data"
      :title="t('activities.globalMap.error')"
      @retry="refetch()"
    >
      <template #action="{ retry }">
        <Button variant="outline" size="sm" @click="retry">{{ t('app.error.retry') }}</Button>
      </template>
    </ErrorState>
    <template v-else>
      <!-- A failed refresh keeps the tracks read before on screen. -->
      <Alert
        v-if="isError"
        kind="warning"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <span>{{ t('activities.globalMap.refreshError') }}</span>
        <Button variant="outline" size="sm" @click="refetch()">{{ t('app.error.retry') }}</Button>
      </Alert>
      <EmptyState
        v-if="tracks.length === 0"
        :title="t('activities.globalMap.empty.title')"
        :description="t('activities.globalMap.empty.description')"
      />
      <div v-else class="flex flex-col gap-4 lg:flex-row">
        <section
          class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-card"
        >
          <div class="h-112 lg:h-144">
            <GlobalMapCanvas
              ref="canvas"
              :tracks="mapTracks"
              :highlighted="highlighted"
              @select="selectedIds = $event"
            />
          </div>
          <GlobalMapTimeline
            v-model:size="size"
            v-model:index="index"
            :periods="periods"
            :counts="counts"
            :label="periodLabel"
            :previous="previousIndex"
            :next="nextIndex"
          />
        </section>
        <!-- On large screens the panel takes the map's height and scrolls inside it. -->
        <div class="relative lg:w-96 lg:shrink-0">
          <GlobalMapPanel
            class="lg:absolute lg:inset-0"
            :label="periodLabel"
            :activity-count="activityCount"
            :journey-count="journeyCount"
            :category-counts="categoryCounts"
            :outings="outings"
            :units="units"
            @clear="selectedIds = []"
          />
        </div>
      </div>
    </template>
  </div>
</template>

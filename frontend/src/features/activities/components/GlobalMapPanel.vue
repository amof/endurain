<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MousePointerClick } from '@lucide/vue'

import type { ActivityBadgeType } from '@/components/ui/activity-type-badge'
import type { Outing } from '@/features/activities/types'
import type { Units } from '@/features/activities/utils/format'

import GlobalMapSelection from '@/features/activities/components/GlobalMapSelection.vue'
import { activitySwatchClasses } from '@/components/ui/activity-type-badge'
import { formatNumber } from '@/utils/formatNumber'

/**
 * The global map's side panel: what the period shown holds (activities, journeys, activities per sport, which also
 * explains the track colours), then the outings under the last click, or a hint on how to pick some.
 */
const props = defineProps<{
  /** The label of the period shown. */
  label: string
  /** The number of activities in the period. */
  activityCount: number
  /** The number of journeys with an activity in the period. */
  journeyCount: number
  /** The number of activities in the period, per sport category. */
  categoryCounts: Record<ActivityBadgeType, number>
  /** The outings under the last click, in the order to list them. */
  outings: Outing[]
  /** The viewer's unit system. */
  units: Units
}>()

const emit = defineEmits<{
  /** The viewer cleared the selection. */
  clear: []
}>()

const { t } = useI18n()

/** The categories of the legend; sports tied on count keep this order. */
const CATEGORIES: readonly ActivityBadgeType[] = [
  'running',
  'cycling',
  'swimming',
  'hiking',
  'other',
]

/**
 * The sports with an activity in the period, most activities first, each with its bar's length relative to the
 * busiest sport. A colour no track is drawn in needs no key.
 */
const legend = computed(() => {
  const present = CATEGORIES.flatMap((category) => {
    const count = props.categoryCounts[category]
    return count > 0 ? [{ category, swatch: activitySwatchClasses[category], count }] : []
  })
  const most = Math.max(1, ...present.map((entry) => entry.count))
  return present
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({ ...entry, length: `${(entry.count / most) * 100}%` }))
})
</script>

<template>
  <aside
    class="flex flex-col overflow-hidden rounded-card border border-border bg-card"
    :aria-label="t('activities.globalMap.panel.label')"
  >
    <section class="flex flex-col gap-4 border-b border-border p-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-section-heading">{{ label }}</h2>
        <p class="flex flex-wrap items-baseline gap-x-2 text-body">
          <i18n-t keypath="activities.globalMap.activityCount" :plural="activityCount" tag="span">
            <template #count>
              <span class="text-metric font-medium text-foreground tabular-nums">
                {{ formatNumber(activityCount) }}
              </span>
            </template>
          </i18n-t>
          <template v-if="journeyCount > 0">
            <span aria-hidden="true">·</span>
            <i18n-t keypath="activities.globalMap.journeyCount" :plural="journeyCount" tag="span">
              <template #count>
                <span class="text-metric font-medium text-foreground tabular-nums">
                  {{ formatNumber(journeyCount) }}
                </span>
              </template>
            </i18n-t>
          </template>
        </p>
      </div>
      <ul
        v-if="legend.length > 0"
        class="grid grid-cols-[minmax(0,auto)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-2"
        :aria-label="t('activities.globalMap.legend.label')"
      >
        <li
          v-for="entry in legend"
          :key="entry.category"
          class="col-span-3 grid grid-cols-subgrid items-center"
        >
          <span class="truncate text-body">
            {{ t(`activities.globalMap.legend.${entry.category}`) }}
          </span>
          <span class="flex h-2" aria-hidden="true">
            <span
              :class="['min-w-1 rounded-badge', entry.swatch]"
              :style="{ width: entry.length }"
            />
          </span>
          <span class="text-right font-medium text-foreground tabular-nums">
            {{ formatNumber(entry.count) }}
          </span>
        </li>
      </ul>
    </section>
    <GlobalMapSelection
      v-if="outings.length > 0"
      class="min-h-0 flex-1"
      :outings="outings"
      :units="units"
      @clear="emit('clear')"
    />
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <MousePointerClick class="size-6 text-muted-foreground" aria-hidden="true" />
      <p class="max-w-64 text-hint">{{ t('activities.globalMap.hint') }}</p>
    </div>
  </aside>
</template>

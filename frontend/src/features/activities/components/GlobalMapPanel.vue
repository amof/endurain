<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MousePointerClick, Route } from '@lucide/vue'

import type { ActivityBadgeType } from '@/components/ui/activity-type-badge'
import type { Outing } from '@/features/activities/types'
import type { Units } from '@/features/activities/utils/format'

import GlobalMapSelection from '@/features/activities/components/GlobalMapSelection.vue'
import { activitySwatchClasses } from '@/components/ui/activity-type-badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatNumber } from '@/utils/formatNumber'

/**
 * The global map's side panel. Its tabs show every activity or only journeys. Under them, what the period shown holds:
 * activities, journeys, and activities per sport, whose dots are the key to the track colours. Then the outings under
 * the last click, or on the journeys tab every journey of the period until some are clicked.
 */
const props = defineProps<{
  /** The label of the period shown. */
  label: string
  /** The number of activities shown in the period. */
  activityCount: number
  /** The number of journeys with an activity in the period. */
  journeyCount: number
  /** The number of activities shown in the period, per sport category. */
  categoryCounts: Record<ActivityBadgeType, number>
  /** The selected outings, in the order to list them. */
  outings: Outing[]
  /** The journeys of the period, in the order to list them. */
  journeyOutings: Outing[]
  /** Whether the viewer has any journey; without one, the journeys tab is disabled. */
  hasJourneys: boolean
  /** The viewer's unit system. */
  units: Units
}>()

/** Whether the map shows only the activities of journeys. */
const journeysOnly = defineModel<boolean>('journeysOnly', { required: true })

const emit = defineEmits<{
  /** The viewer cleared the selection. */
  clear: []
}>()

const { t } = useI18n()

/** The categories of the key; sports tied on count keep this order. */
const CATEGORIES: readonly ActivityBadgeType[] = [
  'running',
  'cycling',
  'swimming',
  'hiking',
  'other',
]

/** The tab shown, as the value of the tabs. */
const tab = computed({
  get: () => (journeysOnly.value ? 'journeys' : 'activities'),
  set: (value: string) => {
    journeysOnly.value = value === 'journeys'
  },
})

/** The sports with an activity in the period, most activities first. A colour no track is drawn in needs no key. */
const legend = computed(() =>
  CATEGORIES.flatMap((category) => {
    const count = props.categoryCounts[category]
    return count > 0 ? [{ category, swatch: activitySwatchClasses[category], count }] : []
  }).sort((a, b) => b.count - a.count),
)

/** The outings to list, under their heading: the selection, else on the journeys tab every journey of the period. */
const list = computed(() => {
  if (props.outings.length > 0) {
    return {
      outings: props.outings,
      title: t('activities.globalMap.panel.selected', { count: props.outings.length }),
      clearable: true,
    }
  }
  if (journeysOnly.value && props.journeyOutings.length > 0) {
    return {
      outings: props.journeyOutings,
      title: t('activities.globalMap.journeyCount', props.journeyOutings.length),
      clearable: false,
    }
  }
  return null
})
</script>

<template>
  <aside
    class="flex flex-col overflow-hidden rounded-card border border-border bg-card"
    :aria-label="t('activities.globalMap.panel.label')"
  >
    <section class="flex flex-col gap-4 border-b border-border p-4">
      <Tabs v-model="tab">
        <TabsList
          class="grid w-full grid-cols-2"
          :aria-label="t('activities.globalMap.panel.show')"
        >
          <TabsTrigger value="activities">{{
            t('activities.globalMap.panel.activities')
          }}</TabsTrigger>
          <TabsTrigger value="journeys" :disabled="!hasJourneys">{{
            t('activities.globalMap.panel.journeys')
          }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="flex flex-col gap-3">
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
          class="flex flex-wrap gap-2"
          :aria-label="t('activities.globalMap.legend.label')"
        >
          <li
            v-for="entry in legend"
            :key="entry.category"
            class="inline-flex items-center gap-1.5 rounded-badge border border-border px-2 py-1 text-meta"
          >
            <span :class="['size-2 shrink-0 rounded-full', entry.swatch]" aria-hidden="true" />
            <span class="text-muted-foreground">
              {{ t(`activities.globalMap.legend.${entry.category}`) }}
            </span>
            <span class="font-medium text-foreground tabular-nums">
              {{ formatNumber(entry.count) }}
            </span>
          </li>
        </ul>
      </div>
    </section>
    <GlobalMapSelection
      v-if="list"
      class="min-h-0 flex-1"
      :outings="list.outings"
      :title="list.title"
      :clearable="list.clearable"
      :units="units"
      @clear="emit('clear')"
    />
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <template v-if="journeysOnly">
        <Route class="size-6 text-muted-foreground" aria-hidden="true" />
        <p class="max-w-64 text-hint">{{ t('activities.globalMap.panel.noJourneys') }}</p>
      </template>
      <template v-else>
        <MousePointerClick class="size-6 text-muted-foreground" aria-hidden="true" />
        <p class="max-w-64 text-hint">{{ t('activities.globalMap.hint') }}</p>
      </template>
    </div>
  </aside>
</template>

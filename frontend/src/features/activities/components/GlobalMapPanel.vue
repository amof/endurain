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
 * The global map's side panel. Its tabs, each with its number in the period shown (which the timeline names), show
 * every activity or only journeys. Under them, a chip per sport with its number of activities: its dot is the key to
 * the track colour, and pressing it turns the sport off or on again. Then the outings under the last click, or on the
 * journeys tab every journey of the period until some are clicked.
 */
const props = defineProps<{
  /** The number of activities in the period. */
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
/** The sports turned off; every one is on at first. */
const hiddenCategories = defineModel<ReadonlySet<ActivityBadgeType>>('hiddenCategories', {
  required: true,
})

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

/** The sports with an activity in the period, most activities first, each turned on or off. */
const legend = computed(() =>
  CATEGORIES.flatMap((category) => {
    const count = props.categoryCounts[category]
    return count > 0
      ? [
          {
            category,
            swatch: activitySwatchClasses[category],
            count,
            on: !hiddenCategories.value.has(category),
          },
        ]
      : []
  }).sort((a, b) => b.count - a.count),
)

/** The outings to list, under their heading: the selection, else on the journeys tab every journey of the period. */
const list = computed(() => {
  if (props.outings.length > 0) {
    return { outings: props.outings, selection: true }
  }
  if (journeysOnly.value && props.journeyOutings.length > 0) {
    return { outings: props.journeyOutings, selection: false }
  }
  return null
})

/** Turns a sport off, or on again. */
function toggle(category: ActivityBadgeType): void {
  const next = new Set(hiddenCategories.value)
  if (!next.delete(category)) {
    next.add(category)
  }
  hiddenCategories.value = next
}
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
          <TabsTrigger value="activities" class="gap-2">
            <span>{{ t('activities.globalMap.panel.activities') }}</span>
            <span class="font-normal text-muted-foreground tabular-nums">
              {{ formatNumber(activityCount) }}
            </span>
          </TabsTrigger>
          <TabsTrigger value="journeys" class="gap-2" :disabled="!hasJourneys">
            <span>{{ t('activities.globalMap.panel.journeys') }}</span>
            <span class="font-normal text-muted-foreground tabular-nums">
              {{ formatNumber(journeyCount) }}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <ul
        v-if="legend.length > 0"
        class="flex flex-wrap gap-2"
        :aria-label="t('activities.globalMap.legend.label')"
      >
        <li v-for="entry in legend" :key="entry.category">
          <button
            type="button"
            :aria-pressed="entry.on"
            :class="[
              'inline-flex cursor-pointer items-center gap-1.5 rounded-badge border px-2 py-1 text-meta transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30',
              entry.on
                ? 'border-border bg-card'
                : 'border-dashed border-border text-muted-foreground',
            ]"
            @click="toggle(entry.category)"
          >
            <span
              :class="['size-2 shrink-0 rounded-full', entry.on ? entry.swatch : 'bg-border']"
              aria-hidden="true"
            />
            <span :class="entry.on ? 'text-muted-foreground' : 'line-through'">
              {{ t(`activities.globalMap.legend.${entry.category}`) }}
            </span>
            <span :class="['font-medium tabular-nums', entry.on && 'text-foreground']">
              {{ formatNumber(entry.count) }}
            </span>
          </button>
        </li>
      </ul>
    </section>
    <GlobalMapSelection
      v-if="list"
      class="min-h-0 flex-1"
      :outings="list.outings"
      :selection="list.selection"
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

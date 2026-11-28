<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { X } from '@lucide/vue'

import type { Activity, Outing } from '@/features/activities/types'
import type { Units } from '@/features/activities/utils/format'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useUnitFormat } from '@/composables/useUnitFormat'
import { useFullActivitiesQuery } from '@/features/activities/composables/useActivityDetail'
import {
  activityTypeIsDistanceBased,
  presentActivityType,
} from '@/features/activities/utils/activityType'
import { formatDistance, formatHmsDuration } from '@/features/activities/utils/format'
import { formatMediumDate, formatZonedDateTime } from '@/utils/datetime'

/**
 * A list of outings on the global map, such as the ones under the last click. A busy spot can hold hundreds, so they
 * are listed a page at a time and only the listed activities are read.
 */
const props = defineProps<{
  /** The outings, in the order to list them. */
  outings: Outing[]
  /** The list's heading. */
  title: string
  /** Whether the list is a selection the viewer can clear. */
  clearable: boolean
  /** The viewer's unit system. */
  units: Units
}>()

const emit = defineEmits<{
  /** The viewer cleared the selection. */
  clear: []
}>()

const { t, locale } = useI18n()
const { formatMetric } = useUnitFormat()

/** The outings listed at first, and added by each "Show more". */
const PAGE_SIZE = 10

const listed = ref(PAGE_SIZE)
// A new click starts over at the first page.
watch(
  () => props.outings,
  () => {
    listed.value = PAGE_SIZE
  },
)
const shown = computed(() => props.outings.slice(0, listed.value))

const activityIds = computed(() => shown.value.flatMap((outing) => outing.activityIds))
const queries = useFullActivitiesQuery(activityIds)

/**
 * One listed activity and how far its read has got.
 *
 * @property id - The activity id.
 * @property activity - The activity, once loaded.
 * @property failed - Whether the read failed or the activity is gone.
 */
interface ActivityRow {
  id: string
  activity: Activity | undefined
  failed: boolean
}

/** The listed activities' rows, by id. */
const rows = computed(
  () =>
    new Map(
      activityIds.value.map((id, position): [string, ActivityRow] => {
        const query = queries.value[position]
        return [
          id,
          {
            id,
            activity: query?.data ?? undefined,
            failed: Boolean(query?.isError) || query?.data === null,
          },
        ]
      }),
    ),
)

/** An outing's rows, in order. */
function rowsOf(outing: Outing): ActivityRow[] {
  return outing.activityIds.flatMap((id) => rows.value.get(id) ?? [])
}

/** The loaded activities of an outing, or `null` while any is still loading or missing. */
function loadedActivities(outing: Outing): Activity[] | null {
  const loaded = rowsOf(outing).flatMap((row) => row.activity ?? [])
  return loaded.length === outing.activityIds.length ? loaded : null
}

/** The journey's headline: its number of activities, its dates and, once loaded, its distance. */
function journeySummary(outing: Outing): string {
  const journey = outing.journey
  if (!journey) {
    return ''
  }
  const parts = [
    t('activities.globalMap.panel.journeyActivities', { count: journey.activityIds.length }),
    t('activities.globalMap.panel.journeyDates', {
      start: formatMediumDate(journey.startDate, locale.value),
      end: formatMediumDate(journey.endDate, locale.value),
    }),
  ]
  const activities = loadedActivities(outing)
  const first = activities?.[0]
  if (activities && first) {
    const total = activities.reduce((sum, activity) => sum + activity.distance, 0)
    parts.push(formatMetric(formatDistance(total, first.activityType, props.units)))
  }
  return parts.join(' · ')
}

/** An activity's date, distance (for a distance sport) and duration, on one line. */
function detailsOf(activity: Activity): string {
  const parts = [
    formatZonedDateTime(activity.startTime, activity.timezone, locale.value, {
      dateStyle: 'medium',
    }),
  ]
  if (activityTypeIsDistanceBased(activity.activityType)) {
    parts.push(formatMetric(formatDistance(activity.distance, activity.activityType, props.units)))
  }
  const duration = formatHmsDuration(activity.totalTimerTime)
  if (duration !== '--') {
    parts.push(duration)
  }
  return parts.filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="flex flex-col" :aria-label="title">
    <header
      class="flex min-h-11 items-center justify-between gap-2 border-b border-border py-1 pr-2 pl-4"
    >
      <h2 class="text-item-title tabular-nums">{{ title }}</h2>
      <Button
        v-if="clearable"
        variant="ghost"
        size="icon"
        :aria-label="t('activities.globalMap.panel.clear')"
        @click="emit('clear')"
      >
        <X class="size-4" />
      </Button>
    </header>
    <div class="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      <section v-for="outing in shown" :key="outing.id" class="py-1">
        <div v-if="outing.journey" class="px-4 pt-2 pb-1">
          <p class="text-item-title">{{ t('activities.globalMap.panel.journey') }}</p>
          <p class="text-hint tabular-nums">{{ journeySummary(outing) }}</p>
        </div>
        <template v-for="row in rowsOf(outing)" :key="row.id">
          <RouterLink
            v-if="row.activity"
            :to="{ name: 'activity', params: { id: row.id } }"
            class="flex items-center gap-3 px-4 py-2 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <component
                :is="presentActivityType(row.activity.activityType).icon"
                class="size-5"
                aria-hidden="true"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-foreground">{{
                row.activity.name
              }}</span>
              <span class="block truncate text-hint tabular-nums">{{
                detailsOf(row.activity)
              }}</span>
            </span>
          </RouterLink>
          <p v-else-if="row.failed" class="px-4 py-2 text-hint">
            {{ t('activities.globalMap.panel.loadFailed') }}
          </p>
          <div v-else class="flex items-center gap-3 px-4 py-2" aria-busy="true">
            <Skeleton class="size-9 rounded-full" />
            <div class="flex flex-1 flex-col gap-1.5">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-3 w-1/2" />
            </div>
          </div>
        </template>
      </section>
      <div v-if="outings.length > shown.length" class="p-3">
        <Button variant="outline" class="w-full" @click="listed += PAGE_SIZE">
          {{ t('activities.globalMap.panel.showMore') }}
        </Button>
      </div>
    </div>
  </section>
</template>

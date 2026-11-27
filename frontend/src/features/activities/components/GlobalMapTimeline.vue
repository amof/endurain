<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

import type { Period, PeriodSize } from '@/features/activities/utils/mapPeriods'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { yearLabel } from '@/utils/datetime'

/**
 * The global map's time controls: the period size, the periods before and after with activities, and a histogram of
 * the activities in each period that works as the slider (drag or click it, or use the arrow, Page and Home/End keys).
 */
const props = defineProps<{
  /** The periods of the slider, in order; empty while all time is shown. */
  periods: Period[]
  /** The number of activities in each period. */
  counts: number[]
  /** The label of the period shown. */
  label: string
  /** The nearest earlier period with activities, or `null` when there is none. */
  previous: number | null
  /** The nearest later period with activities, or `null` when there is none. */
  next: number | null
}>()

/** How much time one period covers. */
const size = defineModel<PeriodSize | 'all'>('size', { required: true })
/** The index of the period shown. */
const index = defineModel<number>('index', { required: true })

const { t, locale } = useI18n()

const SIZES: ReadonlyArray<PeriodSize | 'all'> = ['all', 'year', 'month', 'week']
/** The most year labels under the histogram, so they never crowd. */
const MAX_TICKS = 8
/** The position, in percent, past which a year label would overflow the end of the histogram. */
const LAST_TICK_POSITION = 94

/** The busiest period's count, which fills the histogram's height. */
const busiest = computed(() => Math.max(1, ...props.counts))
/** The space left on each side of a bar, in periods; none once bars are too thin to show it. */
const barGap = computed(() => (props.periods.length > 120 ? 0 : 0.12))
/** The centre of the shown period, in percent of the histogram's width. */
const position = computed(() => ((index.value + 0.5) / props.periods.length) * 100)

/**
 * The height of a bar, in percent of the histogram: a square-root scale keeps a period with one activity visible
 * next to a busy one, and an empty period keeps a thin baseline.
 */
function barHeight(count: number): number {
  return count === 0 ? 4 : 20 + 80 * Math.sqrt(count / busiest.value)
}

/** The class of a bar: the shown period, a period with activities, or an empty one. */
function barClass(periodIndex: number, count: number): string {
  if (periodIndex === index.value) {
    return 'fill-primary'
  }
  return count > 0 ? 'fill-muted-foreground/45' : 'fill-border'
}

/** The year labels: the first period of each year, thinned out to {@link MAX_TICKS}. */
const ticks = computed(() => {
  // A period's year is the year it ends in, so a week across New Year starts the new year.
  const starts = props.periods.flatMap((period, periodIndex) =>
    periodIndex === 0 || period.end.slice(0, 4) !== props.periods[periodIndex - 1]?.end.slice(0, 4)
      ? [{ periodIndex, end: period.end }]
      : [],
  )
  const stride = Math.ceil(starts.length / MAX_TICKS)
  return starts
    .filter((_, order) => order % stride === 0)
    .map(({ periodIndex, end }) => ({
      year: yearLabel(end, locale.value),
      left: (periodIndex / props.periods.length) * 100,
    }))
    .filter(({ left }) => left <= LAST_TICK_POSITION)
})

/** Shows a period, kept within the slider's range. */
function show(periodIndex: number): void {
  index.value = Math.min(Math.max(periodIndex, 0), props.periods.length - 1)
}

/** The period under the pointer. */
function periodAt(event: PointerEvent): number {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.floor(((event.clientX - box.left) / box.width) * props.periods.length)
}

/** Starts a drag: the histogram keeps the pointer until it is released. */
function onPointerDown(event: PointerEvent): void {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  show(periodAt(event))
}

/** Follows a drag. */
function onPointerMove(event: PointerEvent): void {
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    show(periodAt(event))
  }
}

/** Moves by one period, by a tenth of the range, or to either end, as a slider does. */
function onKeydown(event: KeyboardEvent): void {
  const page = Math.max(1, Math.round(props.periods.length / 10))
  const targets: Record<string, number> = {
    ArrowLeft: index.value - 1,
    ArrowDown: index.value - 1,
    ArrowRight: index.value + 1,
    ArrowUp: index.value + 1,
    PageDown: index.value - page,
    PageUp: index.value + page,
    Home: 0,
    End: props.periods.length - 1,
  }
  const target = targets[event.key]
  if (target !== undefined) {
    event.preventDefault()
    show(target)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-border px-3 py-3 sm:px-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Tabs v-model="size">
        <TabsList :aria-label="t('activities.globalMap.periodSize')">
          <TabsTrigger v-for="option in SIZES" :key="option" :value="option">
            {{ t(`activities.globalMap.periodSizes.${option}`) }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div v-if="periods.length > 0" class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('activities.globalMap.previous')"
          :disabled="previous === null"
          @click="previous !== null && show(previous)"
        >
          <ChevronLeft class="size-4" />
        </Button>
        <p class="min-w-40 text-center text-item-title tabular-nums" aria-live="polite">
          {{ label }}
        </p>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('activities.globalMap.next')"
          :disabled="next === null"
          @click="next !== null && show(next)"
        >
          <ChevronRight class="size-4" />
        </Button>
      </div>
    </div>

    <div v-if="periods.length > 0" class="flex flex-col gap-1">
      <div
        role="slider"
        tabindex="0"
        class="relative h-10 cursor-pointer touch-pan-y rounded-input outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        :aria-label="t('activities.globalMap.period')"
        :aria-valuemin="0"
        :aria-valuemax="periods.length - 1"
        :aria-valuenow="index"
        :aria-valuetext="label"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @keydown="onKeydown"
      >
        <span
          class="pointer-events-none absolute inset-y-0 min-w-1.5 -translate-x-1/2 rounded-sm bg-primary/15"
          :style="{ left: `${position}%`, width: `${100 / periods.length}%` }"
          aria-hidden="true"
        />
        <svg
          class="relative size-full"
          :viewBox="`0 0 ${periods.length} 100`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            v-for="(count, periodIndex) in counts"
            :key="periodIndex"
            :x="periodIndex + barGap"
            :y="100 - barHeight(count)"
            :width="1 - 2 * barGap"
            :height="barHeight(count)"
            :class="barClass(periodIndex, count)"
          />
        </svg>
        <span
          class="pointer-events-none absolute -bottom-1 size-2.5 -translate-x-1/2 rounded-full bg-primary ring-2 ring-card"
          :style="{ left: `${position}%` }"
          aria-hidden="true"
        />
      </div>
      <div class="relative h-4 overflow-hidden" aria-hidden="true">
        <span
          v-for="tick in ticks"
          :key="tick.year"
          class="absolute top-0 text-micro whitespace-nowrap text-muted-foreground tabular-nums"
          :style="{ left: `${tick.left}%` }"
        >
          {{ tick.year }}
        </span>
      </div>
    </div>
  </div>
</template>

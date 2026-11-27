import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import GlobalMapTimeline from '@/features/activities/components/GlobalMapTimeline.vue'
import { periodsBetween } from '@/features/activities/utils/mapPeriods'

const MONTHS = periodsBetween('2026-01-01', '2026-06-30', 'month', 'monday')

/** Mounts the timeline on April 2026 of six months, with activities in January, April and June. */
function mountTimeline(props: { previous?: number | null; next?: number | null } = {}) {
  return mount(GlobalMapTimeline, {
    props: {
      periods: MONTHS,
      counts: [1, 0, 0, 2, 0, 1],
      label: 'April 2026',
      previous: 0,
      next: 5,
      size: 'month',
      index: 3,
      ...props,
    },
    global: { plugins: [i18n] },
  })
}

/** The indices the timeline asked to show, in order. */
function shownPeriods(wrapper: ReturnType<typeof mountTimeline>): number[] {
  return (wrapper.emitted('update:index') ?? []).map(([period]) => period as number)
}

describe('GlobalMapTimeline', () => {
  it('exposes the histogram as a slider over the periods', () => {
    const slider = mountTimeline().get('[role="slider"]')

    expect(slider.attributes()).toMatchObject({
      'aria-valuemin': '0',
      'aria-valuemax': '5',
      'aria-valuenow': '3',
      'aria-valuetext': 'April 2026',
    })
  })

  it('moves by a period, a page or to either end from the keyboard, never past the range', async () => {
    const wrapper = mountTimeline()
    const slider = wrapper.get('[role="slider"]')

    // From April: March, April, January, June, (June: no period past the end), May, (Enter is not a slider key).
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']) {
      await slider.trigger('keydown', { key })
    }

    expect(shownPeriods(wrapper)).toEqual([2, 3, 0, 5, 4])
  })

  it('jumps to the nearest periods with activities, and disables a button with none', async () => {
    const wrapper = mountTimeline({ next: null })
    const previous = wrapper.get(`[aria-label="${i18n.global.t('activities.globalMap.previous')}"]`)
    const next = wrapper.get(`[aria-label="${i18n.global.t('activities.globalMap.next')}"]`)

    await previous.trigger('click')

    expect(shownPeriods(wrapper)).toEqual([0])
    expect(next.attributes('disabled')).toBeDefined()
  })

  it('shows no slider while all time is shown', () => {
    const wrapper = mount(GlobalMapTimeline, {
      props: {
        periods: [],
        counts: [],
        label: 'All time',
        previous: null,
        next: null,
        size: 'all',
        index: 0,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('[role="slider"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(4)
  })
})

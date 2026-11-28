import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ActivityBadgeType } from '@/components/ui/activity-type-badge'
import type { Outing } from '@/features/activities/types'

import i18n from '@/i18n'
import GlobalMapPanel from '@/features/activities/components/GlobalMapPanel.vue'
import GlobalMapSelection from '@/features/activities/components/GlobalMapSelection.vue'

const LEGEND_LABEL = i18n.global.t('activities.globalMap.legend.label')

/** Mounts the panel for a period holding the given activities per sport and journeys, with nothing selected. */
function mountPanel(
  categoryCounts: Partial<Record<ActivityBadgeType, number>>,
  journeyCount = 0,
  journeysOnly = false,
  journeyOutings: Outing[] = [],
  hasJourneys = true,
) {
  return mount(GlobalMapPanel, {
    props: {
      label: 'July 2026',
      journeysOnly,
      activityCount: Object.values(categoryCounts).reduce((sum, count) => sum + count, 0),
      journeyCount,
      categoryCounts: {
        running: 0,
        cycling: 0,
        swimming: 0,
        hiking: 0,
        other: 0,
        ...categoryCounts,
      },
      outings: [],
      journeyOutings,
      hasJourneys,
      units: 'metric',
    },
    global: { plugins: [i18n], stubs: { GlobalMapSelection: true } },
  })
}

/** The totals under the heading, as announced: the separator between them is hidden. */
function totalsOf(wrapper: ReturnType<typeof mountPanel>): string[] {
  return wrapper
    .get('h2 + p')
    .findAll(':scope > :not([aria-hidden])')
    .map((part) => part.text().replace(/\s+/g, ' '))
}

describe('GlobalMapPanel', () => {
  it('lists only the sports with an activity in the period, most activities first', () => {
    const wrapper = mountPanel({ cycling: 2, running: 12, hiking: 3 })

    // Each entry is the sport, its bar (no text) and its count.
    const entries = wrapper
      .get(`[aria-label="${LEGEND_LABEL}"]`)
      .findAll('li')
      .map((entry) =>
        entry
          .findAll('span')
          .map((part) => part.text())
          .filter(Boolean),
      )
    expect(entries).toEqual([
      [i18n.global.t('activities.globalMap.legend.running'), '12'],
      [i18n.global.t('activities.globalMap.legend.hiking'), '3'],
      [i18n.global.t('activities.globalMap.legend.cycling'), '2'],
    ])
  })

  it('shows no legend for a period without activities', () => {
    const wrapper = mountPanel({})

    expect(wrapper.find(`[aria-label="${LEGEND_LABEL}"]`).exists()).toBe(false)
  })

  it('sums up the period in one line, leaving out journeys when there are none', () => {
    expect(totalsOf(mountPanel({ running: 1 }))).toEqual(['1 activity'])
    expect(totalsOf(mountPanel({ running: 12, hiking: 3 }, 1))).toEqual([
      '15 activities',
      '1 journey',
    ])
  })

  it('switches between activities and journeys with its tabs', async () => {
    const wrapper = mountPanel({ hiking: 3 }, 1)
    const tabs = wrapper.findAll('[role="tab"]')

    expect(tabs.map((tab) => tab.text())).toEqual(['Activities', 'Journeys'])
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    await tabs[1]?.trigger('mousedown', { button: 0 })

    expect(wrapper.emitted('update:journeysOnly')).toEqual([[true]])
  })

  it('disables the journeys tab while the viewer has no journey', () => {
    const tabs = mountPanel({ running: 1 }, 0, false, [], false).findAll('[role="tab"]')

    expect(tabs[1]?.attributes('disabled')).toBeDefined()
  })

  it('lists every journey of the period on the journeys tab until some are selected', async () => {
    const journeys = [{ id: 'j', journey: null, activityIds: ['a', 'b'] }]
    const wrapper = mountPanel({ hiking: 2 }, 1, true, journeys)

    const list = wrapper.getComponent(GlobalMapSelection)
    expect(list.props()).toMatchObject({ outings: journeys, title: '1 journey', clearable: false })

    const picked = [{ id: 'k', journey: null, activityIds: ['c'] }]
    await wrapper.setProps({ outings: picked })
    expect(list.props()).toMatchObject({ outings: picked, title: '1 selected', clearable: true })
  })

  it('says when the period has no journey on the journeys tab', () => {
    const wrapper = mountPanel({}, 0, true)

    expect(wrapper.findComponent(GlobalMapSelection).exists()).toBe(false)
    expect(wrapper.text()).toContain(i18n.global.t('activities.globalMap.panel.noJourneys'))
  })
})

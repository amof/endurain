import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ActivityBadgeType } from '@/components/ui/activity-type-badge'

import i18n from '@/i18n'
import GlobalMapPanel from '@/features/activities/components/GlobalMapPanel.vue'

const LEGEND_LABEL = i18n.global.t('activities.globalMap.legend.label')

/** Mounts the panel for a period holding the given activities per sport, with nothing selected. */
function mountPanel(categoryCounts: Partial<Record<ActivityBadgeType, number>>, journeyCount = 0) {
  return mount(GlobalMapPanel, {
    props: {
      label: 'July 2026',
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
      units: 'metric',
    },
    global: { plugins: [i18n] },
  })
}

/** The totals under the heading, as announced: the separator between them is hidden. */
function totalsOf(wrapper: ReturnType<typeof mountPanel>): string[] {
  return wrapper
    .get('h2 + p')
    .findAll(':scope > span:not([aria-hidden])')
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
})

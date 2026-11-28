import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

import type { Outing } from '@/features/activities/types'

import i18n from '@/i18n'
import GlobalMapSelection from '@/features/activities/components/GlobalMapSelection.vue'
import { fetchActivity } from '@/features/activities/services/activities'
import { activityUuid, makeActivity } from './fixtures/activity'

vi.mock('@/features/activities/services/activities', () => ({
  fetchActivity: vi.fn<typeof fetchActivity>(),
}))

/** Single-activity outings, as a click on a busy street selects them. */
const OUTINGS: Outing[] = Array.from({ length: 25 }, (_, n) => ({
  id: activityUuid(n + 1),
  journey: null,
  activityIds: [activityUuid(n + 1)],
}))

/** Mounts a list of outings under a heading, with a clear button unless `clearable` is false. */
function mountSelection(outings: Outing[], clearable = true) {
  return mount(GlobalMapSelection, {
    props: { outings, title: `${outings.length} selected`, clearable, units: 'metric' },
    global: {
      plugins: [i18n, [VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs: { RouterLink: { template: '<a class="row"><slot /></a>' } },
    },
  })
}

describe('GlobalMapSelection', () => {
  beforeEach(() => {
    vi.mocked(fetchActivity).mockReset()
    vi.mocked(fetchActivity).mockImplementation(async (id) =>
      makeActivity({ id, name: `Run ${id.slice(-2)}` }),
    )
  })

  it('lists a busy selection a page at a time and reads only the listed activities', async () => {
    const wrapper = mountSelection(OUTINGS)
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('25 selected')
    expect(wrapper.findAll('a.row')).toHaveLength(10)
    expect(fetchActivity).toHaveBeenCalledTimes(10)

    const showMore = wrapper
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('activities.globalMap.panel.showMore'))
    await showMore?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('a.row')).toHaveLength(20)
    expect(fetchActivity).toHaveBeenCalledTimes(20)
  })

  it('starts over at the first page on a new selection', async () => {
    const wrapper = mountSelection(OUTINGS)
    await flushPromises()
    const showMore = wrapper
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('activities.globalMap.panel.showMore'))
    await showMore?.trigger('click')

    await wrapper.setProps({ outings: OUTINGS.slice(5) })
    await flushPromises()

    expect(wrapper.findAll('a.row')).toHaveLength(10)
  })

  it('says when an activity cannot be read, and clears on request', async () => {
    vi.mocked(fetchActivity).mockResolvedValue(null)
    const wrapper = mountSelection(OUTINGS.slice(0, 1))
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('activities.globalMap.panel.loadFailed'))

    await wrapper
      .get(`[aria-label="${i18n.global.t('activities.globalMap.panel.clear')}"]`)
      .trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('offers no clear button for a list that is not a selection', async () => {
    const wrapper = mountSelection(OUTINGS.slice(0, 1), false)
    await flushPromises()

    expect(
      wrapper.find(`[aria-label="${i18n.global.t('activities.globalMap.panel.clear')}"]`).exists(),
    ).toBe(false)
  })
})

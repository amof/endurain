import { beforeEach, describe, expect, it, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'

import type { ActivityTrack } from '@/features/activities/types'

import i18n from '@/i18n'
import GlobalMapPanel from '@/features/activities/components/GlobalMapPanel.vue'
import GlobalMapView from '@/features/activities/views/GlobalMapView.vue'
import { activityUuid } from './fixtures/activity'

const { tracksQuery } = vi.hoisted(() => ({
  tracksQuery: {
    data: undefined as unknown as import('vue').Ref<ActivityTrack[] | undefined>,
    isPending: undefined as unknown as import('vue').Ref<boolean>,
    isError: undefined as unknown as import('vue').Ref<boolean>,
    refetch: undefined as unknown as () => Promise<unknown>,
  },
}))

vi.mock('@/features/activities/composables/useActivities', () => ({
  useActivityTracksQuery: () => tracksQuery,
}))
vi.mock('@/features/auth/composables/useCurrentUser', () => ({
  useCurrentUser: () => ({ data: ref(null) }),
}))

const TRACK: ActivityTrack = {
  activityId: activityUuid(1),
  activityType: 'run',
  startTime: '2026-07-01T07:00:00Z',
  endTime: '2026-07-01T08:00:00Z',
  startDate: '2026-07-01',
  endDate: '2026-07-01',
  points: [
    { lat: 45, lng: 6 },
    { lat: 45.1, lng: 6.1 },
  ],
}

/** Mounts the view over the tracks query in the given state; the map itself is stubbed. */
function mountView(state: { data?: ActivityTrack[]; isPending?: boolean; isError?: boolean }) {
  tracksQuery.data = ref(state.data)
  tracksQuery.isPending = ref(state.isPending ?? false)
  tracksQuery.isError = ref(state.isError ?? false)
  return mount(GlobalMapView, {
    global: { plugins: [i18n], stubs: { GlobalMapCanvas: true } },
  })
}

/** The button that reads the tracks again. */
function retryButton(wrapper: ReturnType<typeof mountView>) {
  const button = wrapper
    .findAll('button')
    .find((candidate) => candidate.text() === i18n.global.t('app.error.retry'))
  if (!button) {
    throw new Error('no retry button')
  }
  return button
}

describe('GlobalMapView', () => {
  beforeEach(() => {
    tracksQuery.refetch = vi.fn<() => Promise<unknown>>()
  })

  it('shows a busy placeholder while the tracks load', () => {
    const wrapper = mountView({ isPending: true })

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'GlobalMapCanvas' }).exists()).toBe(false)
  })

  it('shows the error with a retry that reads the tracks again', async () => {
    const wrapper = mountView({ isError: true })

    expect(wrapper.get('[role="alert"]').text()).toContain(
      i18n.global.t('activities.globalMap.error'),
    )
    await retryButton(wrapper).trigger('click')
    expect(tracksQuery.refetch).toHaveBeenCalledOnce()
  })

  it('tells the viewer how tracks appear when there is none', () => {
    const wrapper = mountView({ data: [] })

    expect(wrapper.text()).toContain(i18n.global.t('activities.globalMap.empty.title'))
    expect(wrapper.findComponent({ name: 'GlobalMapCanvas' }).exists()).toBe(false)
  })

  it('keeps the map shown when reading the tracks again fails, and offers a retry', async () => {
    const wrapper = mountView({ data: [TRACK], isError: true })

    expect(wrapper.findComponent({ name: 'GlobalMapCanvas' }).exists()).toBe(true)
    expect(wrapper.text()).toContain(i18n.global.t('activities.globalMap.refreshError'))
    await retryButton(wrapper).trigger('click')
    expect(tracksQuery.refetch).toHaveBeenCalledOnce()
  })

  it('fits the map to what it shows when the panel switches between activities and journeys', async () => {
    const recenter = vi.fn<() => void>()
    tracksQuery.data = ref([TRACK])
    tracksQuery.isPending = ref(false)
    tracksQuery.isError = ref(false)
    const wrapper = mount(GlobalMapView, {
      global: {
        plugins: [i18n],
        stubs: {
          GlobalMapCanvas: defineComponent({
            setup: (_, { expose }) => expose({ recenter }),
            template: '<div />',
          }),
        },
      },
    })

    wrapper.getComponent(GlobalMapPanel).vm.$emit('update:journeysOnly', true)
    await flushPromises()

    expect(recenter).toHaveBeenCalledOnce()
  })
})

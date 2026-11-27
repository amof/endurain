import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import { resolveUserId } from '@/utils/userId'
import { storeToRefs } from 'pinia'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'

import { queryKeys } from '@/services/queryKeys'
import { useAuthStore } from '@/features/auth/stores/auth'
import {
  type ActivityListFilters,
  type ActivitySortBy,
  type ActivitySortOrder,
  fetchActivityTracks,
  fetchUserActivitiesPage,
  fetchUserActivityTypes,
} from '@/features/activities/services/activities'

/**
 * One filtered, sorted page of the authenticated user's own activities, backing
 * the activities list view. Keyed on the owner, page, size, every filter, and
 * the sort so each distinct query caches independently; uses `keepPreviousData`
 * so paging and filtering keep the current rows visible until the next page
 * resolves (no flash of empty state). Gated on a valid user id and auth.
 *
 * @param userId - Reactive id of the list owner (the authenticated viewer).
 * @param page - Reactive 1-based page number.
 * @param pageSize - Reactive records-per-page (from server settings).
 * @param filters - Reactive server-side filters (type, dates, name search).
 * @param sortBy - Reactive sort column.
 * @param sortOrder - Reactive sort direction.
 * @returns The TanStack query result for the current activities page.
 */
export function useUserActivitiesQuery(
  userId: MaybeRefOrGetter<string | null>,
  page: MaybeRefOrGetter<number>,
  pageSize: MaybeRefOrGetter<number>,
  filters: MaybeRefOrGetter<ActivityListFilters>,
  sortBy: MaybeRefOrGetter<ActivitySortBy>,
  sortOrder: MaybeRefOrGetter<ActivitySortOrder>,
) {
  const { isAuthenticated } = storeToRefs(useAuthStore())
  const id = computed(() => resolveUserId(userId))

  return useQuery({
    queryKey: computed(() =>
      queryKeys.activities.list({
        scope: 'user-list',
        userId: id.value,
        page: toValue(page),
        numRecords: toValue(pageSize),
        filters: toValue(filters),
        sortBy: toValue(sortBy),
        sortOrder: toValue(sortOrder),
      }),
    ),
    queryFn: ({ signal }) =>
      fetchUserActivitiesPage(
        {
          userId: id.value,
          page: toValue(page),
          numRecords: toValue(pageSize),
          filters: toValue(filters),
          sortBy: toValue(sortBy),
          sortOrder: toValue(sortOrder),
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled: computed(() => isAuthenticated.value && id.value !== ''),
  })
}

/**
 * The distinct activity types the authenticated user owns, powering the activity-type
 * filters so they only offer types the user has; gated on authentication.
 *
 * @returns The TanStack query result for the user's activity types.
 */
export function useUserActivityTypesQuery() {
  const { isAuthenticated } = storeToRefs(useAuthStore())

  return useQuery({
    queryKey: queryKeys.activities.types(),
    queryFn: ({ signal }) => fetchUserActivityTypes(signal),
    enabled: isAuthenticated,
  })
}

/** How long the tracks stay fresh: reading them is a walk over every slice, so a return to the map reuses them. */
const TRACKS_STALE_TIME_MS = 5 * 60_000

/**
 * Every simplified track of the authenticated user's own activities, backing the global map; gated on
 * authentication. A change to the user's activities marks them stale, and they are read again the next time the map
 * opens.
 *
 * @returns The TanStack query result for the tracks.
 */
export function useActivityTracksQuery() {
  const { isAuthenticated } = storeToRefs(useAuthStore())

  return useQuery({
    queryKey: queryKeys.activities.tracks(),
    queryFn: ({ signal }) => fetchActivityTracks(signal),
    enabled: isAuthenticated,
    staleTime: TRACKS_STALE_TIME_MS,
  })
}

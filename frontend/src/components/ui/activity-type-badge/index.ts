import { themeColor } from '@/lib/themeColor'

export { default as ActivityTypeBadge } from './ActivityTypeBadge.vue'

/** Activity categories that have a dedicated badge colour. */
export type ActivityBadgeType = 'running' | 'cycling' | 'swimming' | 'hiking' | 'other'

/**
 * Maps an activity category to its badge colour utilities. Full literal class
 * strings are required so Tailwind's scanner can see them (do not build these
 * names dynamically).
 */
export const activityBadgeClasses: Record<ActivityBadgeType, string> = {
  running: 'bg-activity-running-bg text-activity-running-text',
  cycling: 'bg-activity-cycling-bg text-activity-cycling-text',
  swimming: 'bg-activity-swimming-bg text-activity-swimming-text',
  hiking: 'bg-activity-hiking-bg text-activity-hiking-text',
  other: 'bg-activity-other-bg text-activity-other-text',
}

/**
 * Maps an activity category to the background utility of its track colour, the
 * badge's text colour, for a legend swatch. Full literal class strings, as for
 * {@link activityBadgeClasses}.
 */
export const activitySwatchClasses: Record<ActivityBadgeType, string> = {
  running: 'bg-activity-running-text',
  cycling: 'bg-activity-cycling-text',
  swimming: 'bg-activity-swimming-text',
  hiking: 'bg-activity-hiking-text',
  other: 'bg-activity-other-text',
}

/**
 * Resolves the colour each activity category's tracks are drawn in, the badge's
 * text colour, from the live theme, for a map canvas that cannot use utilities.
 *
 * @returns The track colour of each category.
 */
export function activityTrackColors(): Record<ActivityBadgeType, string> {
  return {
    running: themeColor('--color-activity-running-text'),
    cycling: themeColor('--color-activity-cycling-text'),
    swimming: themeColor('--color-activity-swimming-text'),
    hiking: themeColor('--color-activity-hiking-text'),
    other: themeColor('--color-activity-other-text'),
  }
}

import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

import { useMapProvider, type MapProvider } from '@/composables/useMapProvider'
import { useRenderProvidersReady } from '@/providers'

/**
 * Mounts a map into a container once the render providers are ready and the container exists, and destroys it with
 * the component.
 *
 * @param container - The element to render into.
 * @param mount - Mounts the map with the active provider, or returns `null` while there is nothing to draw.
 * @returns A getter of the mounted map (`null` until it is mounted), and `mountMap` to try again once there is something
 *   to draw.
 */
export function useMountedMap<T extends { destroy(): void }>(
  container: Readonly<Ref<HTMLElement | null>>,
  mount: (target: HTMLElement, provider: MapProvider) => T | null,
): { instance: () => T | null; mountMap: () => void } {
  const ready = useRenderProvidersReady()
  let instance: T | null = null

  /** Mounts the map, unless it is mounted already or there is nowhere to mount it yet. */
  function mountMap(): void {
    if (instance || !container.value || !ready.value) {
      return
    }
    instance = mount(container.value, useMapProvider().provider)
  }

  onMounted(mountMap)
  watch(ready, mountMap)
  onBeforeUnmount(() => {
    instance?.destroy()
    instance = null
  })

  return { instance: () => instance, mountMap }
}

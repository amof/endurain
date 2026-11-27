<script setup lang="ts">
import { LocateFixed } from '@lucide/vue'

import { Button } from '@/components/ui/button'

/** The control over a map's top-right corner that fits the map back to what it draws. */
defineProps<{
  /** The accessible name and tooltip of the control. */
  label: string
}>()
</script>

<template>
  <!-- The map's container isolates Leaflet's panes and controls, so any z-index keeps this above them. -->
  <Button
    variant="ghost"
    size="icon"
    class="absolute top-3 right-3 z-10 bg-card/80 text-foreground backdrop-blur hover:bg-card"
    :aria-label="label"
    :title="label"
  >
    <LocateFixed />
  </Button>
</template>

<script setup>
import ShutdownWorkspace from './ShutdownWorkspace.vue'

defineProps({
  runtimeMode: { type: String, default: 'browser' },
})

const emit = defineEmits(['notify'])
</script>

<template>
  <div class="workspace-grid power-page">
    <ShutdownWorkspace :runtime-mode="runtimeMode" @notify="(...args) => emit('notify', ...args)" />
  </div>
</template>

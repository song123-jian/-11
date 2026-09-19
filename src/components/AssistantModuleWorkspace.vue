<script setup>
import AssistantWorkspace from './AssistantWorkspace.vue'

defineProps({
  activeTab: { type: String, default: 'overview' },
  networkOnline: { type: Boolean, default: true },
})

const emit = defineEmits(['open-tool', 'notify', 'update:activeTab'])
</script>

<template>
  <div class="assistant-page">
    <AssistantWorkspace
      :active-tab="activeTab"
      :network-online="networkOnline"
      @update:active-tab="emit('update:activeTab', $event)"
      @open-tool="emit('open-tool', $event)"
      @notify="(...args) => emit('notify', ...args)"
    >
      <template #translation="slotProps">
        <slot name="translation" v-bind="slotProps" />
      </template>
      <template #ai>
        <slot name="ai" />
      </template>
    </AssistantWorkspace>
  </div>
</template>

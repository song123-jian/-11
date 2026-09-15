<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  label: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { default: null },
  status: { type: String, default: '' },
  statusClass: { type: String, default: '' },
  active: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
</script>

<template>
  <button
    v-bind="$attrs"
    class="tool-entry-card"
    :class="{ active }"
    type="button"
    :disabled="disabled"
  >
    <span class="tool-entry-icon">
      <component :is="icon" v-if="icon" :size="19" stroke-width="1.8" aria-hidden="true" />
    </span>
    <span class="tool-entry-copy">
      <strong>{{ label }}</strong>
      <small v-if="description">{{ description }}</small>
    </span>
    <span v-if="status" class="access-tag" :class="statusClass">{{ status }}</span>
  </button>
</template>

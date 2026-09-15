<script setup>
defineOptions({ inheritAttrs: true })
</script>

<template>
  <section class="content-card tool-card tool-workspace" v-bind="$attrs">
    <div class="tool-workspace-content">
      <slot />
    </div>
  </section>
</template>

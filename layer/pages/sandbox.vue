<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'

const iconsList = ref<string[]>([])

onMounted(() => {
  const comps = import.meta.glob('./../icons/**/*.vue')

  iconsList.value = Object.keys(comps).map((componentName) =>
    componentName.replace('../icons/', '').replace('.vue', '')
  )
})
</script>

<template>
  <article class="px-4 grid md:grid-cols-4 grid-cols-6 gap-4">
    <div
      class="flex flex-col justify-center items-center py-4"
      v-for="icon in iconsList"
      :key="icon"
    >
      <SharedIcon :name="icon" />
      <span>{{ icon }}</span>
    </div>
  </article>
</template>

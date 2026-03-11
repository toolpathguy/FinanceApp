<script setup lang="ts">
useHead({
  meta: [
    { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#1b1718' },
    { name: 'theme-color', media: '(prefers-color-scheme: light)', content: 'white' },
    { name: 'description', content: 'hledger Budget — personal finance tracking powered by hledger' },
  ],
  title: 'hledger Budget',
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

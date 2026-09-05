<script setup>
import { RouterView } from 'vue-router';
import AppShell from './AppShell.vue';
import AppErrorBoundary from './AppErrorBoundary.vue';
import ErrorPage from '../pages/ErrorPage.vue';
</script>

<template>
  <AppErrorBoundary>
    <template #error><ErrorPage /></template>
    <AppShell><RouterView /></AppShell>
  </AppErrorBoundary>
</template>

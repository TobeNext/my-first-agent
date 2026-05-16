<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <nav class="app-shell__nav">
        <RouterLink class="app-shell__nav-link" to="/">信息上传</RouterLink>
        <RouterLink class="app-shell__nav-link" to="/agent">面试页面</RouterLink>
      </nav>
    </header>

    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>
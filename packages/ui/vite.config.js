import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: { entry: 'src/index.js', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: ['vue', /^primevue\//u] },
  },
});

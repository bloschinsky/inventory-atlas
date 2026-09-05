import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['{apps,packages,scripts}/**/*.test.{js,ts}'],
    exclude: ['**/*.integration.test.{js,ts}', '**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});

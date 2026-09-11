import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/**/*.integration.test.{js,ts}'],
    environment: 'node',
    // Every suite creates and drops its own PostgreSQL schema on one shared server. Running the
    // files in parallel made them contend for connections and observe each other's teardown, so
    // integration files run one at a time.
    fileParallelism: false,
  },
});

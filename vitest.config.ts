import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Keep filesystem searches and fixed-budget scalability checks from
    // competing with other test workers on shared CI runners.
    fileParallelism: false,
  },
});

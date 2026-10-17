import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/integration/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000, fileParallelism: false },
});

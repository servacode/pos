import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // All test files share one test database
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // The upgrade test builds its own database from an older schema: vitest.upgrade.config.ts
    exclude: [...configDefaults.exclude, 'test/upgrade/**'],
  },
});

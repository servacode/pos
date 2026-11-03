import { defineConfig } from 'vitest/config';

/**
 * The upgrade test (task M0-4), apart from the rest: it drops and rebuilds its database at the
 * previous schema, so it needs a database of its own (serva_upgrade_test, scripts/db-bootstrap.sql)
 * and no global migration. Run with `pnpm --filter @serva/api test:upgrade`.
 */
export default defineConfig({
  test: {
    include: ['test/upgrade/**/*.test.ts'],
    globalSetup: ['./test/upgrade/global-setup.ts'],
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_UPGRADE_DATABASE_URL ??
        'postgres://serva_app:serva_app@localhost:5432/serva_upgrade_test',
      TEST_DATABASE_MIGRATION_URL:
        process.env.TEST_UPGRADE_DATABASE_MIGRATION_URL ??
        'postgres://serva_owner:serva_owner@localhost:5432/serva_upgrade_test',
    },
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});

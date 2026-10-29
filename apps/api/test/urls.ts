/** Test databases only: never point these at a development or production database. */
export const TEST_APP_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://serva_app:serva_app@localhost:5432/serva_test';
export const TEST_OWNER_URL =
  process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://serva_owner:serva_owner@localhost:5432/serva_test';

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": the database name must end with _test`);
  }
}

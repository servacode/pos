import { runMigrations } from '@serva/db';
import { assertTestDatabase, TEST_APP_URL, TEST_OWNER_URL } from './urls';

export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_APP_URL);
  assertTestDatabase(TEST_OWNER_URL);
  await runMigrations(TEST_OWNER_URL);
}

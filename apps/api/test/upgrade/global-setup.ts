import { assertTestDatabase, TEST_APP_URL, TEST_OWNER_URL } from '../urls';

/** No migration here: the test itself builds the database at the previous schema. */
export default function setup(): void {
  assertTestDatabase(TEST_APP_URL);
  assertTestDatabase(TEST_OWNER_URL);
}

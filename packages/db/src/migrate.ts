import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies pending migrations. Must run as the owner role (DATABASE_MIGRATION_URL). */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

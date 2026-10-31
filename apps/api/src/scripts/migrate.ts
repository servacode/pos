/**
 * Applies pending database migrations from the built API image (the local server's one-shot
 * `migrate` service), where the TypeScript sources and tsx are not shipped.
 * Runs as the owner role: DATABASE_MIGRATION_URL. MIGRATIONS_DIR points at the copied
 * packages/db/drizzle folder; without it, the folder next to @serva/db's source is used.
 */
import { migrationsFolder, runMigrations } from '@serva/db';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}
const folder = process.env.MIGRATIONS_DIR || migrationsFolder;
const applied = await runMigrations(url, { migrationsFolder: folder });
console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');

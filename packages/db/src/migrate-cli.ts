import { runMigrations } from './migrate';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}
const applied = await runMigrations(url);
console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');

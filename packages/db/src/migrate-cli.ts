import { runMigrations } from './migrate';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}
await runMigrations(url);
console.log('Migrations applied.');

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? 'postgres://serva_owner:serva_owner@localhost:5432/serva',
  },
});

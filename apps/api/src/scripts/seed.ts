/**
 * Seeds reference data that the platform admin will later edit from the admin panel:
 * the paid plans (no prices yet) and the first platform admin account.
 * Runs as the owner role: DATABASE_MIGRATION_URL.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, plans, platformUsers, type PlanLimits } from '@serva/db';
import { hashSecret } from '../auth/passwords';

const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}

const paidPlans: { code: string; name: string; sortOrder: number; limits: PlanLimits; features: string[] }[] =
  [
    {
      code: 'basic',
      name: 'الأساسية',
      sortOrder: 1,
      limits: { branches: 1, registers: 1, users: 3, products: 2000 },
      features: ['sales', 'inventory', 'customers', 'credit'],
    },
    {
      code: 'pro',
      name: 'الاحترافية',
      sortOrder: 2,
      limits: { branches: 3, registers: 5, users: 15, products: null },
      features: [
        'sales',
        'inventory',
        'customers',
        'credit',
        'purchases',
        'transfers',
        'promotions',
        'accounting_reports',
      ],
    },
    {
      code: 'enterprise',
      name: 'المؤسسات',
      sortOrder: 3,
      limits: { branches: null, registers: null, users: null, products: null },
      features: [
        'sales',
        'inventory',
        'customers',
        'credit',
        'purchases',
        'transfers',
        'promotions',
        'accounting_reports',
        'api',
      ],
    },
  ];

const { db, client } = createDb(url, { max: 1, timeouts: false, applicationName: 'serva-seed' });
try {
  for (const plan of paidPlans) {
    await db
      .insert(plans)
      .values({ ...plan, isFree: false, isDefault: false, trialDays: null, currency: 'USD' })
      .onConflictDoNothing({ target: plans.code });
  }
  console.log(`Plans ready (${paidPlans.length} paid + the free plan from migrations).`);

  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 10 characters');
    await db
      .insert(platformUsers)
      .values({
        fullName: 'مدير المنصة',
        email: email.toLowerCase(),
        passwordHash: await hashSecret(password),
        role: 'super_admin',
      })
      .onConflictDoNothing({ target: platformUsers.email });
    console.log(`Platform admin ready: ${email}`);
  } else {
    console.log('PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set; skipped platform admin.');
  }
} finally {
  await client.end();
}

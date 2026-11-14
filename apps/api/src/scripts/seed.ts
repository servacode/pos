/**
 * Seeds reference data that the platform admin will later edit from the admin panel:
 * the paid plans (no prices yet) and the first platform admin account.
 * Runs as the owner role: DATABASE_MIGRATION_URL.
 *
 * `--demo-catalog [--store=<6-digit store code>]` also adds about 40 products of a Raqqa
 * supermarket to a store (the only one on the server when no code is given); see
 * scripts/demo-catalog.ts. Running it again adds nothing twice.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb, plans, platformUsers, type PlanLimits } from '@serva/db';
import { hashSecret, verifySecret } from '../auth/passwords';
import { demoStore, seedDemoCatalog } from './demo-catalog';

const args = process.argv.slice(2);
const demoCatalog = args.includes('--demo-catalog');
const storeCode = args.find((a) => a.startsWith('--store='))?.slice('--store='.length);

const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}

const paidPlans: {
  code: string;
  name: string;
  sortOrder: number;
  /** Dollar cents (07 › الأسعار), editable in the platform panel */
  priceMonthlyMinor: number;
  priceYearlyMinor: number;
  limits: PlanLimits;
  features: string[];
}[] = [
  {
    code: 'basic',
    name: 'الأساسية',
    sortOrder: 1,
    priceMonthlyMinor: 1000,
    priceYearlyMinor: 10000,
    limits: { branches: 1, registers: 1, users: 3, products: 2000 },
    features: ['sales', 'inventory', 'customers', 'credit'],
  },
  {
    code: 'pro',
    name: 'الاحترافية',
    sortOrder: 2,
    priceMonthlyMinor: 2500,
    priceYearlyMinor: 25000,
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
    priceMonthlyMinor: 5000,
    priceYearlyMinor: 50000,
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
    // A plan seeded before prices existed gets them; a price set in the panel is kept
    await db
      .update(plans)
      .set({ priceMonthlyMinor: plan.priceMonthlyMinor, priceYearlyMinor: plan.priceYearlyMinor })
      .where(and(eq(plans.code, plan.code), isNull(plans.priceMonthlyMinor)));
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
        mustChangePassword: true,
      })
      .onConflictDoNothing({ target: platformUsers.email });
    // An admin seeded earlier whose password still equals the bootstrap one must change it at the
    // next sign-in. The plain value is only compared here, never stored.
    const [existing] = await db
      .select({
        id: platformUsers.id,
        hash: platformUsers.passwordHash,
        flagged: platformUsers.mustChangePassword,
      })
      .from(platformUsers)
      .where(eq(platformUsers.email, email.toLowerCase()));
    if (existing && !existing.flagged && (await verifySecret(existing.hash, password))) {
      await db
        .update(platformUsers)
        .set({ mustChangePassword: true })
        .where(eq(platformUsers.id, existing.id));
    }
    console.log(`Platform admin ready: ${email}`);
  } else {
    console.log('PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set; skipped platform admin.');
  }

  if (demoCatalog) {
    try {
      const result = await seedDemoCatalog(db, await demoStore(db, storeCode));
      console.log(`Demo catalog: ${result.created} products added, ${result.skipped} already there.`);
    } catch (error) {
      console.error(`Demo catalog not added: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}

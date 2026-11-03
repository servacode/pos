import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  CurrencyCode,
  OnboardingInput,
  SectorKey,
  StoreCurrencyData,
  StoreProfileData,
  StoreResponse,
  StoreScaleData,
} from '@serva/core';
import {
  branches,
  exchangeRates,
  tenantSettings,
  tenants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * The store's own settings (packages/core › contracts/store.ts): the start wizard and the settings
 * page write here. Every change is in the audit log with what it was before.
 */

const notFound = () => new AppError(404, 'not_found', 'المتجر غير موجود.');

async function mainBranch(tx: Transaction) {
  const [row] = await tx.select().from(branches).orderBy(asc(branches.code)).limit(1);
  return row ?? null;
}

async function latestUsdRate(tx: Transaction): Promise<string | null> {
  const [row] = await tx
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.unit, 'USD'), eq(exchangeRates.quote, 'SYP')))
    .orderBy(desc(exchangeRates.effectiveAt), desc(exchangeRates.id))
    .limit(1);
  return row?.rate ?? null;
}

async function read(tx: Transaction, tenantId: string): Promise<StoreResponse> {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [settings] = await tx.select().from(tenantSettings).limit(1);
  if (!tenant || !settings) throw notFound();
  const branch = await mainBranch(tx);
  const enabled = settings.enabledCurrencies as CurrencyCode[];
  return {
    name: tenant.name,
    legalName: tenant.legalName,
    taxNumber: tenant.taxNumber,
    sectors: tenant.sectors as SectorKey[],
    address: branch?.address ?? null,
    phone: branch?.phone ?? null,
    receiptFooter: settings.receiptFooter,
    baseCurrency: settings.baseCurrency as CurrencyCode,
    enabledCurrencies: enabled,
    taxInclusive: settings.taxInclusive,
    usdRate: enabled.includes('USD') ? await latestUsdRate(tx) : null,
    onboarding: { step: settings.onboardingStep, done: settings.onboardedAt !== null },
    scaleBarcode: settings.scaleBarcode ?? null,
  };
}

export function readStore(db: Database, auth: AccessClaims): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, (tx) => read(tx, auth.tenantId));
}

export function updateProfile(
  db: Database,
  auth: AccessClaims,
  input: StoreProfileData,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    await tx
      .update(tenants)
      .set({
        name: input.name,
        sectors: input.sectors,
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
      })
      .where(eq(tenants.id, auth.tenantId));
    const branch = await mainBranch(tx);
    if (branch && (input.address !== undefined || input.phone !== undefined)) {
      await tx
        .update(branches)
        .set({
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        })
        .where(eq(branches.id, branch.id));
    }
    if (input.receiptFooter !== undefined) {
      await tx.update(tenantSettings).set({ receiptFooter: input.receiptFooter });
    }
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.profile_update',
        entity: 'tenant',
        entityId: auth.tenantId,
        changes: changesOf(before, after, [
          'name',
          'legalName',
          'taxNumber',
          'sectors',
          'address',
          'phone',
          'receiptFooter',
        ]),
      },
      meta,
    );
    return after;
  });
}

export function updateCurrency(
  db: Database,
  auth: AccessClaims,
  input: StoreCurrencyData,
  meta: RequestMeta,
  now: Date,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    const enabled: CurrencyCode[] = input.usdEnabled ? ['SYP', 'USD'] : ['SYP'];
    await tx.update(tenantSettings).set({
      enabledCurrencies: enabled,
      ...(input.taxInclusive !== undefined ? { taxInclusive: input.taxInclusive } : {}),
    });
    // A new rate is a new row from now on: sales already made keep the rate they carried.
    if (input.usdEnabled && input.usdRate && input.usdRate !== (await latestUsdRate(tx))) {
      await tx.insert(exchangeRates).values({
        tenantId: auth.tenantId,
        unit: 'USD',
        quote: 'SYP',
        rate: normalizeRate(input.usdRate),
        effectiveAt: now,
        createdBy: auth.userId,
      });
    }
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.currency_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['enabledCurrencies', 'usdRate', 'taxInclusive']),
      },
      meta,
    );
    return after;
  });
}

export function updateOnboarding(
  db: Database,
  auth: AccessClaims,
  input: OnboardingInput,
  now: Date,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    await tx.update(tenantSettings).set({
      onboardingStep: input.step,
      ...(input.done ? { onboardedAt: now } : {}),
    });
    return read(tx, auth.tenantId);
  });
}

/** «باركود الميزان»: every till reads scale labels the same way after its next pull. */
export function updateScale(
  db: Database,
  auth: AccessClaims,
  input: StoreScaleData,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    await tx.update(tenantSettings).set({ scaleBarcode: input.scaleBarcode });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.scale_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['scaleBarcode']),
      },
      meta,
    );
    return after;
  });
}

/** «130.50» → «130.5», «0130» → «130»: one spelling per rate */
const normalizeRate = (rate: string) => String(Number(rate));

function changesOf(before: StoreResponse, after: StoreResponse, keys: (keyof StoreResponse)[]) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = [before[key], after[key]];
  }
  return changes;
}

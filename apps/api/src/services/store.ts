import { and, asc, desc, eq } from 'drizzle-orm';
import {
  catalogOptionsOf,
  DEFAULT_PHARMACY_SETTINGS,
  type CatalogOptions,
  type TillSettings,
  type CurrencyCode,
  type OnboardingInput,
  type PharmacySettings,
  type SectorKey,
  type StoreCurrencyData,
  type StoreProfileData,
  type StoreResponse,
  type StoreScaleData,
  type StoreLoyaltyData,
  type StoreServiceData,
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
import { ensureAlterationItem } from './catalog-defaults';
import { ensureServiceItem, MAINTENANCE_ITEM_NAME, RENTAL_ITEM_NAME } from './contracts-common';

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
    service: settings.service ?? null,
    loyalty: settings.loyalty ?? null,
    // Only a pharmacy has it; one that never chose gets the defaults
    pharmacy: pharmacyOf(tenant.sectors as SectorKey[], settings.pharmacy),
    till: settings.till ?? null,
    catalogOptions: catalogOptionsOf(settings.catalogOptions),
  };
}

/**
 * What the till gets as the store's batch rules. A pharmacy and a medical-supplies store both
 * refuse a sale with no valid batch unless the owner switched that off; a medical-supplies store
 * also picks the batch itself and blocks the expired unless the owner wrote `autoBatch: false`.
 * Only a value the owner never saved is defaulted, so no data migration is needed.
 */
function pharmacyOf(
  sectors: readonly SectorKey[],
  stored: PharmacySettings | null | undefined,
): PharmacySettings | null {
  const pharmacy = sectors.includes('pharmacy');
  const medical = sectors.includes('medical_supplies');
  if (!pharmacy && !medical) return stored ?? null;
  return {
    ...(stored ?? DEFAULT_PHARMACY_SETTINGS),
    ...(medical && !pharmacy && stored?.autoBatch === undefined ? { autoBatch: true } : {}),
    ...(stored?.blockNoBatch === undefined ? { blockNoBatch: true } : {}),
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
    // A clothing store sells alterations: the service item is there from the moment it is one
    if (input.sectors.includes('clothing')) await ensureAlterationItem(tx, auth.tenantId);
    // A medical-supplies store rents devices and sells maintenance contracts: their services too
    if (input.sectors.includes('medical_supplies')) {
      await ensureServiceItem(tx, auth.tenantId, RENTAL_ITEM_NAME);
      await ensureServiceItem(tx, auth.tenantId, MAINTENANCE_ITEM_NAME);
    }
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

/** «الصالة والمطبخ»: the tables, order numbers and kitchen tickets every till uses after its next pull. */
export function updateService(
  db: Database,
  auth: AccessClaims,
  input: StoreServiceData,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    await tx.update(tenantSettings).set({ service: input.service });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.service_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['service']),
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

/** «نقاط الولاء»: the rates every till and the server use from the next sale on. */
export function updateLoyalty(
  db: Database,
  auth: AccessClaims,
  input: StoreLoyaltyData,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    await tx.update(tenantSettings).set({ loyalty: input.loyalty });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.loyalty_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['loyalty']),
      },
      meta,
    );
    return after;
  });
}

/** «الصندوق»: the return window and whether a card payment needs the terminal's approval number. */
export function updateTill(
  db: Database,
  auth: AccessClaims,
  input: TillSettings,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    await tx.update(tenantSettings).set({ till: input });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.till_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['till']),
      },
      meta,
    );
    return after;
  });
}

/** «خيارات الأصناف»: barcode generation for new variants and the size runs of the purchase grid. */
export function updateCatalogOptions(
  db: Database,
  auth: AccessClaims,
  input: CatalogOptions,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const before = await read(tx, auth.tenantId);
    await tx.update(tenantSettings).set({ catalogOptions: input });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.catalog_options_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['catalogOptions']),
      },
      meta,
    );
    return after;
  });
}

/** «الصيدلية»: the prescription, medicine return and batch settings (pharmacies and medical-supply stores). */
export function updatePharmacy(
  db: Database,
  auth: AccessClaims,
  input: PharmacySettings,
  meta: RequestMeta,
): Promise<StoreResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await read(tx, auth.tenantId);
    // The till's batch picking is on for a pharmacy unless turned off; elsewhere only when turned on
    const isPharmacy = before.sectors.includes('pharmacy');
    // A medical-supplies store also defaults on; any other store only when it turns it on
    const medical = before.sectors.includes('medical_supplies');
    await tx.update(tenantSettings).set({
      pharmacy: isPharmacy ? input : { ...input, autoBatch: input.autoBatch ?? medical },
    });
    const after = await read(tx, auth.tenantId);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.pharmacy_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: changesOf(before, after, ['pharmacy']),
      },
      meta,
    );
    return after;
  });
}

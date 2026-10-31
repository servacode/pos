import { units, type Transaction } from '@serva/db';

/**
 * The units every store gets when it is created (docs/contracts/step4.md decision 5): «قطعة»
 * without fractions and «كيلو» with them, so a product can be saved before the owner visits the
 * units page. No tax rate is made. Migration 0011 gave the same two to the stores that existed.
 */
export const SYSTEM_UNITS = [
  { systemKey: 'piece', name: 'قطعة', symbol: 'قطعة', allowsFraction: false },
  { systemKey: 'kg', name: 'كيلو', symbol: 'كغ', allowsFraction: true },
] as const;

export async function seedCatalogDefaults(tx: Transaction, tenantId: string): Promise<void> {
  await tx
    .insert(units)
    .values(SYSTEM_UNITS.map((u) => ({ tenantId, ...u })))
    .onConflictDoNothing();
}

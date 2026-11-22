import type { PharmacySettings } from '@serva/core/contracts/pharmacy';
import type { SalePayload } from '@serva/core/contracts/documents';
import { medicineReturnRule, type MedicineReturnRule } from '@serva/core/pharmacy';
import { Alert, Checkbox } from '@serva/ui';
import type { Catalog } from '../catalog';

/**
 * The medicine return policy on the return screen (03 › الصيدليات: مرتجع الأدوية), kept out of
 * ReturnScreen: which lines of an invoice are medicines, what the store's rule says for each, and
 * the note and the «العلبة مغلقة» tick the cashier sees under it. The rule itself is in
 * packages/core/src/pharmacy.ts; a store with no pharmacy settings has none.
 */

/** The rule of each line of the sale, by line number; lines with no rule are left out */
export function medicineRulesOf(
  sale: SalePayload,
  catalog: Pick<Catalog, 'byVariant'>,
  pharmacy: PharmacySettings | null | undefined,
): Map<number, MedicineReturnRule> {
  const rules = new Map<number, MedicineReturnRule>();
  if (!pharmacy) return rules;
  for (const line of sale.lines) {
    const item = catalog.byVariant.get(line.variantId);
    const controlled = Boolean(item?.controlled);
    // A medicine is what the pharmacy sells with a prescription or a batch and an expiry date
    const medicine =
      controlled ||
      Boolean(
        item?.requiresPrescription ||
        line.batchNo ||
        line.batchExpiry ||
        item?.nearestExpiry ||
        item?.shelfBatches?.length,
      );
    const rule = medicineReturnRule(pharmacy, { medicine, controlled });
    if (rule.kind !== 'free') rules.set(line.lineNo, rule);
  }
  return rules;
}

/** True when every picked line that must be sealed has its tick */
export function sealedConfirmed(
  picks: readonly { saleLineNo: number; qty: number }[],
  rules: ReadonlyMap<number, MedicineReturnRule>,
  sealed: Readonly<Record<number, boolean>>,
): boolean {
  return picks.every((p) => rules.get(p.saleLineNo)?.kind !== 'sealed' || sealed[p.saleLineNo] === true);
}

/** True when a picked line is one the store does not take back */
export function hasBlockedPick(
  picks: readonly { saleLineNo: number; qty: number }[],
  rules: ReadonlyMap<number, MedicineReturnRule>,
): boolean {
  return picks.some((p) => rules.get(p.saleLineNo)?.kind === 'blocked');
}

/** Under a line: why a medicine does not come back, or the tick that its box is sealed */
export function MedicineReturnNote({
  rule,
  name,
  picked,
  confirmed,
  onConfirm,
}: {
  rule: MedicineReturnRule;
  name: string;
  /** Some of the line is picked to return */
  picked: boolean;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  if (rule.kind === 'blocked') {
    return (
      <Alert tone="warning" className="basis-full">
        {rule.reason}
      </Alert>
    );
  }
  if (rule.kind === 'sealed' && picked) {
    return (
      <div className="basis-full rounded-control bg-surface-muted px-3 py-1">
        <Checkbox
          label={`علبة «${name}» مغلقة وسليمة ولم تُفتح`}
          checked={confirmed}
          onChange={(event) => onConfirm(event.target.checked)}
        />
      </div>
    );
  }
  return null;
}

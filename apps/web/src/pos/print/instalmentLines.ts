import type { InstalmentPlanInput } from '@serva/core/contracts/installments';

/** One «label · value» row of the instalment block on a receipt */
export interface InstalmentRow {
  label: string;
  /** The instalment's due day: drawn left-to-right on the screen, after the label elsewhere */
  date?: string;
  value: string;
  bold?: boolean;
}

/**
 * What a receipt says about a sale on instalments, in order: the plan, the down payment, the fee,
 * what went on the account, then each instalment with its day. The same rows draw the screen
 * receipt, the thermal slip and the WhatsApp text.
 */
export function instalmentRows(plan: InstalmentPlanInput, money: (minor: number) => string): InstalmentRow[] {
  const rows: InstalmentRow[] = [
    { label: 'الدفعة الأولى', value: money(plan.downPaymentMinor) },
    ...(plan.markupMinor > 0 ? [{ label: 'رسم التقسيط', value: money(plan.markupMinor) }] : []),
    { label: 'المقسَّط على الحساب', value: money(plan.financedMinor), bold: true },
  ];
  for (const i of [...plan.schedule].sort((a, b) => a.no - b.no)) {
    rows.push({
      label: `القسط ${String(i.no)} من ${String(plan.count)}`,
      date: i.dueDate,
      value: money(i.amountMinor),
    });
  }
  return rows;
}

export const INSTALMENT_TITLE = 'خطة التقسيط';

/** A row's label as plain text: «القسط 1 من 6 · 2026-12-17» */
export const rowLabel = (r: InstalmentRow) => (r.date ? `${r.label} · ${r.date}` : r.label);

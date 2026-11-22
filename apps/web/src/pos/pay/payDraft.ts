import type { SaleTender } from '@serva/core/sale';

/**
 * The pay screen's choices (split, the parts taken, the method, the amount typed), kept on the device while the
 * screen is open. A pay screen that opens again for the same cart (a reload, a screen rebuilt under it) gets them
 * back, so it never shows fresh defaults, with the whole invoice as cash, in place of what the cashier chose.
 */
export const PAY_DRAFT_KEY = 'pay-draft';

export interface PayDraft {
  cashierId: string;
  lines: number;
  total: number;
  split: boolean;
  restPrefill: boolean;
  optionKey: string;
  text: string;
  reference: string;
  parts: { optionKey: string; tender: SaleTender }[];
}

/** The draft belongs to this cart and this cashier, and says something worth bringing back */
export function draftFits(
  draft: PayDraft | null | undefined,
  now: { cashierId: string; lines: number; total: number },
): draft is PayDraft {
  return (
    !!draft &&
    draft.cashierId === now.cashierId &&
    draft.lines === now.lines &&
    draft.total === now.total &&
    Array.isArray(draft.parts)
  );
}

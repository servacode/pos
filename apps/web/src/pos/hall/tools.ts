import type { HallOrder } from '@serva/core';
import type { CancelAnswer } from './cancelSent';

/**
 * What the till's own app gives the sale screen for a table's server order (03 › المطاعم): the
 * order itself while it can be reached, and the actions that go to the server.
 */
export interface HallTools {
  /** The server's order for the cart's table; null offline or when the cart has none */
  order: HallOrder | null;
  /** A part of the bill by items: the sale screen takes a cart of only these lines */
  onSplitItems: (lineIds: string[]) => void;
  /** An equal share of the bill (the next unpaid one) */
  onSplitEqual: (parts: number) => void;
  /** «نقل / دمج» on the table board; a problem to show, or null once done */
  onMoveTable: (from: string, to: string) => Promise<string | null>;
  /** A line already with the kitchen removed here: the server's cancel (or queued offline) */
  cancelSent: (
    lineNo: number,
    input: { reason: string; approverId: string; pin: string },
  ) => Promise<CancelAnswer>;
}

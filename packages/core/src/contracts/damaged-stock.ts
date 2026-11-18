/**
 * «البضاعة التالفة» (round 35, D7): goods that came back broken or past their date wait in a place of
 * their own for each store, never sellable, until they are sent back to the supplier or written off.
 * The place is a hidden branch of kind `damaged` (its parent is the store): the quantity and cost of
 * stock, a supplier return (POST /v1/supplier-returns) and a write-off (POST /v1/stocktakes with a
 * lower count) work on it exactly as on any branch, with their own entries.
 *
 *   GET /v1/damaged-stock     DamagedStock     (inventory.adjust or purchases.manage)
 */

export interface DamagedStockItem {
  variantId: string;
  name: string;
  /** Thousandths of the base unit */
  qty: number;
  /** What it cost, still in inventory (1300) until it is written off or sent back */
  valueMinor: number;
}

export interface DamagedStockLocation {
  /** The hidden branch that holds it: the branchId of a supplier return or a write-off */
  branchId: string;
  /** The store (or the van's home store) whose damaged goods these are */
  ownerBranchId: string;
  ownerName: string;
  items: DamagedStockItem[];
  totalValueMinor: number;
}

export interface DamagedStock {
  baseCurrency: string;
  locations: DamagedStockLocation[];
}

import type { CustomerRow } from '@serva/core/contracts/customers';
import type { Cart } from './cart';

/** The group's discount as an invoice discount (hundredths of a percent), or null: no group, no percent, an archived group */
export function groupDiscountOf(
  customer: Pick<CustomerRow, 'groupId' | 'groupName' | 'groupDiscountBps'> | undefined,
) {
  const bp = customer?.groupDiscountBps ?? 0;
  if (!customer?.groupId || !customer.groupName || bp <= 0) return null;
  return { id: customer.groupId, name: customer.groupName, bp: Math.min(bp, 10_000) };
}

/**
 * A customer picked (or removed): the group's discount comes onto the cart as an ordinary invoice discount; a discount
 * the cashier typed stays as it is, and the group's one leaves with its customer. Offline it reads the pulled row.
 */
export function withGroupDiscount(cart: Cart, customer: CustomerRow | undefined): Cart {
  const group = groupDiscountOf(customer);
  if (cart.invoiceGroup && cart.invoiceGroup.id !== group?.id) {
    const { invoiceGroup: _gone, ...rest } = cart;
    cart = { ...rest, invoiceDiscount: null, invoiceApproval: null };
  }
  if (!group || cart.invoiceDiscount) return cart;
  return {
    ...cart,
    invoiceDiscount: { type: 'percent', bp: group.bp },
    invoiceApproval: null,
    invoiceGroup: { id: group.id, name: group.name },
  };
}

/** The invoice discount taken off (the cashier's «أزله»): the group's label goes with it */
export function clearInvoiceDiscount(cart: Cart): Cart {
  const { invoiceGroup: _gone, ...rest } = cart;
  return { ...rest, invoiceDiscount: null, invoiceApproval: null };
}

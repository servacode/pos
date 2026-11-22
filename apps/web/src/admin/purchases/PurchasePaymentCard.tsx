import type { PurchasePayment } from '@serva/core';
import { CardHeader, Card, CashIcon, ChoiceCard, RadioGroup } from '@serva/ui';
import { PAYMENT_TEXT } from './pui';
import { SafeWarning } from './SafeWarning';
import { PAYMENT_LOOK } from './PurchasesShared';

/** «الدفع»: how the goods were paid for. */
export function PurchasePaymentCard({
  payment,
  onPayment,
  usd,
  total,
}: {
  payment: PurchasePayment;
  onPayment: (p: PurchasePayment) => void;
  usd: boolean;
  total: number;
}) {
  return (
    <Card>
      <CardHeader icon={<CashIcon />} title="الدفع" description="كيف دُفع ثمن البضاعة." />
      <RadioGroup legend="الدفع" hideLegend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(Object.keys(PAYMENT_TEXT) as PurchasePayment[]).map((p) => {
            const PayIcon = PAYMENT_LOOK[p].icon;
            return (
              <ChoiceCard
                key={p}
                name="purchase-payment"
                value={p}
                checked={payment === p}
                onChange={() => onPayment(p)}
                title={PAYMENT_TEXT[p]}
                description={PAYMENT_LOOK[p].hint}
                leading={<PayIcon />}
              />
            );
          })}
        </div>
      </RadioGroup>
      <SafeWarning active={payment === 'cash' && !usd} amountMinor={total} />
    </Card>
  );
}

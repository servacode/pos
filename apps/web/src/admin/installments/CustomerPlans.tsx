import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PLAN_STATUS_LABELS, type CurrencyCode, type PlanListItem } from '@serva/core';
import { Badge, Money } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { listPlans } from './api';

/**
 * «الأقساط» on a customer's page: each plan with what is left, the next day due and whether it is
 * late, each a link to the plan. Nothing shows for a customer with no plan, or for a person who may
 * not see plans.
 */
export function CustomerPlans({ customerId }: { customerId: string }) {
  const me = useMe();
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [base, setBase] = useState<CurrencyCode>('SYP');
  const allowed = me.user.permissions.includes('installments.view');
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    listPlans({ customerId })
      .then((r) => {
        if (!alive) return;
        setPlans(r.items);
        setBase(r.baseCurrency);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [allowed, customerId]);
  if (!allowed || plans.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="أقساطه">
      <h2 className="text-lg font-semibold text-ink">الأقساط</h2>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {plans.map((p) => (
          <li key={p.id}>
            <Link
              to={`/installments/${p.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-muted"
            >
              <bdi dir="ltr" className="num text-sm font-semibold">
                {p.number}
              </bdi>
              <Badge tone={p.lateCount > 0 ? 'danger' : p.status === 'active' ? 'brand' : 'neutral'}>
                {p.lateCount > 0 ? 'متأخرة' : PLAN_STATUS_LABELS[p.status]}
              </Badge>
              {p.nextDueDate ? (
                <span className="text-sm text-ink-muted">
                  القسط القادم {dayText(p.nextDueDate, me.settings.numberFormat)}
                </span>
              ) : null}
              <span className="flex-1" />
              <span className="text-sm text-ink-muted">المتبقي</span>
              <Money minor={p.remainingMinor} currency={base} className="font-semibold" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PLAN_STATUS_LABELS, type CurrencyCode, type PlanListItem } from '@serva/core';

import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { Amt, Panel, StatusPill } from '../sales/ui';
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
    <Panel title="الأقساط" flush>
      <ul className="cx-stm" aria-label="أقساطه">
        {plans.map((p) => (
          <li key={p.id}>
            <Link to={`/installments/${p.id}`} className="what hover:underline">
              <bdi dir="ltr" className="sx-n">
                {p.number}
              </bdi>{' '}
              {p.lateCount > 0 ? (
                <StatusPill kind="danger">متأخرة</StatusPill>
              ) : (
                <StatusPill kind="ok">{PLAN_STATUS_LABELS[p.status]}</StatusPill>
              )}
            </Link>
            <span className="end font-semibold">
              <span className="sx-sub text-xs">المتبقي </span>
              <Amt minor={p.remainingMinor} currency={base} />
            </span>
            {p.nextDueDate ? (
              <span className="row2">
                <span>القسط القادم {dayText(p.nextDueDate, me.settings.numberFormat)}</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { SupplierDueResponse } from '@serva/core';
import { useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { Amt, Panel, StatusPill } from '../sales/ui';
import { listSupplierDues } from './api';

/**
 * Round 62: «مستحق هذا الأسبوع»: the supplier invoices still owed that fall due within a week (or already have), so the
 * owner sees what to pay and when. It shows nothing when nothing falls due, and nothing when the read fails (the page
 * works without it). Payments settle the oldest invoices first, which the server works out.
 */
export function DuePanel({ tick = 0 }: { tick?: number }) {
  const digits = useDigits();
  const [due, setDue] = useState<SupplierDueResponse | null>(null);
  useEffect(() => {
    let alive = true;
    listSupplierDues(7).then(
      (r) => alive && setDue(r),
      () => alive && setDue(null),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  if (!due || due.items.length === 0) return null;
  return (
    <Panel
      title="مستحق هذا الأسبوع"
      aside={
        <span className="sx-n">
          <Amt minor={due.totalMinor} currency={due.baseCurrency} />
        </span>
      }
    >
      <ul className="px-due" aria-label="فواتير الموردين المستحقة">
        {due.items.slice(0, 6).map((d) => (
          <li key={d.purchaseId}>
            <Link
              to={`/suppliers/${d.supplierId}/statement`}
              className="px-due-row"
              aria-label={`كشف حساب ${d.supplierName}`}
            >
              <span className="px-owe-name">{d.supplierName}</span>
              <span className="sx-mute">
                <bdi dir="ltr" className="sx-n">
                  {d.number}
                </bdi>
                {' · '}
                {dayText(d.dueDate, digits)}
              </span>
              {d.overdueDays > 0 ? <StatusPill kind="danger">متأخرة</StatusPill> : null}
              <span className="px-due-amt">
                <Amt minor={d.openMinor} currency={due.baseCurrency} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {due.items.length > 6 ? (
        <p className="sx-mute">
          و<span className="sx-n">{(due.items.length - 6).toLocaleString('en-US')}</span> فواتير أخرى.
        </p>
      ) : null}
    </Panel>
  );
}

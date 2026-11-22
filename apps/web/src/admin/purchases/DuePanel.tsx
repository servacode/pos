import { useState } from 'react';
import { Link } from 'react-router';
import type { SupplierDueResponse, SupplierDueRow } from '@serva/core';
import { Button, useDigits } from '@serva/ui';
import { useIsPhone } from '../../lib/useIsPhone';
import { useMe } from '../../auth/useAuth';
import { addDays } from '../reports/periods';
import { dayText } from '../../lib/dates';
import { storeToday } from './api';
import { Amt, Panel, StatusPill } from '../sales/ui';

/** The way into the payment window on that supplier, the amount of the invoice already typed */
export const payLink = (d: Pick<SupplierDueRow, 'supplierId' | 'openMinor'>) =>
  `/purchases?pay=${d.supplierId}&amount=${d.openMinor}`;

/**
 * «مستحق هذا الأسبوع»: the supplier invoices still owed that fall due within a week (or already have), so the owner sees what
 * to pay and when; «كل المستحقات» opens every open invoice with a due date, and each row has «ادفع» (the payment window on
 * that supplier with the invoice's amount). It shows nothing when nothing has a due date, and nothing when the read failed
 * (the page works without it). Payments settle the oldest invoices first, which the server works out. (Round 62; the full list
 * and the pay button, round 64.)
 */
export function DuePanel({ dues }: { dues: SupplierDueResponse | null }) {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const [all, setAll] = useState(false);
  if (!dues || dues.items.length === 0) return null;
  const today = storeToday(me.tenant.timezone);
  const weekEnd = addDays(today, 7);
  const week = dues.items.filter((d) => d.dueDate <= weekEnd);
  const shown = all ? dues.items : week.slice(0, phone ? 3 : 6);
  const weekTotal = week.reduce((sum, d) => sum + d.openMinor, 0);
  return (
    <Panel
      title={all ? 'كل المستحقات' : 'مستحق هذا الأسبوع'}
      aside={
        <span className="px-due-aside">
          <span className="sx-n">
            <Amt minor={all ? dues.totalMinor : weekTotal} currency={dues.baseCurrency} />
          </span>
          {dues.items.length > week.length || week.length > (phone ? 3 : 6) || all ? (
            <Button variant="ghost" size="xs" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'هذا الأسبوع فقط' : `كل المستحقات (${dues.items.length.toLocaleString('en-US')})`}
            </Button>
          ) : null}
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="sx-mute">لا شيء يستحق هذا الأسبوع.</p>
      ) : (
        <ul className={all ? 'px-due px-due-all' : 'px-due'} aria-label="فواتير الموردين المستحقة">
          {shown.map((d) => (
            <li key={d.purchaseId} className="px-due-row">
              <Link
                to={`/suppliers/${d.supplierId}/statement`}
                className="px-due-who"
                aria-label={`كشف حساب ${d.supplierName}`}
              >
                <span className="px-owe-name">{d.supplierName}</span>
              </Link>
              <span className="sx-mute px-due-what">
                <span className="px-due-no">
                  <bdi dir="ltr" className="sx-n">
                    {d.number}
                  </bdi>
                  {' · '}
                </span>
                {dayText(d.dueDate, digits)}
              </span>
              {d.overdueDays > 0 ? (
                <StatusPill kind="danger">متأخرة</StatusPill>
              ) : (
                <span aria-hidden="true" />
              )}
              <span className="px-due-amt">
                <Amt minor={d.openMinor} currency={dues.baseCurrency} />
              </span>
              <Link to={payLink(d)} className="px-due-pay" aria-label={`ادفع ${d.supplierName} ${d.number}`}>
                ادفع
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!all && week.length > (phone ? 3 : 6) ? (
        <p className="sx-mute">
          و<span className="sx-n">{(week.length - (phone ? 3 : 6)).toLocaleString('en-US')}</span> فواتير
          أخرى: افتح «كل المستحقات».
        </p>
      ) : null}
    </Panel>
  );
}

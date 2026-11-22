import type { CurrencyCode, PurchaseRow } from '@serva/core';
import { useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { Amt } from '../sales/ui';
import { DueMark } from './DueMark';
import { InvoiceStatus } from './pui';

/** The invoices as cards on a phone. */
export function PurchaseCards({
  items,
  base,
  today,
  dueOpen,
  onOpen,
}: {
  items: PurchaseRow[];
  base: CurrencyCode;
  today: string;
  dueOpen: { has(id: string): boolean };
  onOpen: (p: PurchaseRow) => void;
}) {
  const digits = useDigits();
  return (
    <ul className="sx-cards" aria-label="فواتير الشراء">
      {items.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className="sx-icard px-amt-first"
            aria-label={`تفاصيل ${p.number}`}
            onClick={() => onOpen(p)}
          >
            <span className="n">{p.number}</span>
            <span className="st">
              <InvoiceStatus row={p} />
            </span>
            <span className="d">
              {p.supplierName} · {dayText(p.date, digits)}
            </span>
            <span className={`t ${p.correctedBy ? 'sx-sub' : ''}`}>
              <Amt minor={p.totalMinor} currency={base} />
            </span>
            {(p.payment === 'credit' && !p.correctedBy && p.dueDate) ||
            p.reference ||
            (p.currency === 'USD' && p.foreignTotalMinor) ? (
              <span className="x">
                {p.payment === 'credit' && !p.correctedBy && p.dueDate ? (
                  <>
                    تستحق <DueMark dueDate={p.dueDate} today={today} open={dueOpen.has(p.id)} />
                  </>
                ) : null}
                {p.reference ? (
                  <>
                    {p.payment === 'credit' && !p.correctedBy && p.dueDate ? ' · ' : ''}
                    رقمها عند المورد {p.reference}
                  </>
                ) : null}
                {p.currency === 'USD' && p.foreignTotalMinor ? (
                  <>
                    {' · '}
                    <Amt minor={p.foreignTotalMinor} currency="USD" />
                  </>
                ) : null}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

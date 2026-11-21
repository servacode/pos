import { useEffect, useMemo, useState } from 'react';
import type { CustomerListItem } from '@serva/core';
import { toLatinDigits } from '@serva/core/text';
import { Alert, Button, CashIcon, Dialog } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { countWord } from '../../lib/plural';
import { Amt } from '../sales/ui';
import { listCustomerPage } from './api';
import { debtReminderLink } from './debtReminder';

/**
 * Customers who share one phone get one message: their names are joined and their debts added
 */
export function mergeByPhone(list: readonly CustomerListItem[]): CustomerListItem[] {
  const byPhone = new Map<string, CustomerListItem>();
  const out: CustomerListItem[] = [];
  for (const c of list) {
    const key = c.phone ? [...toLatinDigits(c.phone)].filter((ch) => ch >= '0' && ch <= '9').join('') : '';
    const seen = key ? byPhone.get(key) : undefined;
    if (!seen) {
      const copy = { ...c };
      if (key) byPhone.set(key, copy);
      out.push(copy);
    } else {
      seen.name = `${seen.name} / ${c.name}`;
      seen.balanceMinor += c.balanceMinor;
    }
  }
  return out;
}

/**
 * «تذكير جماعي للمدينين»: every customer who owes and can be written to (a phone, and not «لا يريد
 * رسائل»), each with his own WhatsApp link carrying the amount. WhatsApp has no bulk send for a shop's
 * own number, so «افتح التالي» opens the next chat and marks it done; the owner presses send in each.
 */
export function BulkReminder({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const [debtors, setDebtors] = useState<CustomerListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: CustomerListItem[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 50; guard += 1) {
          const page = await listCustomerPage({ owing: true, limit: 200, cursor });
          all.push(...page.items);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (alive) setDebtors(all);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(
    () =>
      mergeByPhone((debtors ?? []).filter((c) => !c.archived && !c.noMessages))
        .map((c) => ({
          customer: c,
          link: debtReminderLink(c.phone, {
            name: c.name,
            balanceMinor: c.balanceMinor,
            currency: base,
            store: me.tenant.name,
          }),
        }))
        .filter((r) => r.link !== null),
    [debtors, base, me.tenant.name],
  );
  const skipped = (debtors?.length ?? 0) - rows.length;
  const next = rows.find((r) => !done.has(r.customer.id));

  const open = (id: string, link: string) => {
    window.open(link, '_blank', 'noopener,noreferrer');
    setDone((d) => new Set(d).add(id));
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="تذكير جماعي للمدينين"
      description="يُفتح لكل مدين حوار واتساب فيه اسمه ومبلغه، وأنت ترسل."
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {debtors === null && !error ? <p className="sx-wait">نحمّل المدينين…</p> : null}
        {debtors ? (
          <>
            <p className="sx-wait m-0">
              <bdi className="sx-n font-semibold">{rows.length}</bdi>{' '}
              {countWord(rows.length, { one: 'مدين', two: 'مدينان', few: 'مدينين' })} يمكن تذكيرهم
              {skipped > 0 ? (
                <>
                  ، و<bdi className="sx-n">{skipped}</bdi> بلا رقم أو لا يريدون رسائل
                </>
              ) : null}
              . تمّ منهم <bdi className="sx-n">{done.size}</bdi>.
            </p>
            {rows.length > 0 ? (
              <>
                <Button
                  icon={<CashIcon />}
                  disabled={!next}
                  onClick={() => next?.link && open(next.customer.id, next.link)}
                >
                  {next ? `افتح التالي: ${next.customer.name}` : 'انتهيت من الجميع'}
                </Button>
                <ul className="cx-groups cx-rem" aria-label="المدينون">
                  {rows.map(({ customer, link }) => (
                    <li key={customer.id}>
                      <span className="nm">{customer.name}</span>
                      <Amt minor={customer.balanceMinor} currency={base} />
                      {done.has(customer.id) ? (
                        <span className="cx-ok">فُتح</span>
                      ) : (
                        <a
                          href={link ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="sx-fbtn"
                          onClick={() => setDone((d) => new Set(d).add(customer.id))}
                        >
                          واتساب
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

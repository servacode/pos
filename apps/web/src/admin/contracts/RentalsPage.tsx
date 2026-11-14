import { useCallback, useEffect, useState } from 'react';
import { RENTAL_RATE_LABELS, type Rental } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Money,
  PageHeader,
  PrintIcon,
  SegmentedControl,
  SerialIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { PrintableRentalContract } from '../../lib/RentalContract';
import { SectionHead } from '../purchases/parts';
import { listRentals } from './api';

/**
 * «التأجير» (03 › الأدوات الطبية): the devices out with customers, the late ones first, and the
 * contract to print on A4. A device goes out and comes back at the till, where the rent is sold as a
 * «إيجار» line less the deposit; this screen only follows them.
 */
export function RentalsPage() {
  const me = useMe();
  const digits = useDigits();
  const [status, setStatus] = useState<'out' | 'all'>('out');
  const [items, setItems] = useState<Rental[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Rental | null>(null);

  const load = useCallback(() => {
    setError(null);
    listRentals(status)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);

  function print(rental: Rental) {
    setSheet(rental);
    // The sheet is in the page once React has drawn it
    setTimeout(() => window.print(), 0);
  }

  const late = (items ?? []).filter((r) => r.overdue).length;

  return (
    <AppShell>
      <title>التأجير · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="التأجير"
          description="الأجهزة المؤجَّرة الآن والمتأخرة منها أولاً. التسليم والاستلام من الصندوق، وتُباع الأجرة ببند «إيجار»."
        />
        <section aria-label="التأجير" className="flex flex-col gap-3">
          <SectionHead
            title={status === 'out' ? 'الأجهزة عند الزبائن' : 'آخر 200 عقد'}
            description={late > 0 ? `${late} متأخر عن موعد الإرجاع.` : undefined}
          >
            <SegmentedControl
              label="العرض"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'out', label: 'خارج المحل' },
                { value: 'all', label: 'الكل' },
              ]}
            />
          </SectionHead>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {items && items.length === 0 ? (
            <EmptyState
              icon={SerialIcon}
              title="لا أجهزة مؤجَّرة."
              description="فعّل «قابل للتأجير» في صفحة الصنف، ثم أجِّر قطعة برقمها التسلسلي من الصندوق."
            />
          ) : null}
          <ul className="flex flex-col gap-3">
            {(items ?? []).map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <bdi dir="ltr" className="num font-semibold">
                      {r.number}
                    </bdi>
                    {r.status === 'returned' ? (
                      <Badge tone="neutral">أُعيد</Badge>
                    ) : r.overdue ? (
                      <Badge tone="danger">متأخر</Badge>
                    ) : (
                      <Badge tone="info">عند الزبون</Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.item}</span>
                    <bdi dir="ltr" className="num text-sm text-ink-muted">
                      {r.serial}
                    </bdi>
                  </div>
                  <p className="text-sm text-ink">
                    {r.customerName}
                    <span className="text-ink-muted">
                      {' · '}
                      <bdi dir="ltr" className="num">
                        {r.customerPhone}
                      </bdi>
                      {' · من '}
                      {dayText(r.startDate, digits)}
                      {r.status === 'returned' && r.returnedOn
                        ? ` إلى ${dayText(r.returnedOn, digits)}`
                        : ` والإرجاع المتوقع ${dayText(r.expectedReturn, digits)}`}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                    <span>
                      الأجرة <Money minor={r.rateMinor} currency={r.currency} />{' '}
                      {RENTAL_RATE_LABELS[r.rateUnit]}
                    </span>
                    <span>
                      {r.status === 'returned' ? 'المستحق' : 'المستحق حتى اليوم'}{' '}
                      <Money minor={r.chargeMinor} currency={r.currency} className="font-semibold" />
                    </span>
                    {r.depositMinor > 0 ? (
                      <span>
                        العربون <Money minor={r.depositMinor} currency={r.currency} />
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <Button
                      variant="ghost"
                      icon={<PrintIcon />}
                      aria-label={`اطبع عقد ${r.number}`}
                      onClick={() => print(r)}
                    >
                      اطبع العقد
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {sheet ? <PrintableRentalContract rental={sheet} store={me.tenant.name} /> : null}
    </AppShell>
  );
}

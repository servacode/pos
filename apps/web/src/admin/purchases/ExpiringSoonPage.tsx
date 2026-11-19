import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { addMonthsISO, COUNT_NOUNS, countNoun, daysBetweenISO, type ExpiryResponse } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CalendarIcon,
  EmptyState,
  formatQuantity,
  PageHeader,
  SegmentedControl,
  Skeleton,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { listExpiry, today } from './api';
import { groupExpiring, prefillOfGroup, UNKNOWN_SUPPLIER, type ExpiringGroup } from './expiringBySupplier';

type Months = '1' | '2' | '3' | '6';

/**
 * «بينتهي قريباً» (round 38, pharmacy): the batches that end within N months, grouped by the supplier they came
 * from. «رجّعو للمورد» opens the supplier return already filled with that group's batches and what is left of
 * each; the person checks the quantities and saves it there, through the same return as any other.
 */
export function ExpiringSoonPage() {
  const digits = useDigits();
  const navigate = useNavigate();
  const [months, setMonths] = useState<Months>('3');
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The window in days, from today to the same day N months on
  const windowDays = useMemo(() => {
    const t = today();
    return daysBetweenISO(t, addMonthsISO(t, Number(months)));
  }, [months]);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    listExpiry(windowDays)
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [windowDays]);
  useEffect(load, [load]);

  const groups = useMemo(() => (data ? groupExpiring(data.items, windowDays) : []), [data, windowDays]);
  const several = new Set(groups.map((g) => g.branchId)).size > 1;

  function sendBack(group: ExpiringGroup) {
    const prefill = prefillOfGroup(group, Number(months));
    if (prefill) void navigate('/supplier-returns', { state: { prefill } });
  }

  return (
    <AppShell>
      <title>بينتهي قريباً · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="بينتهي قريباً"
          description="الدفعات التي انتهت أو تنتهي خلال المدة، مجمّعة حسب المورد. «رجّعو للمورد» يفتح مرتجعاً مملوءاً بها."
          actions={
            <SegmentedControl
              label="خلال"
              className="max-w-full overflow-x-auto"
              value={months}
              onValueChange={setMonths}
              options={[
                { value: '1', label: 'شهر' },
                { value: '2', label: 'شهرين' },
                { value: '3', label: '3 أشهر' },
                { value: '6', label: '6 أشهر' },
              ]}
            />
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!data && !error ? (
          <Skeleton className="h-40 w-full" />
        ) : data && groups.length === 0 ? (
          <EmptyState
            icon={CalendarIcon}
            title="لا شيء ينتهي في هذه المدة."
            description="اكتب الدفعة وتاريخ الانتهاء في فاتورة الشراء ليظهر هنا."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <Card key={group.key} aria-label={group.supplierName}>
                <CardHeader
                  title={group.supplierName}
                  description={
                    <>
                      {several ? `${group.branchName} · ` : ''}
                      {countNoun(group.rows.length, COUNT_NOUNS.batch, String(group.rows.length), true)}
                      {' · '}
                      <bdi className="num">{formatQuantity(group.totalQty, digits)}</bdi> قطعة
                    </>
                  }
                  action={
                    group.supplierId ? (
                      <Button
                        variant={group.earliestDays < 0 ? 'primary' : 'secondary'}
                        size="md"
                        icon={<UndoIcon size={20} />}
                        aria-label={`رجّعو للمورد ${group.supplierName}`}
                        onClick={() => sendBack(group)}
                      >
                        رجّعو للمورد
                      </Button>
                    ) : (
                      <Badge tone="neutral">{UNKNOWN_SUPPLIER}: يُرجَع من «مرتجع إلى المورد»</Badge>
                    )
                  }
                />
                <ul aria-label={`دفعات ${group.supplierName}`} className="flex flex-col divide-y divide-line">
                  {group.rows.map((r) => (
                    <li
                      key={`${r.variantId}|${r.batchNo ?? ''}|${r.expiryDate ?? ''}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                    >
                      <span className="min-w-0 flex-1 basis-40 font-semibold text-ink">{r.name}</span>
                      <span className="text-sm text-ink-muted">
                        {r.batchNo ? (
                          <>
                            دفعة{' '}
                            <bdi dir="ltr" className="num">
                              {r.batchNo}
                            </bdi>{' '}
                            ·{' '}
                          </>
                        ) : null}
                        تنتهي <bdi className="num">{dayText(r.expiryDate!, digits)}</bdi>
                      </span>
                      <Badge tone={r.daysLeft! < 0 ? 'danger' : r.daysLeft! <= 30 ? 'warning' : 'neutral'}>
                        {r.daysLeft! < 0
                          ? `منتهية منذ ${countNoun(-r.daysLeft!, COUNT_NOUNS.day, String(-r.daysLeft!), true)}`
                          : `باقٍ ${countNoun(r.daysLeft!, COUNT_NOUNS.day, String(r.daysLeft!), true)}`}
                      </Badge>
                      <span className="num min-w-14 text-end font-semibold text-ink">
                        {formatQuantity(r.qty, digits)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

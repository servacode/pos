import { useCallback, useEffect, useState } from 'react';
import { QUOTATION_STATUS_LABELS, type Quotation } from '@serva/core/contracts/quotations';
import { Alert, Badge, Button, EmptyState, ListIcon, Money, RetryIcon, Skeleton, useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { FlowHeader } from '../FlowParts';
import { usePos } from '../services';
import { openQuotations } from './api';

/**
 * «عروض الأسعار» at the till (03 › الجملة): the offers still waiting for an answer, newest first.
 * «افتحه في السلة» fills the cart with its lines at the offered prices; the sale is the ordinary
 * sale, and the offer turns «حُوّل إلى فاتورة» once it is saved. Needs the server.
 */
export function QuotationsScreen({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  /** Fills the cart; returns the lines it could not add, or null when it opened nothing */
  onOpen: (q: Quotation) => string[] | null;
}) {
  const pos = usePos();
  const digits = useDigits();
  const [items, setItems] = useState<Quotation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The cart is open, but these lines are not on this till */
  const [left, setLeft] = useState<string[] | null>(null);
  const token = pos.device.token;

  const load = useCallback(async () => {
    if (!token || !pos.online()) {
      setError('عروض الأسعار تحتاج اتصالاً بالخادم.');
      setItems([]);
      return;
    }
    const answer = await openQuotations(token, pos.fetch);
    if (answer.kind === 'ok') {
      setItems(answer.body.items);
      setError(null);
    } else {
      setItems([]);
      setError(answer.kind === 'refused' ? answer.message : 'تعذّر الوصول إلى الخادم.');
    }
  }, [pos, token]);
  useEffect(() => {
    void load();
  }, [load]);

  function open(q: Quotation) {
    const missing = onOpen(q);
    if (missing && missing.length > 0) setLeft(missing);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <FlowHeader
        title="عروض الأسعار"
        description="العروض بانتظار رد الزبون. افتح العرض في السلة لتبيعه بالأسعار المعروضة."
        icon={<ListIcon />}
        onBack={onBack}
        actions={
          <Button variant="secondary" icon={<RetryIcon />} onClick={() => void load()}>
            حدّث
          </Button>
        }
      />
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {left ? (
        <Alert tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            فُتح العرض في السلة، ولم تُضَف هذه الأصناف لأنها ليست على هذا الجهاز: {left.join('، ')}.
            <Button size="sm" onClick={onBack}>
              تابع إلى السلة
            </Button>
          </span>
        </Alert>
      ) : null}
      {items === null ? <Skeleton className="h-24 w-full" /> : null}
      {items && items.length === 0 && !error ? (
        <EmptyState
          icon={ListIcon}
          title="لا عروض بانتظار الرد"
          description="احفظ السلة كعرض سعر بزر «عرض سعر» على شاشة البيع، أو اكتب العرض من لوحة الإدارة."
        />
      ) : null}
      <ul aria-label="عروض الأسعار" className="flex flex-col gap-3">
        {(items ?? []).map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-4 shadow-e1"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <bdi dir="ltr" className="num text-lg font-bold text-ink">
                  {q.number}
                </bdi>
                <Badge tone={q.status === 'accepted' ? 'success' : 'info'}>
                  {QUOTATION_STATUS_LABELS[q.status]}
                </Badge>
              </span>
              <span className="text-ink-muted">
                {q.customerName ?? 'بلا اسم'} · صالح حتى {dayText(q.validUntil, digits)} · {q.lines.length}{' '}
                {q.lines.length === 1 ? 'صنف' : 'أصناف'}
              </span>
            </div>
            <Money minor={q.totalMinor} currency={q.currency} className="text-xl font-bold text-ink" />
            <Button onClick={() => open(q)}>افتحه في السلة</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

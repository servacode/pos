import { useEffect, useState, type ReactNode } from 'react';
import { dayProgress } from '@serva/core/distribution';
import { Alert, Badge, Button, CashIcon, CheckCircleIcon, LockIcon, StockIcon } from '@serva/ui';
import type { OutboxEntry } from '@serva/sync';
import { deviceDocuments, type OpenShift } from '../pos/shift/shift';
import { usePos } from '../pos/services';
import { daySummary, floatOf, type DaySummary } from './day';
import { Figure, MoneyList } from './parts';
import { useRepRequired } from './state';
import { VAN_COUNT_KEY } from './day';
import type { VanCount } from './StockTab';

/**
 * «يومي»: what this phone did today, and the way to end it in order: count the van, hand the cash
 * over, close the shift. Every figure is from the documents the phone itself saved, sent or not.
 */
export function DayTab({
  shift,
  onCountVan,
  onCash,
  onCloseShift,
}: {
  shift: OpenShift | null;
  onCountVan: () => void;
  onCash: () => void;
  onCloseShift: () => void;
}) {
  const pos = usePos();
  const rep = useRepRequired();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [counted, setCounted] = useState(false);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const date = rep.businessDate;

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => {
      if (!alive) return;
      setEntries(list);
      if (date) setSummary(daySummary(list, date));
    });
    void pos.local.get<VanCount>(VAN_COUNT_KEY).then((c) => alive && setCounted(c?.date === date));
    return () => {
      alive = false;
    };
  }, [pos.store, pos.local, date, rep.visits]);

  const progress = dayProgress(rep.list.stops);
  const pending = entries.filter((e) => e.status !== 'confirmed').length;
  const float = floatOf(entries, shift?.id ?? null);
  const handed = summary
    ? entries.filter(
        (e) =>
          e.doc.type === 'cash_movement' &&
          (e.doc.payload as { shiftId?: string; kind?: string }).shiftId === shift?.id &&
          (e.doc.payload as { kind?: string }).kind === 'safe_drop',
      ).length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="ملخص اليوم" className="grid grid-cols-2 gap-2">
        <Figure label="مبيعات اليوم">
          <MoneyList byCurrency={summary?.sales.byCurrency ?? {}} />
        </Figure>
        <Figure label="عدد الفواتير">{summary?.sales.count ?? 0}</Figure>
        <Figure
          label="بالآجل"
          tone={Object.values(summary?.credit ?? {}).some((n) => n > 0) ? 'danger' : 'plain'}
        >
          <MoneyList byCurrency={summary?.credit ?? {}} />
        </Figure>
        <Figure label="المقبوض من الزبائن" tone="success">
          <MoneyList byCurrency={summary?.collections.byCurrency ?? {}} />
        </Figure>
        <Figure label="المرتجعات">
          <MoneyList byCurrency={summary?.returns.byCurrency ?? {}} />
        </Figure>
        <Figure label="الزيارات">
          {progress.done} من {progress.total}
        </Figure>
      </section>
      {Object.keys(float).length > 0 ? (
        <section
          aria-label="عهدة اليوم"
          className="flex items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"
        >
          <CheckCircleIcon size={20} className="shrink-0 text-success-ink" />
          <span className="font-semibold text-ink">استلمت عهدة</span>
          <span className="num font-bold text-ink">
            <MoneyList byCurrency={float} />
          </span>
        </section>
      ) : null}
      {pending > 0 ? (
        <Alert tone="info">{pending} مستنداً لم يصل إلى الخادم بعد. تُرسل عند وجود اتصال.</Alert>
      ) : null}

      <section
        aria-label="إنهاء اليوم"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      >
        <h3 className="text-base font-bold text-ink">إنهاء اليوم</h3>
        <Step
          done={counted}
          icon={<StockIcon />}
          title="جرد السيارة"
          text="عُدّ ما بقي على السيارة. لا ترى رصيد الدفتر حتى تحفظ."
          action={
            <Button variant="secondary" size="sm" onClick={onCountVan}>
              {counted ? 'راجع الجرد' : 'ابدأ الجرد'}
            </Button>
          }
        />
        <Step
          done={handed > 0}
          icon={<CashIcon />}
          title="تسليم النقد للخزنة"
          text="يلزم رمز المشرف أو المدير. سجّل «إيداع للخزنة» بما في درجك."
          action={
            <Button variant="secondary" size="sm" disabled={!shift} onClick={onCash}>
              حركات الدرج
            </Button>
          }
        />
        <Step
          done={false}
          icon={<LockIcon />}
          title="إغلاق الوردية"
          text="عدّ النقد دون أن ترى المتوقع، ثم أغلق. الفرق يُسجَّل باسمك."
          action={
            <Button variant="danger-soft" size="sm" disabled={!shift} onClick={onCloseShift}>
              أغلق الوردية
            </Button>
          }
        />
      </section>
    </div>
  );
}

function Step({
  done,
  icon,
  title,
  text,
  action,
}: {
  done: boolean;
  icon: ReactNode;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-ink-muted">
        {done ? <CheckCircleIcon className="text-success" /> : icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center gap-2 text-sm font-bold text-ink">
          {title}
          {done ? <Badge tone="success">تم</Badge> : null}
        </p>
        <p className="text-xs text-ink-muted">{text}</p>
      </div>
      {action}
    </div>
  );
}

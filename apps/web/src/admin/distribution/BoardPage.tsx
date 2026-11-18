import { useEffect, useState } from 'react';
import type { BoardRep, BoardStopStatus, TodayBoard } from '@serva/core';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Money,
  PageHeader,
  ProgressBar,
  Skeleton,
  TruckIcon,
  type BadgeTone,
} from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { errorMessage } from '../../lib/api';
import { getBoard } from './api';
import { todayText } from './SettlementsPage';

const STOP_LABEL: Record<BoardStopStatus, string> = {
  todo: 'لم يُزر',
  here: 'عنده الآن',
  sale: 'بيع',
  order: 'طلبية',
  collection: 'تحصيل',
  return: 'مرتجع',
  no_sale: 'بلا بيع',
  none: 'زيارة فقط',
};
const STOP_TONE: Record<BoardStopStatus, BadgeTone> = {
  todo: 'neutral',
  here: 'info',
  sale: 'success',
  order: 'success',
  collection: 'success',
  return: 'warning',
  no_sale: 'danger',
  none: 'neutral',
};
const DAY_LABEL = { none: 'لم يبدأ يومه', open: 'في الميدان', closed: 'أنهى يومه' } as const;
const DAY_TONE: Record<BoardRep['day'], BadgeTone> = { none: 'neutral', open: 'info', closed: 'success' };

function RepCard({ rep, base }: { rep: BoardRep; base: TodayBoard['baseCurrency'] }) {
  return (
    <Card>
      <CardHeader title={rep.name} />
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={DAY_TONE[rep.day]}>{DAY_LABEL[rep.day]}</Badge>
          {rep.vanName ? <span className="text-ink-muted">{rep.vanName}</span> : null}
          {rep.routeNames.length > 0 ? (
            <span className="text-ink-muted">{rep.routeNames.join('، ')}</span>
          ) : null}
        </div>
        <ProgressBar
          label={`زيارات ${rep.name}`}
          value={rep.visited}
          max={Math.max(rep.planned, rep.visited, 1)}
          valueText={`زار ${rep.visited} من ${rep.planned}`}
        />
        <p>
          زار <bdi className="num">{rep.visited}</bdi> من <bdi className="num">{rep.planned}</bdi>
          {rep.currentCustomer ? (
            <>
              {' '}
              · عند <span className="font-semibold">{rep.currentCustomer}</span>
            </>
          ) : null}
        </p>
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">
              مبيعات (<bdi className="num">{rep.sales}</bdi>)
            </dt>
            <dd>
              <Money minor={rep.salesTotalMinor} currency={base} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">
              تحصيل (<bdi className="num">{rep.collections}</bdi>)
            </dt>
            <dd>
              <Money minor={rep.collectedMinor} currency={base} />
            </dd>
          </div>
        </dl>
        <p className="text-ink-muted">
          طلبيات <bdi className="num">{rep.orders}</bdi> · مرتجع <bdi className="num">{rep.returns}</bdi> ·
          بلا بيع <bdi className="num">{rep.noSales}</bdi>
        </p>
        {rep.stops.length > 0 ? (
          <details>
            <summary className="cursor-pointer font-semibold">زبائن اليوم</summary>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {rep.stops.map((s) => (
                <li key={s.customerId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <Badge tone={STOP_TONE[s.status]}>{STOP_LABEL[s.status]}</Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

/** «لوحة اليوم»: where each rep is on his route, how many visits he has done and what he sold and collected */
export function BoardPage() {
  const [date, setDate] = useState(todayText());
  const [board, setBoard] = useState<TodayBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again every minute while the page is open: the board is for watching the day go by
  useEffect(() => {
    let live = true;
    const load = () =>
      getBoard(date)
        .then((b) => {
          if (live) {
            setBoard(b);
            setError(null);
          }
        })
        .catch((e: unknown) => live && setError(errorMessage(e)));
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [date]);

  return (
    <>
      <PageHeader
        title="لوحة اليوم"
        description="أين وصل كل مندوب في خطه، وما باع وما حصّل."
        icon={<TruckIcon />}
        actions={<DateField label="اليوم" value={date} onChange={setDate} required />}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!board && !error ? <Skeleton className="h-40 w-full" /> : null}
      {board && board.reps.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title="لا مندوبين."
          description="أضف مندوباً بسيارته وخطه من صفحة المندوبين، فيظهر هنا."
        />
      ) : null}
      {board && board.reps.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {board.reps.map((r) => (
            <RepCard key={r.repId} rep={r} base={board.baseCurrency} />
          ))}
        </div>
      ) : null}
    </>
  );
}

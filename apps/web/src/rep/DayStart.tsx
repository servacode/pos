import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, formatQuantity, TruckIcon } from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { lazyChunk } from '../pos/chunks';
import type { OpenShift } from '../pos/shift/shift';
import type { StaffSession } from '../pos/staff/staff';
import { usePos } from '../pos/services';
import { postDayStart } from './api';
import { cartonText, packsOf } from './packs';
import { useRepRequired } from './state';

// The shift opens at 0 and the float is a pay-in from the safe with a manager's code (round 35 › D5)
const RepShiftOpen = lazyChunk(() => import('./DayFloat').then((m) => ({ default: m.RepShiftOpen })));

/**
 * «ابدأ يومك»: the rep checks what the supervisor loaded on his van, confirms it, then opens his
 * shift at 0 (his drawer is account 1110) and takes the float the manager hands him as a pay-in from
 * the safe, with the manager's code. The server is told the day started when it can be reached.
 */
export function DayStart({
  session,
  catalog,
  onOpened,
}: {
  session: StaffSession;
  catalog: Catalog;
  onOpened: (shift: OpenShift) => void;
}) {
  const pos = usePos();
  const rep = useRepRequired();
  const [confirmed, setConfirmed] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const packs = useMemo(() => packsOf(catalog), [catalog]);
  const loaded = useMemo(
    () =>
      catalog.items
        .filter((i) => !i.isService && (i.stockQty ?? 0) > 0)
        .toSorted((a, b) => a.name.localeCompare(b.name, 'ar')),
    [catalog.items],
  );

  if (confirmed) {
    return (
      <RepShiftOpen
        session={session}
        catalog={catalog}
        onOpened={(opened, float) => {
          const token = pos.device.token;
          if (token && rep.businessDate && pos.online()) {
            void postDayStart(
              { businessDate: rep.businessDate, openingCash: float, loadConfirmed: true },
              token,
              pos.fetch,
            );
          }
          onOpened(opened);
        }}
      />
    );
  }

  return (
    <section aria-label="ابدأ يومك" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <TruckIcon className="shrink-0 text-brand-ink" />
        <h2 className="text-lg font-bold text-ink">ابدأ يومك</h2>
      </div>
      <p className="text-sm text-ink-muted">
        راجع ما حُمّل على سيارتك قبل أن تنطلق. إن اختلف عن الورقة فأخبر المشرف قبل أن تؤكد.
      </p>
      {loaded.length === 0 ? (
        <Alert tone="info">لا بضاعة على السيارة الآن. إن كنت تأخذ طلبيات فقط فتابع.</Alert>
      ) : (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
          <p className="text-sm font-semibold text-ink">
            على السيارة <span className="num">{loaded.length}</span> صنفاً
          </p>
          {showItems ? (
            <ul aria-label="حمولة السيارة" className="flex flex-col gap-1 text-sm">
              {loaded.map((i) => (
                <li key={i.variantId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <span className="num text-xs text-ink-muted">
                    {cartonText(i.stockQty ?? 0, packs.get(i.variantId))}
                  </span>
                  <span className="num font-bold">{formatQuantity(i.stockQty ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setShowItems((s) => !s)}>
            {showItems ? 'أخفِ الأصناف' : 'اعرض الأصناف'}
          </Button>
        </div>
      )}
      <Checkbox
        label="استلمت الحمولة وراجعتها"
        checked={confirmed}
        onChange={(e) => setConfirmed(e.target.checked)}
      />
      <p className="text-xs text-ink-muted">
        تؤكد الحمولة ثم تفتح الوردية وتسجّل العهدة التي يسلّمك إياها المدير.
      </p>
    </section>
  );
}

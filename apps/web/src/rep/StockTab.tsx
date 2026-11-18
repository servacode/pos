import { useEffect, useMemo, useState } from 'react';
import { committedByVariant } from '@serva/core/distribution';
import { normalizeArabic } from '@serva/core/text';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  formatQuantity,
  SearchIcon,
  StockIcon,
  TextField,
} from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { usePos } from '../pos/services';
import { VAN_COUNT_KEY } from './day';
import { useRepRequired } from './state';

export interface VanCount {
  /** The business day it was counted for */
  date: string;
  at: number;
  /** The server has it (set by the phone's state once it was sent) */
  sent?: boolean;
  lines: { variantId: string; name: string; system: number; counted: number }[];
}

/** What a count found: the lines where the shelf differs from the book, shortage first */
export function countDifferences(count: VanCount): VanCount['lines'] {
  return count.lines
    .filter((l) => l.counted !== l.system)
    .toSorted((a, b) => a.counted - a.system - (b.counted - b.system));
}

const toThousandths = (typed: string): number | null => {
  const n = Number(typed.replace(',', '.').trim());
  return typed.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
};

/**
 * «السيارة»: what the van holds (from its own branch's stock), with what open orders already
 * promise. «جرد السيارة» is a blind count: he types what is on the shelf without seeing the book,
 * and the differences show after he saves. The supervisor settles them with the day's settlement.
 */
export function StockTab({ catalog }: { catalog: Catalog }) {
  const pos = usePos();
  const rep = useRepRequired();
  const [search, setSearch] = useState('');
  const [counting, setCounting] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<VanCount | null>(null);
  const items = useMemo(
    () =>
      catalog.items
        .filter((i) => !i.isService && (i.stockQty ?? 0) !== 0)
        .toSorted((a, b) => a.name.localeCompare(b.name, 'ar')),
    [catalog.items],
  );
  const committed = useMemo(() => committedByVariant(rep.orders), [rep.orders]);
  const q = normalizeArabic(search);
  const shown = q ? items.filter((i) => i.searchKey.includes(q)) : items;

  useEffect(() => {
    let alive = true;
    void pos.local.get<VanCount>(VAN_COUNT_KEY).then((c) => {
      if (alive && c && c.date === rep.businessDate) setSaved(c);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, rep.businessDate]);

  async function save() {
    const lines = items.map((i) => ({
      variantId: i.variantId,
      name: i.name,
      system: i.stockQty ?? 0,
      // An item left blank was not counted as present: zero on the shelf
      counted: toThousandths(typed[i.variantId] ?? '') ?? 0,
    }));
    const count: VanCount = { date: rep.businessDate ?? '', at: pos.now(), lines };
    await pos.local.set(VAN_COUNT_KEY, count);
    setSaved(count);
    setCounting(false);
    // The supervisor settles the day from this count: it goes at once when the server can be reached, else with the next sync
    void rep.sendVanCount();
  }

  if (counting) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">عُدّ ما على أرض السيارة واكتب العدد. لا ترى رصيد الدفتر حتى تحفظ الجرد.</Alert>
        <ul aria-label="جرد السيارة" className="flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={i.variantId}
              className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
            >
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{i.name}</span>
              <div className="w-24 shrink-0">
                <TextField
                  label="العدد"
                  inputMode="decimal"
                  dir="ltr"
                  value={typed[i.variantId] ?? ''}
                  onChange={(e) => setTyped((t) => ({ ...t, [i.variantId]: e.target.value.slice(0, 9) }))}
                  inputClassName="num"
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={() => void save()}>
            احفظ الجرد
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setCounting(false)}>
            إلغاء
          </Button>
        </div>
      </div>
    );
  }

  const diffs = saved ? countDifferences(saved) : [];
  return (
    <div className="flex flex-col gap-4">
      {saved ? (
        <section
          aria-label="جرد اليوم"
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
        >
          <h3 className="text-sm font-bold text-ink">جرد اليوم</h3>
          {diffs.length === 0 ? (
            <p className="text-sm font-semibold text-success-ink">مطابق للدفتر.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {diffs.map((l) => (
                <li key={l.variantId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <Badge tone={l.counted < l.system ? 'danger' : 'warning'}>
                    {l.counted < l.system ? 'ناقص' : 'زائد'}{' '}
                    <span className="num">{formatQuantity(Math.abs(l.counted - l.system))}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <Button variant="secondary" disabled={items.length === 0} onClick={() => setCounting(true)}>
        {saved ? 'أعد جرد السيارة' : 'جرد السيارة'}
      </Button>
      <TextField
        label="ابحث في السيارة"
        value={search}
        onChange={(e) => setSearch(e.target.value.slice(0, 60))}
        startAdornment={<SearchIcon className="ms-4 shrink-0" />}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={StockIcon}
          title="السيارة فارغة."
          description="يظهر هنا ما حُمّل على السيارة بعد أن يحمّلها المشرف ويصل ذلك إلى الجهاز."
        />
      ) : (
        <ul aria-label="مخزون السيارة" className="flex flex-col gap-2">
          {shown.map((i) => {
            const held = committed.get(i.variantId) ?? 0;
            return (
              <li
                key={i.variantId}
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{i.name}</span>
                {held > 0 ? (
                  <Badge tone="info">
                    محجوز <span className="num">{formatQuantity(held)}</span>
                  </Badge>
                ) : null}
                <span className="num text-base font-bold text-ink">{formatQuantity(i.stockQty ?? 0)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

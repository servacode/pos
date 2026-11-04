import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { BulkPriceResult, Category } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Button,
  DataTable,
  Money,
  SegmentedControl,
  Select,
  Switch,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { listCategories } from '../catalog/api';

type Row = BulkPriceResult['items'][number];

const ROUNDING = [1, 100, 500, 1000, 5000] as const;

const runBulk = (body: {
  categoryId: string;
  mode: 'move' | 'restore';
  percentBp: number;
  roundToMinor: number;
  markWas: boolean;
  apply: boolean;
}) => apiFetch<BulkPriceResult>('/v1/prices/bulk', { method: 'POST', body, auth: true });

/** «−30» or «15» (Arabic digits too) to basis points; null while unusable. */
export function percentOf(text: string): number | null {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.')
    .replace('−', '-')
    .replace('%', '')
    .replace('٪', '');
  const n = Number(clean);
  if (clean === '' || !Number.isFinite(n)) return null;
  const bp = Math.round(n * 100);
  return bp === 0 || bp < -9000 || bp > 20000 ? null : bp;
}

/**
 * «تغيير الأسعار» (03 › الألبسة: تنزيلات آخر الموسم): every piece of a category and its sub-
 * categories down or up by a percent, rounded, shown before it is applied; then the new labels.
 */
export function BulkPricesPage() {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const unit = 10 ** CURRENCIES[base].decimals;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [percent, setPercent] = useState('-30');
  const [round, setRound] = useState<(typeof ROUNDING)[number]>(500);
  const [mode, setMode] = useState<'move' | 'restore'>('move');
  const [markWas, setMarkWas] = useState(true);
  const [result, setResult] = useState<BulkPriceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCategories()
      .then((r) => setCategories(r.items.filter((c) => !c.archivedAt)))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  // Each category with its path, «رجالي › قمصان»
  const named = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const path = (c: Category): string => {
      const parts = [c.name];
      let at = c.parentId ? byId.get(c.parentId) : undefined;
      while (at && parts.length < 6) {
        parts.unshift(at.name);
        at = at.parentId ? byId.get(at.parentId) : undefined;
      }
      return parts.join(' › ');
    };
    return categories
      .map((c) => ({ id: c.id, name: path(c) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [categories]);

  const bp = percentOf(percent);
  async function run(apply: boolean) {
    if (!categoryId || (mode === 'move' && bp === null)) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await runBulk({
          categoryId,
          mode,
          percentBp: mode === 'move' ? bp! : 0,
          roundToMinor: round * unit,
          markWas,
          apply,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const changed = (result?.items ?? []).filter((i) => i.newMinor !== i.oldMinor);
  const columns: DataColumn<Row>[] = [
    { key: 'name', header: 'القطعة', cell: (r) => <span className="font-semibold">{r.name}</span> },
    {
      key: 'old',
      header: 'السعر الآن',
      numeric: true,
      cell: (r) => <Money minor={r.oldMinor} currency={r.currency} />,
    },
    {
      key: 'new',
      header: 'السعر الجديد',
      numeric: true,
      cell: (r) => <Money minor={r.newMinor} currency={r.currency} className="font-bold" />,
    },
    {
      key: 'was',
      header: 'مشطوباً على الملصق',
      numeric: true,
      cell: (r) =>
        r.wasMinor === null ? (
          '—'
        ) : (
          <s>
            <Money minor={r.wasMinor} currency={r.currency} />
          </s>
        ),
    },
  ];
  const labels = `/labels?products=${[...new Set(changed.map((i) => i.productId))].join(',')}`;

  return (
    <AppShell>
      <title>تغيير الأسعار · Serva POS</title>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink">تغيير الأسعار</h1>
          <p className="text-ink-muted">
            تنزيلات آخر الموسم أو رفع الأسعار: كل قطع التصنيف وتصنيفاته الفرعية بنسبة واحدة، مقرّبة، وتُعرض
            قبل تطبيقها.
          </p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <SegmentedControl
          label="العملية"
          value={mode}
          onValueChange={(m) => {
            setMode(m);
            setResult(null);
          }}
          options={[
            { value: 'move', label: 'تنزيل أو رفع بنسبة' },
            { value: 'restore', label: 'أنهِ التنزيل' },
          ]}
        />
        {mode === 'restore' ? (
          <p className="text-ink-muted">
            ترجع كل قطعة منزّلة في التصنيف إلى سعرها قبل التنزيل، ويختفي السعر المشطوب.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="التصنيف"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setResult(null);
            }}
          >
            <option value="">اختر التصنيف</option>
            {named.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {mode === 'move' ? (
            <TextField
              label="النسبة ٪"
              hint="بالسالب للتنزيل: −30"
              dir="ltr"
              inputMode="decimal"
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value.slice(0, 8));
                setResult(null);
              }}
              error={percent && bp === null ? 'من −90 إلى 200، غير الصفر' : undefined}
            />
          ) : null}
          {mode === 'move' ? (
            <Select
              label="التقريب"
              value={String(round)}
              onChange={(e) => {
                setRound(Number(e.target.value) as (typeof ROUNDING)[number]);
                setResult(null);
              }}
            >
              {ROUNDING.map((r) => (
                <option key={r} value={r}>
                  {r === 1 ? 'دون تقريب' : `لأقرب ${r.toLocaleString('en')}`}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        {mode === 'move' && bp !== null && bp < 0 ? (
          <Switch
            label="اطبع السعر القديم مشطوباً"
            description="يظهر السعر قبل التنزيل مشطوباً على الملصق وفي المتجر الإلكتروني."
            checked={markWas}
            onCheckedChange={(v) => {
              setMarkWas(v);
              setResult(null);
            }}
          />
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={!categoryId || (mode === 'move' && bp === null)}
            loading={busy && !result}
            onClick={() => void run(false)}
          >
            اعرض الأسعار الجديدة
          </Button>
          {result && !result.applied && changed.length > 0 ? (
            <Button loading={busy} onClick={() => void run(true)}>
              طبّق على {changed.length} قطعة
            </Button>
          ) : null}
        </div>
        {result?.applied ? (
          <Alert tone="success">
            تغيّرت أسعار {changed.length} قطعة، وتصل إلى أجهزة الكاشير مع أول اتصال.{' '}
            <Link to={labels} className="font-semibold underline">
              اطبع ملصقات الأسعار الجديدة
            </Link>
          </Alert>
        ) : null}
        {result ? (
          <DataTable
            caption={result.applied ? 'الأسعار بعد التغيير' : 'ما سيتغيّر'}
            columns={columns}
            rows={result.items}
            rowKey={(r) => r.variantId}
            empty="لا قطع في هذا التصنيف."
          />
        ) : null}
      </div>
    </AppShell>
  );
}

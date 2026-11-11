import { useEffect, useMemo, useState } from 'react';
import type { BulkPriceResult, Category } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  PercentIcon,
  PrintIcon,
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
import { ButtonLink } from './parts';

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
  // The page keeps its state below the shell, so typing never redraws the menu and the top bar.
  return (
    <AppShell>
      <BulkPrices />
    </AppShell>
  );
}

function BulkPrices() {
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
    {
      key: 'name',
      header: 'القطعة',
      cell: (r) => <span className="font-semibold whitespace-nowrap">{r.name}</span>,
    },
    {
      key: 'old',
      header: 'السعر الآن',
      numeric: true,
      cell: (r) => <Money minor={r.oldMinor} currency={r.currency} className="text-ink-muted" />,
    },
    {
      key: 'new',
      header: 'السعر الجديد',
      numeric: true,
      cell: (r) =>
        r.newMinor === r.oldMinor ? (
          <span className="inline-flex items-center gap-2">
            <Badge>دون تغيير</Badge>
            <Money minor={r.newMinor} currency={r.currency} />
          </span>
        ) : (
          <Money minor={r.newMinor} currency={r.currency} className="font-bold text-ink" />
        ),
    },
    {
      key: 'was',
      header: 'مشطوباً على الملصق',
      numeric: true,
      cell: (r) =>
        r.wasMinor === null ? (
          <span className="text-ink-subtle">—</span>
        ) : (
          <s className="text-ink-muted">
            <Money minor={r.wasMinor} currency={r.currency} />
          </s>
        ),
    },
  ];
  const labels = `/labels?products=${[...new Set(changed.map((i) => i.productId))].join(',')}`;
  const categoryName = named.find((c) => c.id === categoryId)?.name;
  const rule =
    mode === 'restore'
      ? 'إنهاء التنزيل'
      : bp === null
        ? ''
        : `${bp < 0 ? 'تنزيل' : 'رفع'} ${Math.abs(bp) / 100}٪${round === 1 ? '' : `، لأقرب ${round.toLocaleString('en')}`}`;

  return (
    <>
      <title>تغيير الأسعار · Serva POS</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<PercentIcon />}
          title="تغيير الأسعار"
          description="تنزيلات آخر الموسم أو رفع الأسعار: كل قطع التصنيف وتصنيفاته الفرعية بنسبة واحدة، مقرّبة، وتُعرض قبل تطبيقها."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="flex flex-col gap-5 xl:sticky xl:top-24">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-ink">ماذا يتغيّر؟</h2>
              <p className="text-sm text-ink-muted">
                اختر التصنيف والنسبة، ثم اعرض كل قطعة بسعرها قبل التطبيق.
              </p>
            </div>
            <SegmentedControl
              label="العملية"
              value={mode}
              fullWidth
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
              <p className="rounded-control bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                ترجع كل قطعة منزّلة في التصنيف إلى سعرها قبل التنزيل، ويختفي السعر المشطوب.
              </p>
            ) : null}
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
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="النسبة ٪"
                  hint={
                    <>
                      بالسالب للتنزيل:{' '}
                      <bdi dir="ltr" className="num">
                        −30
                      </bdi>
                    </>
                  }
                  dir="ltr"
                  inputMode="decimal"
                  value={percent}
                  onChange={(e) => {
                    setPercent(e.target.value.slice(0, 8));
                    setResult(null);
                  }}
                  // The numbers sit in their own direction isolate (LRI … PDI), so «−90» keeps its sign in front.
                  error={percent && bp === null ? 'من \u2066−90\u2069 إلى 200، غير الصفر' : undefined}
                />
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
              </div>
            ) : null}
            {mode === 'move' && bp !== null && bp < 0 ? (
              <div className="border-t border-line pt-4">
                <Switch
                  label="اطبع السعر القديم مشطوباً"
                  description="يظهر السعر قبل التنزيل مشطوباً على الملصق وفي المتجر الإلكتروني."
                  checked={markWas}
                  onCheckedChange={(v) => {
                    setMarkWas(v);
                    setResult(null);
                  }}
                />
              </div>
            ) : null}
            <Button
              variant="secondary"
              fullWidth
              disabled={!categoryId || (mode === 'move' && bp === null)}
              loading={busy && !result}
              onClick={() => void run(false)}
            >
              اعرض الأسعار الجديدة
            </Button>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            {result?.applied ? (
              <Alert tone="success">
                <span className="flex flex-col items-start gap-3">
                  <span>تغيّرت أسعار {changed.length} قطعة، وتصل إلى أجهزة الكاشير مع أول اتصال.</span>
                  <ButtonLink to={labels} icon={<PrintIcon />}>
                    اطبع ملصقات الأسعار الجديدة
                  </ButtonLink>
                </span>
              </Alert>
            ) : null}
            {result ? (
              <section aria-labelledby="bulk-preview" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id="bulk-preview" className="text-lg font-semibold text-ink">
                    {result.applied ? 'الأسعار بعد التغيير' : 'ما سيتغيّر'}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {categoryName ? <bdi>{categoryName}</bdi> : null}
                    {categoryName && rule ? ' · ' : null}
                    {rule}
                  </p>
                </div>
                <DataTable
                  caption={result.applied ? 'الأسعار بعد التغيير' : 'ما سيتغيّر'}
                  columns={columns}
                  rows={result.items}
                  rowKey={(r) => r.variantId}
                  empty={
                    <EmptyState
                      icon={PercentIcon}
                      title="لا قطع في هذا التصنيف."
                      description="اختر تصنيفاً آخر، أو تصنيفاً أعلى يضم تصنيفات فرعية."
                    />
                  }
                />
              </section>
            ) : (
              <EmptyState
                icon={PercentIcon}
                title="ترى هنا كل قطعة قبل أن تتغيّر."
                description="اختر التصنيف والنسبة، ثم «اعرض الأسعار الجديدة»: السعر الآن والسعر الجديد والمشطوب على الملصق، ولا يتغيّر شيء قبل أن تطبّق."
              />
            )}
            {result && !result.applied && changed.length > 0 ? (
              // The decision stays in reach under a long list.
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 ps-5 shadow-e3">
                <p className="text-sm text-ink-muted">
                  سيتغيّر سعر <bdi className="num font-semibold text-ink">{changed.length}</bdi> من{' '}
                  <bdi className="num font-semibold text-ink">{result.items.length}</bdi> قطعة
                  {rule ? ` · ${rule}` : ''}
                </p>
                <Button loading={busy} onClick={() => void run(true)} className="max-sm:flex-1">
                  طبّق على {changed.length} قطعة
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

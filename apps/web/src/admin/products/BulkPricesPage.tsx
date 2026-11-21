import { useEffect, useMemo, useState } from 'react';
import { CatalogGate } from './CatalogGate';
import type { BulkPriceResult, Category } from '@serva/core';
import { COUNT_NOUNS, countNoun } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  PercentIcon,
  PrintIcon,
  SegmentedControl,
  Select,
  Switch,
  TextField,
} from '@serva/ui';
import { Amt, PageTop, Panel, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { useMe } from '../../auth/useAuth';
import { storeSells } from '../../lib/sectors';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { listCategories } from '../catalog/api';
import { ButtonLink, PriceModes } from './parts';

type Item = BulkPriceResult['items'][number];
/** A line of the preview: one piece, or a whole model whose pieces all change the same way */
type Row = Item & { pieces?: number };

/** The words every name starts with: «قميص كتان» of «قميص كتان M أبيض» and «قميص كتان L أزرق» */
function commonStart(names: readonly string[]): string {
  const parts = names.map((n) => n.trim().split(/\s+/));
  const first = parts[0] ?? [];
  let n = 0;
  while (n < first.length && parts.every((w) => w[n] === first[n])) n += 1;
  return n === 0 ? (names[0] ?? '') : first.slice(0, n).join(' ');
}

/**
 * The preview grouped per model: the pieces of a model that all go from the same price to the same
 * price are one line with their count; a model whose pieces differ keeps a line for each piece.
 */
export function groupByModel(items: readonly Item[]): Row[] {
  const byProduct = new Map<string, Item[]>();
  for (const item of items) byProduct.set(item.productId, [...(byProduct.get(item.productId) ?? []), item]);
  const out: Row[] = [];
  for (const list of byProduct.values()) {
    const [head] = list;
    const same =
      head !== undefined &&
      list.length > 1 &&
      list.every(
        (i) =>
          i.oldMinor === head.oldMinor &&
          i.newMinor === head.newMinor &&
          i.wasMinor === head.wasMinor &&
          i.currency === head.currency,
      );
    if (same) out.push({ ...head, name: commonStart(list.map((i) => i.name)), pieces: list.length });
    else out.push(...list);
  }
  return out;
}

const ROUNDING = [1, 5, 10, 25, 50, 100, 500, 1000] as const;

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
      <CatalogGate>
        <BulkPrices />
      </CatalogGate>
    </AppShell>
  );
}

function BulkPrices() {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const unit = 10 ** CURRENCIES[base].decimals;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [percent, setPercent] = useState('');
  const [round, setRound] = useState<(typeof ROUNDING)[number]>(5);
  const [mode, setMode] = useState<'move' | 'restore'>('move');
  const [markWas, setMarkWas] = useState(true);
  const [result, setResult] = useState<BulkPriceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [undone, setUndone] = useState<{ restored: number; skipped: number } | null>(null);
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
    setUndone(null);
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

  async function undo() {
    if (!result?.changeId) return;
    setBusy(true);
    setError(null);
    try {
      setUndone(
        await apiFetch<{ restored: number; skipped: number }>(`/v1/prices/bulk/${result.changeId}/undo`, {
          method: 'POST',
          body: {},
          auth: true,
        }),
      );
      setResult(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const changed = (result?.items ?? []).filter((i) => i.newMinor !== i.oldMinor);
  const columns: SxColumn<Row>[] = [
    {
      key: 'name',
      header: 'القطعة',
      lead: true,
      cell: (r) => (
        <span className="font-semibold">
          {r.name}
          {r.pieces ? (
            <span className="font-normal text-ink-muted"> · {countNoun(r.pieces, COUNT_NOUNS.piece)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'old',
      header: 'السعر الآن',
      numeric: true,
      cell: (r) => <Amt minor={r.oldMinor} currency={r.currency} className="sx-mute" />,
    },
    {
      key: 'new',
      header: 'السعر الجديد',
      numeric: true,
      cell: (r) =>
        r.newMinor === r.oldMinor ? (
          <span className="inline-flex items-center gap-2">
            <StatusPill kind="ok">دون تغيير</StatusPill>
            <Amt minor={r.newMinor} currency={r.currency} />
          </span>
        ) : (
          <Amt minor={r.newMinor} currency={r.currency} className="font-bold" />
        ),
    },
    {
      key: 'was',
      header: 'مشطوباً على الملصق',
      numeric: true,
      cell: (r) =>
        r.wasMinor === null ? (
          <span className="sx-z sx-n">—</span>
        ) : (
          <s className="sx-mute">
            <Amt minor={r.wasMinor} currency={r.currency} />
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
      <title>تغيير الأسعار · SERVA</title>
      <SalesPage>
        <PageTop
          title="تغيير الأسعار"
          subtitle={`${storeSells(me.tenant.sectors, ['clothing']) ? 'تنزيلات آخر الموسم' : 'التنزيلات'} أو رفع الأسعار: كل قطع التصنيف وتصنيفاته الفرعية بنسبة واحدة، مقرّبة، وتُعرض قبل تطبيقها.`}
        />
        <PriceModes current="/prices" />
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Panel title="ماذا يتغيّر؟" aside="اختر التصنيف والنسبة ثم اعرض" className="xl:sticky xl:top-24">
            <div className="flex flex-col gap-5">
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
                    placeholder="مثال: −10"
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
              {!categoryId ? (
                <p className="text-sm text-ink-muted">اختر التصنيف أولاً ليظهر الزر.</p>
              ) : mode === 'move' && bp === null ? (
                <p className="text-sm text-danger-ink">اكتب نسبة صحيحة (غير الصفر) لتعرض الأسعار الجديدة.</p>
              ) : null}
            </div>
          </Panel>

          <div className="flex min-w-0 flex-col gap-4">
            {undone ? (
              <Alert tone="success">
                رجعت {countNoun(undone.restored, COUNT_NOUNS.piece)} إلى سعرها قبل التغيير
                {undone.skipped > 0
                  ? `، وتُركت ${countNoun(undone.skipped, COUNT_NOUNS.piece)} لأنها تعدّلت بعده.`
                  : '.'}
              </Alert>
            ) : null}
            {result?.applied ? (
              <Alert tone="success">
                <span className="flex flex-col items-start gap-3">
                  <span>
                    تغيّرت أسعار {countNoun(changed.length, COUNT_NOUNS.piece)}، وتصل إلى أجهزة الكاشير مع أول
                    اتصال.
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <ButtonLink to={labels} icon={<PrintIcon />}>
                      اطبع ملصقات الأسعار الجديدة
                    </ButtonLink>
                    {result.changeId ? (
                      <Button variant="secondary" loading={busy} onClick={() => void undo()}>
                        تراجع عن هذا التغيير
                      </Button>
                    ) : null}
                  </span>
                </span>
              </Alert>
            ) : null}
            {result ? (
              <Panel
                title={result.applied ? 'الأسعار بعد التغيير' : 'ما سيتغيّر'}
                aside={
                  <>
                    {categoryName ? <bdi>{categoryName}</bdi> : null}
                    {categoryName && rule ? ' · ' : null}
                    {rule}
                  </>
                }
                flush
              >
                <SxTable
                  bare
                  caption={result.applied ? 'الأسعار بعد التغيير' : 'ما سيتغيّر'}
                  columns={columns}
                  rows={groupByModel(result.items)}
                  rowKey={(r) => r.variantId}
                  empty={
                    <EmptyState
                      icon={PercentIcon}
                      title="لا قطع في هذا التصنيف."
                      description="اختر تصنيفاً آخر، أو تصنيفاً أعلى يضم تصنيفات فرعية."
                    />
                  }
                />
              </Panel>
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
                  <bdi className="num font-semibold text-ink">
                    {countNoun(result.items.length, COUNT_NOUNS.piece)}
                  </bdi>
                  {rule ? ` · ${rule}` : ''}
                </p>
                <Button loading={busy} onClick={() => setConfirming(true)} className="max-sm:flex-1">
                  طبّق على {countNoun(changed.length, COUNT_NOUNS.piece, String(changed.length), true)}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {confirming && result ? (
          <Dialog
            open
            onOpenChange={(open) => !open && setConfirming(false)}
            title="تأكيد تغيير الأسعار"
            description={`ستتغيّر أسعار ${countNoun(changed.length, COUNT_NOUNS.piece)}${rule ? ` (${rule})` : ''} وتصل إلى كل أجهزة الكاشير. لا يوجد زر تراجع تلقائي؛ للعودة استخدم «أنهِ التنزيل» أو سجل الأسعار.`}
            actions={
              <>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  رجوع
                </Button>
                <Button
                  loading={busy}
                  onClick={() => {
                    setConfirming(false);
                    void run(true);
                  }}
                >
                  نعم، طبّق التغيير
                </Button>
              </>
            }
          >
            <p className="text-sm text-ink-muted">راجع جدول «ما سيتغيّر» قبل أن تؤكد.</p>
          </Dialog>
        ) : null}
      </SalesPage>
    </>
  );
}

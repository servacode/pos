import { useMemo, useState } from 'react';
import {
  PRICE_LIST_CHUNK_MAX,
  PRICE_LIST_FIELDS,
  type PriceListApplied,
  type PriceListField,
  type PriceListItem,
} from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  PercentIcon,
  PrintIcon,
  ProgressBar,
  Select,
  Switch,
  Tabs,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { FileProblem, readSpreadsheet, type FileCell, type Sheet } from '../import/file';
import {
  columnsReady,
  detectHeaderRow,
  group,
  guessColumns,
  queueLabels,
  rowsOf,
  STATUS_WORDS,
  tableAt,
  NO_COLUMNS,
  type Columns,
} from './priceList';
import { applyPriceList, previewPriceList } from './priceListApi';
import { ButtonLink } from './parts';

/** A row matched by a barcode of one variant of a model that has other sizes or colours. */
function multiVariantByBarcode(i: PriceListItem): boolean {
  return i.matchedBy === 'barcode' && (i.modelSize ?? 1) > 1 && i.variantId !== null;
}

/** True when the file has one row for each model it names (the usual model price list). */
function oneRowPerModel(items: readonly PriceListItem[]): boolean {
  const rows = items.filter(multiVariantByBarcode);
  return rows.length > 0 && new Set(rows.map((i) => i.productId)).size === rows.length;
}

/** Rows of a table shown at once; «اعرض المزيد» adds the next ones, so 3,000 rows stay light. */
const PAGE = 200;

type Step = 'file' | 'columns' | 'preview' | 'done';
type Tab = 'change' | 'same' | 'rest';

/**
 * «تحديث الأسعار من ملف» (03 › الصيدلية: نشرة أسعار الوزارة): a price list from the warehouse or the
 * ministry is read in the browser, its columns are mapped, each row is matched to a piece, and the
 * owner sees the old and the new price before one press applies the chosen ones.
 */
export function PriceListPage() {
  return (
    <AppShell>
      <PriceList />
    </AppShell>
  );
}

function PriceList() {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const decimals = CURRENCIES[base].decimals;
  const [step, setStep] = useState<Step>('file');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<Columns>(NO_COLUMNS);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [invalid, setInvalid] = useState<number[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [applied, setApplied] = useState<PriceListApplied | null>(null);
  const [tab, setTab] = useState<Tab>('change');
  const [shown, setShown] = useState(PAGE);
  // «طبّق على كل قياسات وألوان هذا الموديل»
  const [wholeModel, setWholeModel] = useState(false);

  const sheet = sheets[sheetIndex];
  const table = useMemo(() => (sheet ? tableAt(sheet.rows, headerRow) : null), [sheet, headerRow]);

  function openSheet(next: Sheet, index: number) {
    const at = detectHeaderRow(next.rows);
    setSheetIndex(index);
    setHeaderRow(at);
    setColumns(guessColumns(tableAt(next.rows, at).headers));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const read = await readSpreadsheet(file);
      setFileName(file.name);
      setSheets(read);
      openSheet(read[0]!, 0);
      setStep('columns');
    } catch (e) {
      setError(e instanceof FileProblem ? e.message : errorMessage(e));
    } finally {
      setReading(false);
    }
  }

  function restart() {
    setStep('file');
    setSheets([]);
    setItems([]);
    setInvalid([]);
    setPicked(new Set());
    setApplied(null);
    setError(null);
    setTab('change');
    setShown(PAGE);
  }

  /** Sends the rows in requests of at most PRICE_LIST_CHUNK_MAX and gathers the matches. */
  async function check() {
    if (!table) return;
    setError(null);
    setBusy(true);
    const { rows, invalid: bad } = rowsOf(table, columns, decimals, headerRow);
    setProgress({ done: 0, total: rows.length });
    try {
      const all: PriceListItem[] = [];
      for (let at = 0; at < rows.length; at += PRICE_LIST_CHUNK_MAX) {
        const answer = await previewPriceList(rows.slice(at, at + PRICE_LIST_CHUNK_MAX));
        all.push(...answer.items);
        setProgress({ done: Math.min(at + PRICE_LIST_CHUNK_MAX, rows.length), total: rows.length });
      }
      // A piece repeated across requests: the first row counts
      const seen = new Set<string>();
      const checked = all
        .sort((a, b) => a.row - b.row)
        .map((i) => {
          if (!i.variantId || i.status === 'duplicate') return i;
          if (seen.has(i.variantId)) return { ...i, status: 'duplicate' as const };
          seen.add(i.variantId);
          return i;
        });
      setItems(checked);
      setInvalid(bad);
      setPicked(new Set(checked.filter((i) => i.status === 'change').map((i) => i.variantId!)));
      setWholeModel(oneRowPerModel(checked));
      setTab('change');
      setShown(PAGE);
      setStep('preview');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => group(items), [items]);
  const modelRows = useMemo(() => items.filter(multiVariantByBarcode).length, [items]);

  async function apply() {
    const changes = [
      ...groups.change.filter((i) => picked.has(i.variantId!)),
      // A row already at the price still carries it to the model's other sizes and colours
      ...(wholeModel ? groups.same.filter(multiVariantByBarcode) : []),
    ].map((i) => ({
      variantId: i.variantId!,
      newMinor: i.newMinor,
      ...(wholeModel && multiVariantByBarcode(i) ? { wholeModel: true } : {}),
    }));
    if (changes.length === 0) return;
    setError(null);
    setBusy(true);
    setProgress({ done: 0, total: changes.length });
    const total: PriceListApplied = { changed: 0, skipped: 0, items: [] };
    try {
      for (let at = 0; at < changes.length; at += PRICE_LIST_CHUNK_MAX) {
        const answer = await applyPriceList(fileName, changes.slice(at, at + PRICE_LIST_CHUNK_MAX));
        total.changed += answer.changed;
        total.skipped += answer.skipped;
        total.items.push(...answer.items);
        setProgress({ done: Math.min(at + PRICE_LIST_CHUNK_MAX, changes.length), total: changes.length });
      }
      setApplied(total);
      setStep('done');
    } catch (e) {
      // Chunks that went through stay applied: say so, and let the owner check the file again
      setError(
        total.changed > 0
          ? `تغيّر سعر ${String(total.changed)} صنفاً ثم توقّف التحديث. ${errorMessage(e)} افحص الملف من جديد لترى ما بقي.`
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  const toggle = (variantId: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(variantId)) next.add(variantId);
      return next;
    });
  const allPicked = groups.change.length > 0 && groups.change.every((i) => picked.has(i.variantId!));

  const nameCell = (r: PriceListItem) => (
    <span className="font-semibold">
      <bdi>{r.name ?? r.source}</bdi>
    </span>
  );
  const rowCell = (r: PriceListItem) => <bdi className="num text-ink-muted">{r.row}</bdi>;
  const oldCell = (r: PriceListItem) =>
    r.oldMinor === null || r.currency === null ? (
      <span className="text-ink-subtle">—</span>
    ) : (
      <Money minor={r.oldMinor} currency={r.currency} className="text-ink-muted" />
    );
  const newCell = (r: PriceListItem) => <Money minor={r.newMinor} currency={r.currency ?? base} />;

  const changeColumns: DataColumn<PriceListItem>[] = [
    {
      key: 'pick',
      header: (
        <Checkbox
          label={<span className="sr-only">اختر الكل</span>}
          checked={allPicked}
          indeterminate={!allPicked && picked.size > 0}
          onChange={() => setPicked(allPicked ? new Set() : new Set(groups.change.map((i) => i.variantId!)))}
        />
      ),
      cell: (r) => (
        <Checkbox
          label={<span className="sr-only">{r.name}</span>}
          checked={picked.has(r.variantId!)}
          onChange={() => toggle(r.variantId!)}
        />
      ),
    },
    { key: 'row', header: 'الصف', numeric: true, cell: rowCell },
    { key: 'name', header: 'الصنف', cell: nameCell },
    { key: 'old', header: 'السعر الآن', numeric: true, cell: oldCell },
    {
      key: 'new',
      header: 'السعر الجديد',
      numeric: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <Badge tone={r.newMinor > r.oldMinor! ? 'warning' : 'success'}>
            {r.newMinor > r.oldMinor! ? 'ارتفع' : 'نزل'}
          </Badge>
          <Money minor={r.newMinor} currency={r.currency ?? base} className="font-bold text-ink" />
        </span>
      ),
    },
  ];
  const sameColumns: DataColumn<PriceListItem>[] = [
    { key: 'row', header: 'الصف', numeric: true, cell: rowCell },
    { key: 'name', header: 'الصنف', cell: nameCell },
    { key: 'price', header: 'السعر', numeric: true, cell: newCell },
  ];
  const restColumns: DataColumn<PriceListItem>[] = [
    { key: 'row', header: 'الصف', numeric: true, cell: rowCell },
    { key: 'name', header: 'في الملف', cell: nameCell },
    { key: 'new', header: 'السعر في الملف', numeric: true, cell: newCell },
    {
      key: 'why',
      header: 'السبب',
      cell: (r) => (
        <span className="text-ink-muted">{STATUS_WORDS[r.status as keyof typeof STATUS_WORDS]}</span>
      ),
    },
  ];

  function list(rows: PriceListItem[], cols: DataColumn<PriceListItem>[], caption: string, empty: string) {
    return (
      <div className="flex flex-col gap-3">
        <DataTable
          caption={caption}
          columns={cols}
          rows={rows.slice(0, shown)}
          rowKey={(r) => r.row}
          empty={<EmptyState icon={PercentIcon} title={empty} />}
        />
        {rows.length > shown ? (
          <Button variant="secondary" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
            اعرض المزيد ({rows.length - shown})
          </Button>
        ) : null}
      </div>
    );
  }

  const setColumn = (field: PriceListField, value: string) =>
    setColumns((c) => ({ ...c, [field]: value === '' ? null : Number(value) }));
  const sampleOf = (cells: FileCell[] | undefined, index: number) => String(cells?.[index] ?? '');

  return (
    <>
      <title>تحديث الأسعار من ملف · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<PercentIcon />}
          title="تحديث الأسعار من ملف"
          description="ارفع نشرة الأسعار من المستودع أو الوزارة: نطابق كل صف مع صنفك بالباركود ثم بالاسم، وترى السعر القديم والجديد قبل أن يتغيّر شيء."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 'file' ? (
          <Card className="flex flex-col gap-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-line-control/60 px-6 py-10 text-center hover:bg-surface-muted">
              <span className="font-semibold text-ink">اختر ملف Excel (xlsx) أو CSV</span>
              <span className="text-sm text-ink-muted">
                عمود للسعر، وعمود للباركود أو لاسم الصنف (أو لاسمه العلمي)
              </span>
              <input
                type="file"
                className="sr-only"
                accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="ملف الأسعار"
                disabled={reading}
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {reading ? <span className="text-sm text-ink-muted">نقرأ الملف…</span> : null}
            </label>
          </Card>
        ) : null}

        {step === 'columns' && table && sheet ? (
          <Card className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">أعمدة الملف</h2>
              <p className="text-sm text-ink-muted">
                <bdi>{fileName}</bdi> · <bdi className="num">{table.body.length}</bdi> صف. خمّنّا الأعمدة من
                عناوينها، صحّح ما يلزم. الأسعار بعملة المتجر.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sheets.length > 1 ? (
                <Select
                  label="الورقة"
                  value={String(sheetIndex)}
                  onChange={(e) => openSheet(sheets[Number(e.target.value)]!, Number(e.target.value))}
                >
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select
                label="صف العناوين"
                value={String(headerRow)}
                onChange={(e) => {
                  const at = Number(e.target.value);
                  setHeaderRow(at);
                  setColumns(guessColumns(tableAt(sheet.rows, at).headers));
                }}
              >
                {sheet.rows.slice(0, 10).map((r, i) => (
                  <option key={String(i)} value={i}>
                    {`${String(i + 1)} · ${r.slice(0, 3).join(' | ')}`}
                  </option>
                ))}
              </Select>
              {PRICE_LIST_FIELDS.map((f) => (
                <Select
                  key={f.key}
                  label={f.key === 'price' ? 'عمود السعر الجديد' : `عمود ${f.label}`}
                  value={columns[f.key] === null ? '' : String(columns[f.key])}
                  onChange={(e) => setColumn(f.key, e.target.value)}
                >
                  <option value="">{f.key === 'price' ? 'اختر العمود' : 'لا يوجد'}</option>
                  {table.headers.map((h, i) => (
                    <option key={`${h}-${String(i)}`} value={i}>
                      {`${h} · ${sampleOf(table.body[0], i)}`}
                    </option>
                  ))}
                </Select>
              ))}
            </div>
            {!columnsReady(columns) ? (
              <p className="text-sm text-ink-muted">اختر عمود السعر، وعمود الباركود أو الاسم على الأقل.</p>
            ) : null}
            {busy ? (
              <ProgressBar value={progress.done} max={Math.max(1, progress.total)} label="نطابق الصفوف" />
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              <Button variant="ghost" onClick={restart}>
                ملف آخر
              </Button>
              <Button disabled={!columnsReady(columns)} loading={busy} onClick={() => void check()}>
                طابق الصفوف
              </Button>
            </div>
          </Card>
        ) : null}

        {step === 'preview' ? (
          <div className="flex flex-col gap-4">
            {invalid.length > 0 ? (
              <Alert tone="warning">
                {invalid.length} صفاً بلا سعر صالح أو بلا باركود واسم لم نرسلها
                {`: الصفوف ${invalid.slice(0, 8).join('، ')}${invalid.length > 8 ? '…' : ''}`}.
              </Alert>
            ) : null}
            {modelRows > 0 ? (
              <Switch
                label="طبّق على كل قياسات وألوان هذا الموديل"
                description={`${String(modelRows)} صفاً طابق باركود قياس واحد من موديل له قياسات وألوان أخرى. عند التفعيل يأخذ كل قياس ولون الموديل السعر نفسه.`}
                checked={wholeModel}
                onCheckedChange={setWholeModel}
              />
            ) : null}
            <Tabs
              label="نتيجة المطابقة"
              variant="pill"
              value={tab}
              onValueChange={(t) => {
                setTab(t);
                setShown(PAGE);
              }}
              items={[
                {
                  value: 'change',
                  label: 'ستتغيّر',
                  count: groups.change.length,
                  content: list(
                    groups.change,
                    changeColumns,
                    'الأصناف التي ستتغيّر أسعارها',
                    'لا سعر تغيّر في هذا الملف.',
                  ),
                },
                {
                  value: 'same',
                  label: 'دون تغيير',
                  count: groups.same.length,
                  content: list(groups.same, sameColumns, 'أصناف سعرها كما هو', 'لا صنف بسعر مطابق.'),
                },
                {
                  value: 'rest',
                  label: 'غير مطابقة',
                  count: groups.rest.length,
                  content: list(
                    groups.rest,
                    restColumns,
                    'صفوف لم نجد لها صنفاً',
                    'كل الصفوف وجدنا لها صنفاً.',
                  ),
                },
              ]}
            />
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 ps-5 shadow-e3">
              <p className="text-sm text-ink-muted">
                سيتغيّر سعر <bdi className="num font-semibold text-ink">{picked.size}</bdi> من{' '}
                <bdi className="num font-semibold text-ink">{groups.change.length}</bdi> صنفاً
              </p>
              {busy ? (
                <ProgressBar value={progress.done} max={Math.max(1, progress.total)} label="نحدّث الأسعار" />
              ) : null}
              <div className="flex gap-2 max-sm:w-full">
                <Button variant="ghost" onClick={restart}>
                  ملف آخر
                </Button>
                <Button
                  disabled={picked.size === 0}
                  loading={busy}
                  onClick={() => void apply()}
                  className="max-sm:flex-1"
                >
                  طبّق على {picked.size} صنفاً
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'done' && applied ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">
              تغيّر سعر {applied.changed} صنفاً، وتصل الأسعار الجديدة إلى أجهزة الكاشير مع أول اتصال، وسُجّل
              كل تغيير في سجل التدقيق.
              {applied.skipped > 0 ? ` ${String(applied.skipped)} بقيت كما هي لأن سعرها لم يعد يختلف.` : ''}
            </Alert>
            <section aria-labelledby="price-list-labels" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="price-list-labels" className="text-lg font-semibold text-ink">
                  تغيّر سعرها: اطبع ملصقاتها
                </h2>
                {applied.items.length > 0 ? (
                  <ButtonLink
                    to="/labels?queue=1"
                    icon={<PrintIcon />}
                    onClick={() => queueLabels(applied.items.map((i) => i.productId))}
                  >
                    اطبع ملصقات الأسعار الجديدة
                  </ButtonLink>
                ) : null}
              </div>
              {list(
                applied.items.map((i, n) => ({
                  row: n + 1,
                  status: 'change' as const,
                  source: '',
                  matchedBy: null,
                  productId: i.productId,
                  variantId: i.variantId,
                  name: i.name,
                  currency: i.currency,
                  oldMinor: i.oldMinor,
                  newMinor: i.newMinor,
                })),
                [
                  { key: 'name', header: 'الصنف', cell: nameCell },
                  { key: 'old', header: 'السعر قبل', numeric: true, cell: oldCell },
                  { key: 'new', header: 'السعر الآن', numeric: true, cell: newCell },
                ],
                'الأصناف التي تغيّر سعرها',
                'لم يتغيّر شيء.',
              )}
            </section>
            <div>
              <Button variant="secondary" onClick={restart}>
                ملف آخر
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

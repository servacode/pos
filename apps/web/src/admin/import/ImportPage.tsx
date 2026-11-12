import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  IMPORT_FIELDS,
  IMPORT_TYPES,
  IMPORT_TYPE_LABELS,
  emptyImportTotals,
  type ImportRowResult,
  type ImportTotals,
  type ImportType,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PackageOpenIcon,
  PageHeader,
  ProgressBar,
  SegmentedControl,
  Select,
  StatTile,
  TextField,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { downloadText } from '../accounting/csv';
import { postImport } from './api';
import { FileProblem, readSpreadsheet, type Sheet } from './file';
import {
  assign,
  chunkRows,
  initialMapping,
  missingRequired,
  prepareRows,
  reportCsv,
  saveMapping,
  statusWord,
  tableOf,
  targetsOf,
  templateCsv,
  templateName,
  type Mapping,
  type PreparedRow,
  type ReportRow,
  type Table,
} from './mapping';

type Step = 'file' | 'columns' | 'review';
type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'file', label: '١. الملف' },
  { key: 'columns', label: '٢. الأعمدة' },
  { key: 'review', label: '٣. المراجعة والاستيراد' },
];

const TONE: Record<ImportRowResult['status'], BadgeTone> = {
  create: 'success',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
};

const SHOWN_ROWS = 300;
const todayText = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** «استيراد البيانات»: products, customers or suppliers from an Excel or CSV file, checked before it is applied. */
export function ImportPage() {
  // The page keeps its state below the shell, so typing never redraws the menu and the top bar.
  return (
    <AppShell>
      <Import />
    </AppShell>
  );
}

function Import() {
  const me = useMe();
  const [params] = useSearchParams();
  const allowed = IMPORT_TYPES.filter((t) =>
    t === 'products'
      ? me.user.permissions.includes('catalog.manage')
      : t === 'customers'
        ? me.user.permissions.includes('customers.manage')
        : me.user.permissions.includes('purchases.manage'),
  );
  const asked = params.get('type');
  const [type, setType] = useState<ImportType>(allowed.find((t) => t === asked) ?? allowed[0] ?? 'products');
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [table, setTable] = useState<Table>({ headers: [], body: [] });
  const [mapping, setMapping] = useState<Mapping>([]);
  const [existing, setExisting] = useState<'skip' | 'update'>('skip');
  const [date, setDate] = useState(todayText);
  const [branchId, setBranchId] = useState(me.branches[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<number, ImportRowResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const cancel = useRef(false);

  const branches = me.branches.map((b) => ({ id: b.id, name: b.name }));
  const targets = useMemo(() => targetsOf(type, branches), [type, me.branches]); // eslint-disable-line react-hooks/exhaustive-deps
  const prepared = useMemo(() => prepareRows(type, table, mapping), [type, table, mapping]);
  const byLine = useMemo(() => new Map(prepared.map((r) => [r.line, r])), [prepared]);
  const missing = missingRequired(type, mapping);
  const busy = phase === 'checking' || phase === 'importing';

  const totals: ImportTotals = useMemo(() => {
    const t = emptyImportTotals();
    for (const r of results.values()) t[r.status] += 1;
    return t;
  }, [results]);

  if (allowed.length === 0) {
    return (
      <Alert tone="info">
        استيراد البيانات للمالك والمدير: تحتاج صلاحية المنتجات أو الزبائن أو المشتريات.
      </Alert>
    );
  }

  const reset = (next: ImportType = type) => {
    setType(next);
    setStep('file');
    setFileName('');
    setSheets([]);
    setTable({ headers: [], body: [] });
    setMapping([]);
    setResults(new Map());
    setPhase('idle');
    setError(null);
  };

  const openSheet = (sheet: Sheet, index: number) => {
    const t = tableOf(sheet.rows);
    setSheetIndex(index);
    setTable(t);
    setMapping(initialMapping(type, t.headers, branches));
    setResults(new Map());
    setPhase('idle');
  };

  const onFile = async (file: File | undefined) => {
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
  };

  const duplicates = (rows: readonly PreparedRow[]): Map<number, ImportRowResult> =>
    new Map(
      rows
        .filter((r) => r.duplicateOf !== undefined)
        .map((r) => [
          r.line,
          {
            line: r.line,
            status: 'skip' as const,
            errors: [],
            notes: [`مكرر في الملف: سبق في السطر ${String(r.duplicateOf)}`],
          },
        ]),
    );

  /** Sends the file in chunks, dry or real; the answers fill the table as they come. */
  const send = async (mode: 'dry_run' | 'commit') => {
    cancel.current = false;
    setError(null);
    setPhase(mode === 'dry_run' ? 'checking' : 'importing');
    const next = mode === 'dry_run' ? duplicates(prepared) : new Map(results);
    if (mode === 'dry_run') setResults(next);
    const toSend = prepared.filter((r) => r.duplicateOf === undefined);
    const chunks = chunkRows(type, toSend);
    setProgress({ done: 0, total: toSend.length });
    let done = 0;
    try {
      for (const chunk of chunks) {
        if (cancel.current) break;
        const answer = await postImport({
          type,
          mode,
          existing,
          date,
          ...(type === 'products' && branchId ? { branchId } : {}),
          rows: chunk.map(({ line, values }) => ({ line, values })),
        });
        for (const r of answer.results) next.set(r.line, r);
        done += chunk.length;
        setResults(new Map(next));
        setProgress({ done, total: toSend.length });
      }
      if (cancel.current) {
        setPhase(mode === 'dry_run' ? 'idle' : 'done');
        return;
      }
      setPhase(mode === 'dry_run' ? 'checked' : 'done');
    } catch (e) {
      setError(errorMessage(e));
      setPhase(mode === 'dry_run' ? 'idle' : 'done');
    }
  };

  const reportRows = (): ReportRow[] =>
    [...results.values()]
      .filter((r) => r.status === 'error' || r.notes.some((n) => n.startsWith('مكرر في الملف')))
      .sort((a, b) => a.line - b.line)
      .flatMap((r) =>
        r.status === 'error'
          ? r.errors.map((e) => ({
              line: r.line,
              status: statusWord('error'),
              field: e.field,
              message: e.message,
            }))
          : [{ line: r.line, status: statusWord('skip'), field: '_', message: r.notes.join('، ') }],
      );

  const chosen = IMPORT_FIELDS[type];
  const finished = phase === 'done';
  const sheetPick = sheets.length > 1;
  const nameOf = (line: number) => String(byLine.get(line)?.values.name ?? '—');
  const shown = [...results.values()]
    .filter((r) => (totals.error > 0 && !finished ? r.status === 'error' : true))
    .sort((a, b) => a.line - b.line)
    .slice(0, SHOWN_ROWS);
  const columns: DataColumn<ImportRowResult>[] = [
    { key: 'line', header: 'السطر', numeric: true, cell: (r) => <bdi className="num">{r.line}</bdi> },
    { key: 'name', header: 'الاسم', cell: (r) => <bdi>{nameOf(r.line)}</bdi> },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => <Badge tone={TONE[r.status]}>{statusWord(r.status)}</Badge>,
    },
    {
      key: 'why',
      header: 'التفاصيل',
      cell: (r) => (
        <span className="text-sm text-ink-muted">
          {r.errors.length > 0
            ? r.errors
                .map(
                  (e) =>
                    `${chosen.find((f) => f.key === e.field)?.label ?? ''}${chosen.some((f) => f.key === e.field) ? ': ' : ''}${e.message}`,
                )
                .join('، ')
            : r.notes.join('، ')}
        </span>
      ),
    },
  ];

  return (
    <>
      <title>استيراد البيانات · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          icon={<PackageOpenIcon />}
          title="استيراد البيانات"
          description="انقل المنتجات والزبائن والموردين من ملف Excel أو CSV. يُفحص الملف كله قبل أن يتغيّر شيء."
        />
        <ol className="flex flex-wrap gap-2" aria-label="خطوات الاستيراد">
          {STEPS.map((s) => (
            <li key={s.key}>
              <Badge tone={s.key === step ? 'brand' : 'neutral'} dot={false}>
                <span aria-current={s.key === step ? 'step' : undefined}>{s.label}</span>
              </Badge>
            </li>
          ))}
        </ol>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 'file' ? (
          <Card className="flex flex-col gap-5">
            <SegmentedControl
              label="ماذا تستورد؟"
              value={type}
              options={allowed.map((t) => ({ value: t, label: IMPORT_TYPE_LABELS[t] }))}
              onValueChange={(t) => reset(t)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => downloadText(templateName(type), templateCsv(type))}>
                نزّل القالب الجاهز
              </Button>
              <p className="text-sm text-ink-muted">
                أعمدة {IMPORT_TYPE_LABELS[type]}: {chosen.map((f) => f.label).join('، ')}.
              </p>
            </div>
            <ul className="list-disc ps-5 text-sm text-ink-muted">
              {chosen
                .filter((f) => f.hint)
                .slice(0, 6)
                .map((f) => (
                  <li key={f.key}>
                    <b className="text-ink">{f.label}:</b> {f.hint}
                  </li>
                ))}
            </ul>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-line-control/60 px-6 py-10 text-center hover:bg-surface-muted">
              <span className="font-semibold text-ink">اختر ملف Excel (xlsx) أو CSV</span>
              <span className="text-sm text-ink-muted">حتى 15 ميغابايت و20 ألف صف</span>
              <input
                type="file"
                className="sr-only"
                accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="ملف الاستيراد"
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

        {step === 'columns' ? (
          <Card className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">أعمدة الملف</h2>
                <p className="text-sm text-ink-muted">
                  <bdi>{fileName}</bdi> · <bdi className="num">{table.body.length}</bdi> صف. خمّنّا الأعمدة من
                  عناوينها، صحّح ما يلزم.
                </p>
              </div>
              {sheetPick ? (
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
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">ربط أعمدة الملف بحقول {IMPORT_TYPE_LABELS[type]}</caption>
                <thead>
                  <tr className="text-start text-ink-muted">
                    <th className="p-2 text-start font-medium">عمود في الملف</th>
                    <th className="p-2 text-start font-medium">أمثلة</th>
                    <th className="p-2 text-start font-medium">الحقل في سيرفا</th>
                  </tr>
                </thead>
                <tbody>
                  {table.headers.map((header, i) => (
                    <tr key={`${header}-${String(i)}`} className="border-t border-line align-middle">
                      <td className="p-2 font-semibold text-ink">
                        <bdi>{header}</bdi>
                      </td>
                      <td className="max-w-[16rem] truncate p-2 text-ink-muted">
                        <bdi>
                          {table.body
                            .map((r) => r[i])
                            .filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
                            .slice(0, 3)
                            .join(' · ')}
                        </bdi>
                      </td>
                      <td className="p-2">
                        <Select
                          label={`حقل العمود ${header}`}
                          hideLabel
                          value={mapping[i] ?? ''}
                          onChange={(e) => setMapping(assign(mapping, i, e.target.value || null))}
                        >
                          <option value="">لا تستورد هذا العمود</option>
                          {targets.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                              {t.required ? ' (مطلوب)' : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 ? (
              <Alert tone="warning">اربط الحقول المطلوبة: {missing.join('، ')}.</Alert>
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              <Button variant="ghost" onClick={() => reset()}>
                غيّر الملف
              </Button>
              <Button
                disabled={missing.length > 0 || prepared.length === 0}
                onClick={() => {
                  saveMapping(type, table.headers, mapping);
                  setResults(new Map());
                  setPhase('idle');
                  setStep('review');
                }}
              >
                التالي: راجع الملف
              </Button>
            </div>
          </Card>
        ) : null}

        {step === 'review' ? (
          <>
            <Card className="flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">خيارات الاستيراد</h2>
                <p className="text-sm text-ink-muted">
                  <bdi className="num">{prepared.length}</bdi> صف جاهز. اضغط «افحص الملف» لترى ما سيحدث دون أن
                  يتغيّر شيء.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SegmentedControl
                  label="إن كان السجل موجوداً"
                  value={existing}
                  options={[
                    { value: 'skip', label: 'أضف الجديد فقط' },
                    { value: 'update', label: 'حدّث الموجود أيضاً' },
                  ]}
                  onValueChange={(v) => {
                    setExisting(v);
                    setPhase('idle');
                    setResults(new Map());
                  }}
                />
                <TextField
                  label="تاريخ الأرصدة الافتتاحية"
                  type="date"
                  dir="ltr"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPhase('idle');
                    setResults(new Map());
                  }}
                />
                {type === 'products' && me.branches.length > 1 ? (
                  <Select
                    label="فرع الكمية الافتتاحية"
                    value={branchId}
                    onChange={(e) => {
                      setBranchId(e.target.value);
                      setPhase('idle');
                      setResults(new Map());
                    }}
                  >
                    {me.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <Button variant="ghost" disabled={busy} onClick={() => setStep('columns')}>
                  رجوع إلى الأعمدة
                </Button>
                <Button
                  loading={phase === 'checking'}
                  disabled={busy || finished}
                  onClick={() => void send('dry_run')}
                >
                  افحص الملف
                </Button>
              </div>
            </Card>

            {busy ? (
              <Card className="flex flex-col gap-3">
                <ProgressBar
                  label={phase === 'checking' ? 'فحص الملف' : 'استيراد الملف'}
                  value={progress.done}
                  max={Math.max(progress.total, 1)}
                  valueText={`${String(progress.done)} من ${String(progress.total)} صف`}
                />
                <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
                  <span>
                    {phase === 'checking' ? 'نفحص' : 'نستورد'} <bdi className="num">{progress.done}</bdi> من{' '}
                    <bdi className="num">{progress.total}</bdi> صف
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => (cancel.current = true)}>
                    أوقف
                  </Button>
                </div>
              </Card>
            ) : null}

            {results.size > 0 ? (
              <section aria-labelledby="import-result" className="flex flex-col gap-4">
                <h2 id="import-result" className="text-lg font-semibold text-ink">
                  {finished
                    ? 'نتيجة الاستيراد'
                    : phase === 'checked'
                      ? 'ما سيحدث عند الاستيراد'
                      : 'نتيجة الفحص'}
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile
                    label={finished ? 'أُضيف' : 'جديد'}
                    value={<bdi className="num">{totals.create}</bdi>}
                  />
                  <StatTile
                    label={finished ? 'حُدّث' : 'يُحدَّث'}
                    value={<bdi className="num">{totals.update}</bdi>}
                  />
                  <StatTile label="تُرك" value={<bdi className="num">{totals.skip}</bdi>} />
                  <StatTile label="فيه خطأ" value={<bdi className="num">{totals.error}</bdi>} />
                </div>
                {totals.error > 0 ? (
                  <Alert tone="warning">
                    <span className="flex flex-wrap items-center gap-3">
                      <span>
                        {finished ? 'لم يُستورد' : 'لن يُستورد'} <bdi className="num">{totals.error}</bdi> صف
                        لأخطاء فيها. صحّحها في الملف واستورده من جديد: ما استُورد لا يتكرر.
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadText(`أخطاء-الاستيراد.csv`, reportCsv(type, reportRows()))}
                      >
                        نزّل ملف الأخطاء
                      </Button>
                    </span>
                  </Alert>
                ) : null}
                {finished ? (
                  <Alert tone="success">
                    انتهى الاستيراد: <bdi className="num">{totals.create}</bdi> جديد،{' '}
                    <bdi className="num">{totals.update}</bdi> محدَّث.
                  </Alert>
                ) : null}
                <DataTable
                  caption={totals.error > 0 && !finished ? 'الصفوف التي فيها أخطاء' : 'صفوف الملف'}
                  columns={columns}
                  rows={shown}
                  rowKey={(r) => r.line}
                  empty={<EmptyState icon={PackageOpenIcon} title="لا صفوف" />}
                />
                {results.size > SHOWN_ROWS ? (
                  <p className="text-sm text-ink-muted">
                    نعرض أول {SHOWN_ROWS} صفاً. الباقي في ملف الأخطاء إن وُجدت أخطاء.
                  </p>
                ) : null}
                {phase === 'checked' ? (
                  <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 ps-5 shadow-e3">
                    <p className="text-sm text-ink-muted">
                      سيُضاف <bdi className="num font-semibold text-ink">{totals.create}</bdi> ويُحدَّث{' '}
                      <bdi className="num font-semibold text-ink">{totals.update}</bdi>
                    </p>
                    <Button
                      disabled={totals.create + totals.update === 0}
                      onClick={() => void send('commit')}
                    >
                      ابدأ الاستيراد
                    </Button>
                  </div>
                ) : null}
                {finished ? (
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => reset()}>
                      استورد ملفاً آخر
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

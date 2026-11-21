import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  COUNT_NOUNS,
  IMPORT_TYPES,
  IMPORT_TYPE_LABELS,
  countNoun,
  emptyImportTotals,
  type ImportRowResult,
  type ImportTotals,
  type ImportType,
} from '@serva/core';
import {
  Alert,
  Badge,
  cn,
  Button,
  Card,
  DataTable,
  EmptyState,
  PackageOpenIcon,
  ProgressBar,
  SegmentedControl,
  Select,
  StatTile,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { PageTop, SalesPage } from '../sales/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { isoDay, MONTHS } from '../../lib/dates';
import { downloadText } from '../accounting/csv';
import { postImport } from './api';
import { applyOldPound, OldPoundSwitch } from './oldPound';
import { FileProblem, readSpreadsheet, type Sheet } from './file';
import {
  assign,
  chunkRows,
  duplicateAnswer,
  initialMapping,
  fieldsFor,
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
import { DateField } from '../../lib/DateField';
import { ExportSteps, ProgramPicker, RecognisedNote } from './MigrationGuide';
import { openReport, PROGRAM_IDS, type ProgramId } from './programs';

type Step = 'program' | 'file' | 'columns' | 'review';
type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'file', label: '1. الملف' },
  { key: 'columns', label: '2. الأعمدة' },
  { key: 'review', label: '3. المراجعة والاستيراد' },
];
const MOVE_STEPS: { key: Step; label: string }[] = [
  { key: 'program', label: '1. البرنامج' },
  { key: 'file', label: '2. الملف' },
  { key: 'columns', label: '3. الأعمدة' },
  { key: 'review', label: '4. المراجعة والاستيراد' },
];

/** The steps as numbered marks on a line: a finished one shows a tick, the open one is in the brand colour */
function Stepper({ steps, current }: { steps: { key: Step; label: string }[]; current: Step }) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="خطوات الاستيراد">
      {steps.map((s, i) => {
        const done = at !== -1 && i < at;
        const open = i === at;
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-2">
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn('h-px w-6 sm:w-10', done || open ? 'bg-brand' : 'bg-line')}
              />
            ) : null}
            <span
              aria-current={open ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm font-semibold',
                open ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-subtle',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 place-items-center rounded-full border text-xs',
                  open
                    ? 'border-brand bg-brand text-on-brand'
                    : done
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line-control/50 bg-surface text-ink-subtle',
                )}
              >
                {done ? '✓' : <bdi className="num">{i + 1}</bdi>}
              </span>
              <span className={cn(!open && 'max-sm:sr-only')}>
                {s.label.slice(s.label.indexOf('.') + 1).trim()}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TONE: Record<ImportRowResult['status'], BadgeTone> = {
  create: 'success',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
};

const SHOWN_ROWS = 300;
/** «2026-10-30» as «30 تشرين الأول 2026», the way the boards and receipts write dates. */
const arabicDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${String(Number(m[3]))} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}` : undefined;
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
  const fromParam = params.get('from');
  const [program, setProgram] = useState<ProgramId | null>(PROGRAM_IDS.find((p) => p === fromParam) ?? null);
  const [step, setStep] = useState<Step>(fromParam === 'start' ? 'program' : 'file');
  const [movedTypes, setMovedTypes] = useState<ImportType[]>([]);
  const [recognised, setRecognised] = useState<{ count: number; derived: boolean } | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [table, setTable] = useState<Table>({ headers: [], body: [] });
  const [mapping, setMapping] = useState<Mapping>([]);
  const [existing, setExisting] = useState<'skip' | 'update'>('skip');
  const [date, setDate] = useState(() => isoDay(Date.now(), me.tenant.timezone));
  const [branchId, setBranchId] = useState(me.branches[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<number, ImportRowResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [oldPound, setOldPound] = useState(false);
  const cancel = useRef(false);

  const branches = useMemo(() => me.branches.map((b) => ({ id: b.id, name: b.name })), [me.branches]);
  const targets = useMemo(
    () => targetsOf(type, branches, me.tenant.sectors),
    [type, branches, me.tenant.sectors],
  );
  const [costOk, setCostOk] = useState(false);
  const fromFile = useMemo(() => prepareRows(type, table, mapping), [type, table, mapping]);
  const prepared = useMemo(() => (oldPound ? applyOldPound(fromFile) : fromFile), [fromFile, oldPound]);
  const byLine = useMemo(() => new Map(prepared.map((r) => [r.line, r])), [prepared]);
  const missing = missingRequired(type, mapping);
  const busy = phase === 'checking' || phase === 'importing';
  // Opening balances in the file: posted by the server against 3900 with the import, shown here first
  const balances = useMemo(() => {
    // Once the file is checked, only the rows that will be imported book a balance (a skipped or refused one books nothing)
    const nums =
      type === 'products'
        ? []
        : prepared
            .filter((r) => {
              const status = results.get(r.line)?.status;
              return status === undefined || status === 'create' || status === 'update';
            })
            .map((r) => Number(String(r.values.balance ?? '').replace(/,/g, '')))
            .filter((n) => Number.isFinite(n) && n !== 0);
    return { count: nums.length, sum: nums.reduce((a, b) => a + b, 0) };
  }, [prepared, type, results]);

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
    setSheetIndex(index);
    if (program) {
      const opened = openReport(program, type, sheet.rows, branches, me.tenant.id);
      setTable(opened.table);
      setMapping(opened.mapping);
      setRecognised({ count: opened.recognised, derived: opened.derivedBalance });
      setResults(new Map());
      setPhase('idle');
      return;
    }
    const t = tableOf(sheet.rows);
    setTable(t);
    setMapping(initialMapping(type, t.headers, branches, undefined, me.tenant.id));
    setRecognised(null);
    setResults(new Map());
    setPhase('idle');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const read = await readSpreadsheet(file, program !== null);
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
        .map((r) => {
          const answer = duplicateAnswer(
            type,
            r,
            rows.find((x) => x.line === r.duplicateOf),
          );
          const result: ImportRowResult =
            answer.status === 'error'
              ? {
                  line: r.line,
                  status: 'error',
                  errors: [{ field: type === 'products' ? 'barcode' : 'phone', message: answer.message }],
                  notes: [],
                }
              : { line: r.line, status: 'skip', errors: [], notes: [answer.message] };
          return [r.line, result] as const;
        }),
    );

  /** Sends the file in chunks, dry or real; the answers fill the table as they come. */
  const send = async (mode: 'dry_run' | 'commit') => {
    cancel.current = false;
    setError(null);
    if (mode === 'dry_run') setCostOk(false);
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
      if (mode === 'commit') setMovedTypes((m) => (m.includes(type) ? m : [...m, type]));
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

  const chosen = fieldsFor(type, me.tenant.sectors);
  const finished = phase === 'done';
  // Rows that bring stock but no cost: the owner agrees to them before the import starts
  const noCost =
    type === 'products'
      ? [...results.values()].filter((r) => r.notes.some((n) => n.startsWith('لا تكلفة'))).length
      : 0;
  const sheetPick = sheets.length > 1;
  const nameOf = (line: number) => String(byLine.get(line)?.values.name ?? '—');
  const shown = [...results.values()]
    .filter((r) => (totals.error > 0 && !finished ? r.status === 'error' : true))
    .sort((a, b) => a.line - b.line)
    .slice(0, SHOWN_ROWS);
  // The same problem on many rows is said once: «علبة: الوحدة غير موجودة — 40 صفاً»
  const errorGroups = new Map<string, { text: string; lines: number[] }>();
  for (const r of results.values()) {
    if (r.status !== 'error') continue;
    for (const e of r.errors) {
      const label = chosen.find((f) => f.key === e.field)?.label;
      const text = label ? `${label}: ${e.message}` : e.message;
      const group = errorGroups.get(text) ?? { text, lines: [] };
      group.lines.push(r.line);
      errorGroups.set(text, group);
    }
  }
  const groupedErrors = [...errorGroups.values()].sort((a, b) => b.lines.length - a.lines.length);
  const columns: DataColumn<ImportRowResult>[] = [
    {
      key: 'line',
      header: 'السطر في الملف',
      numeric: true,
      cell: (r) => <bdi className="num">{r.line}</bdi>,
    },
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
      <title>استيراد البيانات · SERVA</title>
      <SalesPage>
        <PageTop
          title="استيراد البيانات"
          subtitle="انقل المنتجات والزبائن والموردين من ملف إكسل أو ملف نصي مفصول بفواصل. يُفحص الملف كله قبل أن يتغيّر شيء."
        />
        <Stepper steps={program || step === 'program' ? MOVE_STEPS : STEPS} current={step} />
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 'program' ? (
          <ProgramPicker
            onPick={(p) => {
              setProgram(p);
              setStep('file');
            }}
            onBack={() => setStep('file')}
          />
        ) : null}

        {step === 'file' ? (
          <Card className="flex flex-col gap-5">
            <SegmentedControl
              label="ماذا تستورد؟"
              value={type}
              options={allowed.map((t) => ({ value: t, label: IMPORT_TYPE_LABELS[t] }))}
              onValueChange={(t) => reset(t)}
            />
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-line-control/60 px-6 py-10 text-center hover:bg-surface-muted">
              <span className="font-semibold text-ink">اختر ملف إكسل أو ملفاً نصياً مفصولاً بفواصل</span>
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
            {program ? (
              <ExportSteps
                program={program}
                type={type}
                done={movedTypes}
                onChange={() => setStep('program')}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => setStep('program')}>انقل من برنامجك القديم</Button>
                <Button
                  variant="secondary"
                  onClick={() => downloadText(templateName(type), templateCsv(type, me.tenant.sectors))}
                >
                  نزّل القالب الجاهز
                </Button>
                <p className="max-w-[100ch] basis-full text-sm text-ink-muted">
                  الأمين، الميزان، الرشيد أو أي برنامج يصدّر إلى إكسل. أعمدة {IMPORT_TYPE_LABELS[type]}:{' '}
                  {chosen.map((f) => f.label).join('، ')}.
                </p>
              </div>
            )}
            {program ? null : (
              <>
                <details className="text-sm text-ink-muted">
                  <summary className="w-fit cursor-pointer rounded-small font-semibold text-brand-ink">
                    اعرض شرح الأعمدة
                  </summary>
                  <ul className="mt-2 flex max-w-prose list-disc flex-col gap-1 ps-5">
                    {chosen
                      .filter((f) => f.hint)
                      .slice(0, 6)
                      .map((f) => (
                        <li key={f.key}>
                          <b className="text-ink">{f.label}:</b> {f.hint}
                        </li>
                      ))}
                  </ul>
                </details>
              </>
            )}
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
            {program && recognised ? (
              <RecognisedNote
                program={program}
                recognised={recognised.count}
                total={table.headers.length}
                derivedBalance={recognised.derived}
              />
            ) : null}
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
                  saveMapping(type, table.headers, mapping, me.tenant.id);
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
                  {phase === 'idle' || results.size === 0 ? (
                    <>
                      <bdi className="num">{prepared.length}</bdi> صف في الملف. اضغط «افحص الملف» لترى ما
                      سيحدث دون أن يتغيّر شيء.
                    </>
                  ) : (
                    <>
                      <bdi className="num">{totals.create + totals.update}</bdi> صف جاهز من{' '}
                      <bdi className="num">{prepared.length}</bdi>
                      {totals.skip > 0 ? (
                        <>
                          ، <bdi className="num">{totals.skip}</bdi> سيُترك
                        </>
                      ) : null}
                      {totals.error > 0 ? (
                        <>
                          ، <bdi className="num">{totals.error}</bdi> فيه خطأ
                        </>
                      ) : null}
                      .
                    </>
                  )}
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
                <DateField
                  label="تاريخ الأرصدة الافتتاحية"
                  value={date}
                  required
                  hint={arabicDate(date)}
                  onChange={(day) => {
                    setDate(day);
                    setPhase('idle');
                    setResults(new Map());
                  }}
                />
                <OldPoundSwitch
                  checked={oldPound}
                  onChange={(on) => {
                    setOldPound(on);
                    setPhase('idle');
                    setResults(new Map());
                  }}
                  rows={fromFile}
                  labels={new Map(fieldsFor(type, me.tenant.sectors).map((f) => [f.key, f.label]))}
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

            {balances.count > 0 ? (
              <Alert tone="info">
                في الملف <bdi className="num">{balances.count}</bdi> رصيد افتتاحي، مجموعها{' '}
                <bdi className="num">{balances.sum.toLocaleString('en-US')}</bdi>. تُقيَّد بتاريخ{' '}
                {arabicDate(date) ?? date} مقابل حساب «الأرصدة الافتتاحية» (3900)، ولا يُقيَّد شيء قبل أن تضغط
                «ابدأ الاستيراد». هذا للمالك فقط.
              </Alert>
            ) : null}

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
                {phase === 'checking' ? (
                  <p className="text-sm text-ink-muted">
                    نفحص الملف كله قبل أن يتغيّر شيء. الملف الكبير قد يأخذ دقيقة، فانتظر ولا تغلق الصفحة.
                  </p>
                ) : null}
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
                {totals.error > 0 && groupedErrors.some((g) => g.lines.length > 1) ? (
                  <ul className="list-disc ps-5 text-sm text-ink-muted">
                    {groupedErrors.slice(0, 5).map((g) => (
                      <li key={g.text}>
                        {g.text}
                        {g.lines.length > 1 ? (
                          <>
                            {' '}
                            (<bdi className="num">{countNoun(g.lines.length, COUNT_NOUNS.row)}</bdi>، أولها
                            السطر <bdi className="num">{g.lines[0]}</bdi>)
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
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
                <p className="text-sm text-ink-muted">
                  رقم السطر هو رقمه في الملف كما يظهر في برنامج الجداول.
                  {program
                    ? ' الأسطر فوق صف العناوين (عنوان التقرير) محسوبة أيضاً.'
                    : ' السطر 1 هو صف العناوين، فأول صنف في السطر 2.'}
                </p>
                {results.size > SHOWN_ROWS ? (
                  <p className="text-sm text-ink-muted">
                    نعرض أول {SHOWN_ROWS} صفاً. الباقي في ملف الأخطاء إن وُجدت أخطاء.
                  </p>
                ) : null}
                {phase === 'checked' && noCost > 0 ? (
                  <Alert tone="warning">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={costOk}
                        onChange={(e) => setCostOk(e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        {countNoun(noCost, COUNT_NOUNS.row)} بكمية افتتاحية وبلا تكلفة: ستدخل المخزون بقيمة
                        صفر ويظهر هامش ربحها 100٪ حتى أول فاتورة شراء. أضف عمود «التكلفة» وأعد الفحص، أو اعتمد
                        الاستيراد كما هو.
                      </span>
                    </label>
                  </Alert>
                ) : null}
                {phase === 'checked' ? (
                  <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 ps-5 shadow-e3">
                    <p className="text-sm text-ink-muted">
                      سيُضاف{' '}
                      <bdi className="num font-semibold text-ink">
                        {countNoun(totals.create, COUNT_NOUNS.row)}
                      </bdi>{' '}
                      ويُحدَّث{' '}
                      <bdi className="num font-semibold text-ink">
                        {countNoun(totals.update, COUNT_NOUNS.row)}
                      </bdi>
                    </p>
                    <Button
                      disabled={totals.create + totals.update === 0 || (noCost > 0 && !costOk)}
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
      </SalesPage>
    </>
  );
}

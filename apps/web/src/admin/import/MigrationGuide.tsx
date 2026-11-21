import type { ImportType } from '@serva/core';
import { Alert, Badge, Button, Card } from '@serva/ui';
import { exportSteps, PROGRAM_IDS, PROGRAMS, type ProgramId } from './programs';

/** «انقل من برنامجك القديم» step 1: which program the shop is leaving. */
export function ProgramPicker({
  onPick,
  onBack,
}: {
  onPick: (program: ProgramId) => void;
  onBack: () => void;
}) {
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">ما البرنامج الذي تنقل منه؟</h2>
        <p className="text-sm text-ink-muted">
          نشرح لك أي تقرير تصدّره من برنامجك، ونعرف أعمدته تلقائياً. برنامجك القديم يبقى كما هو ولا نغيّر فيه
          شيئاً.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PROGRAM_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="flex cursor-pointer flex-col gap-1 rounded-card border border-line px-6 py-4 text-start hover:bg-surface-muted"
          >
            <span className="font-semibold text-ink">{PROGRAMS[id].label}</span>
            <span className="text-sm text-ink-muted">{PROGRAMS[id].maker}</span>
          </button>
        ))}
      </div>
      <div className="flex">
        <Button variant="ghost" onClick={onBack}>
          رجوع إلى الاستيراد العادي
        </Button>
      </div>
    </Card>
  );
}

/** What to export from the old program for the type being moved, and which files are already in. */
export function ExportSteps({
  program,
  type,
  done,
  onChange,
}: {
  program: ProgramId;
  type: ImportType;
  done: readonly ImportType[];
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-surface-muted/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-ink">
          كيف تصدّر من <bdi>{PROGRAMS[program].label}</bdi>
        </h3>
        <Button size="sm" variant="ghost" onClick={onChange}>
          غيّر البرنامج
        </Button>
      </div>
      <ol className="list-decimal ps-5 text-sm text-ink-muted">
        {exportSteps(program, type).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {done.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          انتهى نقل:
          {done.map((t) => (
            <Badge key={t} tone="success">
              {{ products: 'المنتجات', customers: 'الزبائن', suppliers: 'الموردين' }[t]}
            </Badge>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** After a report is read: how many columns were recognised, and what was made of مدين and دائن. */
export function RecognisedNote({
  program,
  recognised,
  total,
  derivedBalance,
}: {
  program: ProgramId;
  recognised: number;
  total: number;
  derivedBalance: boolean;
}) {
  return (
    <Alert tone={recognised > 0 ? 'info' : 'warning'}>
      عرفنا <bdi className="num">{recognised}</bdi> من <bdi className="num">{total}</bdi> عموداً من تقرير{' '}
      <bdi>{PROGRAMS[program].label}</bdi>.
      {derivedBalance
        ? ' الملف فيه عمودا مدين ودائن، فجمعناهما في عمود رصيد واحد (الموجب: ما على الزبون لك، أو ما عليك للمورد).'
        : ''}{' '}
      راجع الجدول وصحّح ما يلزم، وسنتذكر اختيارك في المرة القادمة لهذا المتجر.
    </Alert>
  );
}

import { toLatinDigits } from '@serva/core';
import { Alert, Switch } from '@serva/ui';
import type { PreparedRow } from './mapping';

/** The cells that hold an amount of pounds (a dollar row keeps its own numbers). */
const MONEY_KEYS = ['price', 'wholesalePrice', 'cost', 'packPrice', 'balance', 'creditLimit'] as const;
const DOLLAR_ROW = /usd|\$|دولار/i;

/**
 * An old-pound amount as new pounds: divided by 100, rounded to the nearest piastre (half away
 * from zero), done on the digits so «12,555» never passes through a float. Null when the cell is
 * not a plain number (the server then refuses it as it always does).
 */
export function oldToNew(cell: unknown): string | null {
  const text = toLatinDigits(String(cell ?? ''))
    .replace(/[\s,]/g, '')
    .trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  let minor = BigInt(m[2]!);
  if ((m[3] ?? '').charAt(0) >= '5') minor += 1n;
  const whole = minor / 100n;
  const cents = minor % 100n;
  const body =
    cents === 0n ? String(whole) : `${String(whole)}.${String(cents).padStart(2, '0').replace(/0$/, '')}`;
  return m[1] && minor !== 0n ? `-${body}` : body;
}

/** The rows with every pound amount divided by 100 (the file's own cells are untouched). */
export function applyOldPound(rows: readonly PreparedRow[]): PreparedRow[] {
  return rows.map((row) => {
    if (DOLLAR_ROW.test(String(row.values.currency ?? ''))) return row;
    const values = { ...row.values };
    for (const key of MONEY_KEYS) {
      const cell = values[key];
      if (cell === null || cell === undefined) continue;
      const next = oldToNew(cell);
      if (next !== null) values[key] = next;
    }
    return { ...row, values };
  });
}

/** Before and after for the first rows, and how many amounts end up under half a pound. */
export function oldPoundPreview(rows: readonly PreparedRow[]) {
  const after = applyOldPound(rows);
  const samples: { line: number; field: string; before: string; after: string }[] = [];
  let tiny = 0;
  rows.forEach((row, i) => {
    for (const key of MONEY_KEYS) {
      const was = row.values[key];
      const now = after[i]!.values[key];
      if (was === undefined || was === null || was === now) continue;
      if (Number(now) > 0 && Number(now) < 0.5) tiny += 1;
      if (samples.length < 5)
        samples.push({ line: row.line, field: key, before: String(was), after: String(now) });
    }
  });
  return { samples, tiny };
}

/** «الأسعار بالليرة القديمة»: an import-only switch with the preview of what it does to the amounts. */
export function OldPoundSwitch({
  checked,
  onChange,
  rows,
  labels,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  rows: readonly PreparedRow[];
  labels: ReadonlyMap<string, string>;
}) {
  const preview = checked ? oldPoundPreview(rows) : null;
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <Switch
        label="الأسعار بالليرة القديمة"
        description="يُقسم كل سعر وتكلفة ورصيد في الملف على 100 قبل الاستيراد (الدولار يبقى كما هو). الملف نفسه لا يتغيّر."
        checked={checked}
        onCheckedChange={onChange}
      />
      {preview && preview.samples.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-control border border-line bg-surface-muted/60 px-4 py-3 text-sm text-ink-muted">
          {preview.samples.map((s) => (
            <li key={`${String(s.line)}-${s.field}`}>
              السطر <bdi className="num">{s.line}</bdi>، {labels.get(s.field) ?? s.field}:{' '}
              <bdi className="num">{s.before}</bdi> ← <bdi className="num text-ink">{s.after}</bdi>
            </li>
          ))}
        </ul>
      ) : null}
      {preview && preview.tiny > 0 ? (
        <Alert tone="warning">
          بعد القسمة بقي <bdi className="num">{preview.tiny}</bdi> مبلغ أقل من نصف ليرة. تأكد أن الملف فعلاً
          بالقديمة.
        </Alert>
      ) : null}
    </div>
  );
}

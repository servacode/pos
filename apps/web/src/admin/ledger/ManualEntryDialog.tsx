import { useEffect, useState } from 'react';
import { toMinor, type AccountRow } from '@serva/core';
import { AddIcon, Alert, Button, Dialog, Money, Select, Sheet, TextField, cn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { isoDay } from '../../lib/dates';
import { listAccounts } from '../reports/api';
import { defaultBranch } from '../reports/parts';
import { createManualEntry, reverseEntry } from './api';

/** Accounts only their own documents move (the server refuses them too). */
const DOCUMENT_ONLY = new Set(['1200', '2100', '2300', '1300', '1310', '1160', '1110']);

interface Line {
  key: number;
  accountCode: string;
  debit: string;
  credit: string;
}

const parse = (text: string, currency: Parameters<typeof toMinor>[1]): number | null => {
  if (!text.trim()) return 0;
  try {
    const minor = toMinor(text, currency);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
};

/**
 * «قيد يدوي» (29): the accountant's own entry, in the store's base currency. Debit must equal
 * credit before it can be saved, the server and the database check it again, and once posted it is
 * never edited: a wrong one is reversed.
 */
export function ManualEntryDialog({
  onSaved,
  onCancel,
}: {
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [accounts, setAccounts] = useState<Pick<AccountRow, 'code' | 'name'>[]>([]);
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState(defaultBranch(me) ?? me.branches[0]?.id ?? '');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { key: 1, accountCode: '', debit: '', credit: '' },
    { key: 2, accountCode: '', debit: '', credit: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let current = true;
    listAccounts().then(
      (r) => {
        // 1120 is a group of one safe per currency, and a line on it goes to the base currency's safe.
        const rows = r.items.filter(
          (a) => (!a.isGroup || a.code === '1120') && !DOCUMENT_ONLY.has(a.code) && a.parentCode !== '1110',
        );
        if (current) setAccounts(rows);
      },
      (e: unknown) => current && setError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, []);

  const parsed = lines.map((l) => ({ debit: parse(l.debit, base), credit: parse(l.credit, base) }));
  const valid = parsed.every((p, i) => {
    const l = lines[i]!;
    if (p.debit === null || p.credit === null) return false;
    if (l.accountCode === '' && p.debit === 0 && p.credit === 0) return true; // an untouched row
    return l.accountCode !== '' && p.debit > 0 !== p.credit > 0;
  });
  const used = lines.flatMap((l, i) => (l.accountCode !== '' ? [{ l, p: parsed[i]! }] : []));
  const debit = used.reduce((sum, u) => sum + (u.p.debit ?? 0), 0);
  const credit = used.reduce((sum, u) => sum + (u.p.credit ?? 0), 0);
  const ready =
    valid && used.length >= 2 && debit === credit && debit > 0 && memo.trim() !== '' && branchId !== '';

  const set = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const made = await createManualEntry({
        id: requestId,
        date,
        branchId,
        memo: memo.trim(),
        lines: used.map(({ l, p }) => ({
          accountCode: l.accountCode,
          debitMinor: p.debit ?? 0,
          creditMinor: p.credit ?? 0,
        })),
      });
      onSaved(made.number);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="قيد يدوي جديد"
      description="لا يُعدَّل القيد بعد ترحيله؛ يُصحَّح بقيد عكسي."
    >
      <form
        aria-label="قيد يدوي جديد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="التاريخ"
            type="date"
            dir="ltr"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            error={fields.date}
          />
          <Select
            label="الفرع"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            error={fields.branchId}
          >
            {me.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          label="البيان"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={300}
          error={fields.memo}
        />
        <div className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
              <Select
                label={`الحساب ${i + 1}`}
                value={l.accountCode}
                onChange={(e) => set(l.key, { accountCode: e.target.value })}
                error={fields[`lines.${i}.accountCode`]}
              >
                <option value="">اختر حساباً</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
              <TextField
                label="مدين"
                inputMode="decimal"
                dir="ltr"
                value={l.debit}
                onChange={(e) =>
                  set(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })
                }
                error={parsed[i]!.debit === null ? 'مبلغ غير صالح' : fields[`lines.${i}.debitMinor`]}
              />
              <TextField
                label="دائن"
                inputMode="decimal"
                dir="ltr"
                value={l.credit}
                onChange={(e) => set(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                error={parsed[i]!.credit === null ? 'مبلغ غير صالح' : undefined}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            icon={<AddIcon />}
            className="self-start"
            onClick={() =>
              setLines((all) => [
                ...all,
                { key: Math.max(...all.map((l) => l.key)) + 1, accountCode: '', debit: '', credit: '' },
              ])
            }
          >
            سطر آخر
          </Button>
        </div>
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-control px-4 py-3 text-sm',
            debit === credit && debit > 0
              ? 'bg-success-soft text-success-ink'
              : 'bg-surface-muted text-ink-muted',
          )}
        >
          <span>
            مدين <Money minor={debit} currency={base} /> · دائن <Money minor={credit} currency={base} />
          </span>
          <span className="font-semibold">
            {debit === credit && debit > 0 ? (
              'متوازن'
            ) : (
              <>
                الفرق <Money minor={Math.abs(debit - credit)} currency={base} />
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            رحّل القيد
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** The reason asked before a reversing entry is posted. */
export function ReverseDialog({
  entryId,
  number,
  onDone,
  onCancel,
}: {
  entryId: string;
  number: string;
  onDone: (reversal: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`عكس القيد ${number}`}
      description="يُرحَّل قيد معاكس بتاريخ القيد الأصلي، ويبقى الأصل ظاهراً."
    >
      <form
        aria-label="عكس قيد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          reverseEntry(entryId, reason.trim()).then(
            (r) => onDone(r.number),
            (err: unknown) => {
              setError(errorMessage(err));
              setSaving(false);
            },
          );
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="سبب العكس"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            رجوع
          </Button>
          <Button type="submit" loading={saving} disabled={reason.trim() === ''}>
            اعكس القيد
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

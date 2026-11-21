import { useState } from 'react';
import type { Unit } from '@serva/core';
import { Alert, Badge, Button, Dialog, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { createUnit, updateUnit } from '../catalog/api';

/** What a store usually counts in, to start from: a tap fills the name and the symbol. */
const SUGGESTIONS: readonly { name: string; symbol: string; fraction: boolean }[] = [
  { name: 'علبة', symbol: 'علبة', fraction: false },
  { name: 'كرتونة', symbol: 'كرتونة', fraction: false },
  { name: 'ربطة', symbol: 'ربطة', fraction: false },
  { name: 'زوج', symbol: 'زوج', fraction: false },
  { name: 'متر', symbol: 'م', fraction: true },
  { name: 'لتر', symbol: 'ل', fraction: true },
];

/**
 * «الوحدات» (09 › units): what an item is counted in. «قطعة» and «كيلو» come with the store; the
 * owner adds the rest (علبة، كرتونة، متر، لتر…) and archives what it no longer uses. How many pieces a
 * box or a carton holds is set per item, as its packs (a pack barcode), not here.
 */
export function UnitsDialog({
  units,
  onChange,
  onClose,
}: {
  units: readonly Unit[];
  onChange: (units: Unit[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [fraction, setFraction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function work<T>(job: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      return await job();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const made = await work(() =>
      createUnit({ name: name.trim(), symbol: symbol.trim() || name.trim(), allowsFraction: fraction }),
    );
    if (!made) return;
    onChange([...units, made]);
    setName('');
    setSymbol('');
    setFraction(false);
  }

  async function archive(unit: Unit, archived: boolean) {
    const done = await work(() => updateUnit(unit.id, { version: unit.version, archived }));
    if (done) onChange(units.map((u) => (u.id === done.id ? done : u)));
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="الوحدات"
      description="ما تُعدّ به الأصناف. كم قطعة في العلبة أو الكرتونة تحدّده في عبوات كل صنف."
    >
      <div className="flex flex-col gap-5">
        {error && !Object.keys(fields).length ? <Alert tone="error">{error}</Alert> : null}
        <ul aria-label="الوحدات الحالية" className="flex flex-col divide-y divide-line">
          {units.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{u.name}</span>
              <span className="text-sm text-ink-muted">{u.symbol}</span>
              {u.allowsFraction ? <Badge tone="info">بالوزن</Badge> : null}
              {u.archivedAt ? <Badge tone="neutral">مؤرشفة</Badge> : null}
              {!u.isSystem ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${u.archivedAt ? 'أعد' : 'أرشف'} الوحدة ${u.name}`}
                  onClick={() => void archive(u, !u.archivedAt)}
                >
                  {u.archivedAt ? 'أعدها' : 'أرشفها'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          aria-label="وحدة جديدة"
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add();
          }}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="وحدات شائعة">
            {SUGGESTIONS.filter((s) => !units.some((u) => u.name === s.name)).map((s) => (
              <Button
                key={s.name}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setName(s.name);
                  setSymbol(s.symbol);
                  setFraction(s.fraction);
                }}
              >
                {s.name}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="اسم الوحدة"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fields.name}
            />
            <TextField
              label="رمزها على الإيصال"
              hint="اختياري"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              error={fields.symbol}
            />
          </div>
          <Switch label="تُباع بالكسور (وزن أو طول)" checked={fraction} onCheckedChange={setFraction} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              تمّ
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              أضف الوحدة
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

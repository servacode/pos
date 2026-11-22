import { useState } from 'react';
import type { StoreResponse } from '@serva/core';
import { Button, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveService } from './api';
import { FailedNote, SavedNote, SETTINGS_SECTIONS, SettingsCard } from './parts';

/** «1-12، VIP1» → 1 … 12, VIP1: ranges of numbers and names, in the order typed */
export function tablesOf(text: string): string[] {
  const digits = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const out: string[] = [];
  for (const part of digits.split(/[,،\s]+/).filter(Boolean)) {
    const range = /^(\d{1,3})-(\d{1,3})$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      for (let n = from; n <= to && out.length < 200; n++) out.push(String(n));
    } else out.push(part);
  }
  return [...new Set(out)];
}

/** The tables as one line, ranges joined back: 1-12، VIP1 */
function tablesText(tables: readonly string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < tables.length) {
    let j = i;
    while (
      j + 1 < tables.length &&
      /^\d+$/.test(tables[j]!) &&
      Number(tables[j + 1]) === Number(tables[j]) + 1
    )
      j++;
    parts.push(j > i + 1 ? `${tables[i]}-${tables[j]}` : tables.slice(i, j + 1).join('، '));
    i = j + 1;
  }
  return parts.join('، ');
}

/**
 * «الصالة والمطبخ» (03 › المطاعم، المقاهي): what a restaurant or a café turns on at its tills —
 * order types and numbers, the hall's tables, and the kitchen ticket.
 */
export function ServiceForm({
  store,
  onSaved,
}: {
  store: StoreResponse;
  onSaved: (s: StoreResponse) => void;
}) {
  const initial = store.service;
  const [enabled, setEnabled] = useState(initial !== null);
  const [tables, setTables] = useState(initial ? tablesText(initial.tables) : '1-10');
  const [orderNumbers, setOrderNumbers] = useState(initial?.orderNumbers ?? true);
  const [kitchenTickets, setKitchenTickets] = useState(initial?.kitchenTickets ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(
        await saveService({
          service: enabled ? { tables: tablesOf(tables), orderNumbers, kitchenTickets } : null,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      section={SETTINGS_SECTIONS.service}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          {error ? <FailedNote>{error}</FailedNote> : null}
          {saved ? <SavedNote>حُفظت، وتصل إلى أجهزة الكاشير مع أول اتصال.</SavedNote> : null}
          <Button type="submit" loading={saving} className="max-sm:w-full">
            احفظ
          </Button>
        </>
      }
    >
      <Switch
        label="مطعم أو مقهى"
        description="يظهر على الكاشير نوع الطلب: صالة، سفري، توصيل."
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      {enabled ? (
        <div className="flex flex-col gap-5 border-t border-line pt-5">
          <TextField
            label="الطاولات"
            hint="أرقام أو أسماء مفصولة بفاصلة، والمدى بشرطة: 1-12، VIP1. فارغ: بلا طاولات (سفري سريع)"
            value={tables}
            onChange={(e) => setTables(e.target.value)}
          />
          <div className="flex flex-col divide-y divide-line rounded-control border border-line px-4">
            <Switch
              label="رقم لكل طلب"
              description="رقم كبير على الإيصال للنداء، يبدأ من 1 كل يوم."
              checked={orderNumbers}
              onCheckedChange={setOrderNumbers}
              className="py-3"
            />
            <Switch
              label="ورقة المطبخ"
              description="زر «للمطبخ» يطبع الجديد من الطلب دون أسعار."
              checked={kitchenTickets}
              onCheckedChange={setKitchenTickets}
              className="py-3"
            />
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}

import { useState } from 'react';
import { returnWindowDays, type StoreResponse } from '@serva/core';
import { Button, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveTill } from './api';
import { FailedNote, SavedNote, SETTINGS_SECTIONS, SettingsCard } from './parts';

/**
 * «الصندوق» (03 › الملابس: المرتجع والاستبدال): how many days back an invoice may be returned from
 * (left empty it follows the business type: 30 days for clothing, 7 for the rest), and whether a
 * card payment must carry the terminal's approval number.
 */
export function TillForm({ store, onSaved }: { store: StoreResponse; onSaved: (s: StoreResponse) => void }) {
  const [days, setDays] = useState(store.till?.returnWindowDays ? String(store.till.returnWindowDays) : '');
  const [cardRequired, setCardRequired] = useState(store.till?.cardApprovalRequired ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fallback = returnWindowDays(null, store.sectors);
  const typed = days.trim() === '' ? null : Number(days);
  const bad = typed !== null && (!Number.isInteger(typed) || typed < 1 || typed > 365);

  async function save() {
    if (bad) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await saveTill({ returnWindowDays: typed, cardApprovalRequired: cardRequired }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      section={SETTINGS_SECTIONS.till}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          {error ? <FailedNote>{error}</FailedNote> : null}
          {saved ? <SavedNote>حُفظ، ويصل إلى أجهزة الكاشير مع أول اتصال.</SavedNote> : null}
          <Button type="submit" loading={saving} disabled={bad} className="max-sm:w-full">
            احفظ
          </Button>
        </>
      }
    >
      <TextField
        label="أيام قبول المرتجع"
        hint={`اتركه فارغاً ليتبع نوع المتجر: ${fallback} يوماً`}
        inputMode="numeric"
        dir="ltr"
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
        error={bad ? 'اكتب عدداً من 1 إلى 365' : undefined}
        inputClassName="num"
      />
      <Switch
        label="رقم الموافقة إلزامي عند الدفع بالبطاقة"
        description="إن أُطفئ جاز إتمام الدفع بالبطاقة دون كتابة رقم الموافقة من جهاز الدفع."
        checked={cardRequired}
        onCheckedChange={setCardRequired}
      />
    </SettingsCard>
  );
}

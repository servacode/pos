import { useState } from 'react';
import type { StoreResponse } from '@serva/core';
import { Button, Switch } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { savePharmacy } from './api';
import { FailedNote, SavedNote, SETTINGS_SECTIONS, SettingsCard } from './parts';

/**
 * «الصيدلية» (03 › الصيدليات: الوصفة): whether the till must have a prescription's number and the
 * doctor's name before it sells a prescription medicine. A controlled drug always needs them, with
 * the patient's name and ID number, whatever is chosen here.
 */
export function PharmacyForm({
  store,
  onSaved,
}: {
  store: StoreResponse;
  onSaved: (s: StoreResponse) => void;
}) {
  const [required, setRequired] = useState(store.pharmacy?.prescription === 'required');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await savePharmacy({ prescription: required ? 'required' : 'optional' }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      section={SETTINGS_SECTIONS.pharmacy}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          {error ? <FailedNote>{error}</FailedNote> : null}
          {saved ? <SavedNote>حُفظ، ويصل إلى أجهزة الكاشير مع أول اتصال.</SavedNote> : null}
          <Button type="submit" loading={saving} className="max-sm:w-full">
            احفظ
          </Button>
        </>
      }
    >
      <Switch
        label="رقم الوصفة واسم الطبيب إلزاميان"
        description="للأصناف «تحتاج وصفة»: لا يتم البيع حتى يُكتبا. إن أُطفئ طُلبا ويجوز تخطيهما. الدواء المراقَب يطلب بياناته دائماً."
        checked={required}
        onCheckedChange={setRequired}
      />
    </SettingsCard>
  );
}

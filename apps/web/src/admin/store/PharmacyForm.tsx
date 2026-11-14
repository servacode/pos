import { useState } from 'react';
import { MEDICINE_RETURN_POLICIES, type MedicineReturnPolicy, type StoreResponse } from '@serva/core';
import { Button, Radio, RadioGroup, Switch } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { MEDICINAL_SECTORS, storeSells } from '../../lib/sectors';
import { savePharmacy } from './api';
import { FailedNote, SavedNote, SETTINGS_SECTIONS, SettingsCard } from './parts';

const POLICY_LABELS: Record<MedicineReturnPolicy, { label: string; description: string }> = {
  none: { label: 'لا مرتجع للأدوية', description: 'لا يقبل الكاشير أي دواء راجعاً.' },
  sealed: {
    label: 'المغلقة فقط بتأكيد',
    description: 'يقبل العلبة المغلقة السليمة بعد أن يؤكد الكاشير أنها لم تُفتح.',
  },
  allowed: { label: 'مسموح', description: 'يقبل الأدوية الراجعة كباقي الأصناف.' },
};

/**
 * «الصيدلية» (03 › الصيدليات): the prescription (whether the till must have a prescription's number
 * and the doctor's name before it sells a prescription medicine; a controlled drug always needs
 * them, with the patient's name and ID number), what comes back of the medicines, and whether the
 * till picks the batch itself. A store that is neither a pharmacy nor medical supplies sees only
 * the batch switch, as «الدفعات والصلاحية».
 */
export function PharmacyForm({
  store,
  onSaved,
}: {
  store: StoreResponse;
  onSaved: (s: StoreResponse) => void;
}) {
  const pharmacy = storeSells(store.sectors, ['pharmacy']);
  const medicinal = storeSells(store.sectors, MEDICINAL_SECTORS);
  const current = store.pharmacy;
  const [required, setRequired] = useState(current?.prescription === 'required');
  const [returns, setReturns] = useState<MedicineReturnPolicy>(current?.returns ?? 'sealed');
  const [controlled, setControlled] = useState(current?.controlledReturns === true);
  // On for a pharmacy until it is turned off; off for any other store until it is turned on
  const [autoBatch, setAutoBatch] = useState(current?.autoBatch ?? store.sectors.includes('pharmacy'));
  const [blockNoBatch, setBlockNoBatch] = useState(current?.blockNoBatch === true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(
        await savePharmacy({
          prescription: required ? 'required' : 'optional',
          returns,
          controlledReturns: controlled,
          autoBatch,
          ...(blockNoBatch || current?.blockNoBatch !== undefined ? { blockNoBatch } : {}),
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
      section={pharmacy ? SETTINGS_SECTIONS.pharmacy : SETTINGS_SECTIONS.batches}
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
      <div className="flex flex-col gap-5">
        {medicinal ? (
          <Switch
            label="رقم الوصفة واسم الطبيب إلزاميان"
            description="للأصناف «تحتاج وصفة»: لا يتم البيع حتى يُكتبا. إن أُطفئ طُلبا ويجوز تخطيهما. الدواء المراقَب يطلب بياناته دائماً."
            checked={required}
            onCheckedChange={setRequired}
          />
        ) : null}
        {medicinal ? (
          <RadioGroup legend="مرتجع الأدوية">
            {MEDICINE_RETURN_POLICIES.map((policy) => (
              <Radio
                key={policy}
                name="medicine-returns"
                value={policy}
                label={POLICY_LABELS[policy].label}
                description={POLICY_LABELS[policy].description}
                checked={returns === policy}
                onChange={() => setReturns(policy)}
              />
            ))}
          </RadioGroup>
        ) : null}
        {pharmacy ? (
          <Switch
            label="يجوز إرجاع الدواء المراقَب"
            description="مطفأ افتراضياً: الدواء المراقَب لا يعود أبداً. إن أُشعل قُبل علبة مغلقة بتأكيد الكاشير، ويُكتب المرتجع في سجل الأدوية المراقبة."
            checked={controlled}
            onCheckedChange={setControlled}
          />
        ) : null}
        <Switch
          label="اختر الدفعة تلقائياً واحجب المنتهي"
          description="يبيع الكاشير من الدفعة الأقرب انتهاءً ويسجّل رقمها على الفاتورة، ويرفض صنفاً انتهت كل دفعاته."
          checked={autoBatch}
          onCheckedChange={setAutoBatch}
        />
        <Switch
          label="امنع البيع بلا دفعة صالحة"
          description="مطفأ: إن لم تكفِ الدفعات الصالحة (منتهية أو موقوفة أو نفدت) طلب الكاشير رمز المدير. مشعل: لا يُباع."
          checked={blockNoBatch}
          onCheckedChange={setBlockNoBatch}
        />
      </div>
    </SettingsCard>
  );
}

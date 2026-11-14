import { useState } from 'react';
import { returnWindowDays, warrantyAsksCustomer, type StoreResponse } from '@serva/core';
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
  const [blockNegative, setBlockNegative] = useState(store.till?.blockNegativeStock === true);
  const [blockOverLimit, setBlockOverLimit] = useState(store.till?.creditOverLimit === 'block');
  const [belowCost, setBelowCost] = useState(store.till?.belowCostApproval === true);
  const [askCustomer, setAskCustomer] = useState(warrantyAsksCustomer(store.till, store.sectors));
  const [terms, setTerms] = useState(store.till?.warrantyTerms ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fallback = returnWindowDays(null, store.sectors);
  // Typed as it is: «3.5» and «-5» are refused with the message, never silently turned into 35 or 5
  const typed = days.trim() === '' ? null : Number(days);
  const bad = typed !== null && (!/^\d+$/.test(days.trim()) || typed < 1 || typed > 365);

  async function save() {
    if (bad) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(
        await saveTill({
          ...store.till,
          returnWindowDays: typed,
          cardApprovalRequired: cardRequired,
          ...(blockNegative || store.till?.blockNegativeStock !== undefined
            ? { blockNegativeStock: blockNegative }
            : {}),
          creditOverLimit: blockOverLimit ? 'block' : 'approve',
          belowCostApproval: belowCost,
          warrantyAskCustomer: askCustomer,
          warrantyTerms: terms.trim() || null,
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
        onChange={(e) => setDays(e.target.value.slice(0, 6))}
        error={bad ? 'اكتب عدداً من 1 إلى 365' : undefined}
        inputClassName="num"
      />
      <Switch
        label="رقم الموافقة إلزامي عند الدفع بالبطاقة"
        description="إن أُطفئ جاز إتمام الدفع بالبطاقة دون كتابة رقم الموافقة من جهاز الدفع."
        checked={cardRequired}
        onCheckedChange={setCardRequired}
      />
      <Switch
        label="امنع البيع فوق المخزون"
        description="مطفأ: يحذّر الكاشير بالكمية الموجودة ويكمل البيع. مشعل: لا يُباع أكثر مما في المخزون."
        checked={blockNegative}
        onCheckedChange={setBlockNegative}
      />
      <Switch
        label="امنع البيع بالآجل فوق حد الزبون"
        description="مطفأ: يبيع الكاشير بالآجل ضمن الحد دون رمز، وفوق الحد برمز مدير. مشعل: لا يُباع بالآجل فوق الحد أبداً."
        checked={blockOverLimit}
        onCheckedChange={setBlockOverLimit}
      />
      <Switch
        label="اطلب رمز مدير للبيع بأقل من التكلفة"
        description="مطفأ: يحذّر الكاشير فقط. مشعل: لا يُتمّ البيع بسعر أقل من متوسط التكلفة إلا برمز مدير."
        checked={belowCost}
        onCheckedChange={setBelowCost}
      />
      <Switch
        label="اطلب اسم الزبون وجواله لبيع جهاز بكفالة"
        description="الكاشير يختار الزبون أو يضيفه قبل الدفع، فتُسجَّل الكفالة باسمه وتُفتح مطالبتها بسهولة."
        checked={askCustomer}
        onCheckedChange={setAskCustomer}
      />
      <TextField
        label="شروط الكفالة على الشهادة"
        hint="تُطبع أسفل شهادة الكفالة A4. اتركها فارغة لتُطبع الشروط المعتادة."
        value={terms}
        onChange={(e) => setTerms(e.target.value.slice(0, 600))}
      />
    </SettingsCard>
  );
}

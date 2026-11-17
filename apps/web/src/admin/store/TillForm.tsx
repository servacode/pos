import { useState } from 'react';
import { returnWindowDays, warrantyAsksCustomer, type StoreResponse } from '@serva/core';
import type { CurrencyCode } from '@serva/core/currencies';
import { Alert, Button, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveTill } from './api';
import { CashNotesField, defaultNotes, noteCurrencies, sameNotes } from './CashNotesField';
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
  const [oldPound, setOldPound] = useState(store.till?.showOldPound === true);
  const [beep, setBeep] = useState(store.till?.scanBeep !== false);
  const [lock, setLock] = useState(store.till?.cashierLock === true);
  const [askCustomer, setAskCustomer] = useState(warrantyAsksCustomer(store.till, store.sectors));
  const [terms, setTerms] = useState(store.till?.warrantyTerms ?? '');
  const currencies = noteCurrencies(store);
  const [notes, setNotes] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(
      currencies.map((c) => [c, store.till?.cashNotes?.[c as CurrencyCode] ?? defaultNotes(c)]),
    ),
  );
  const emptyNotes = currencies.some((c) => notes[c]!.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fallback = returnWindowDays(null, store.sectors);
  // Typed as it is: «3.5» and «-5» are refused with the message, never silently turned into 35 or 5
  const typed = days.trim() === '' ? null : Number(days);
  const daysBad = typed !== null && (!/^\d+$/.test(days.trim()) || typed < 1 || typed > 365);
  const bad = daysBad || emptyNotes;
  // A store opened before the new pound still counts cash by old notes: one tap moves it to the built-in list
  const oldNotes = (notes.SYP ?? []).some((v) => v >= 1000);
  // What the form holds now against what was last saved: while they differ the bar says so
  const snap = (n: Record<string, number[]>) =>
    JSON.stringify([
      days,
      cardRequired,
      blockNegative,
      blockOverLimit,
      belowCost,
      oldPound,
      beep,
      lock,
      askCustomer,
      terms,
      n,
    ]);
  const now = snap(notes);
  const [savedSnap, setSavedSnap] = useState(now);
  const unsaved = now !== savedSnap;

  async function save(notesNow: Record<string, number[]> = notes) {
    if (bad) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Only a list that differs from the built-in one is stored: the rest follows the till's default
      const custom = Object.fromEntries(
        currencies.filter((c) => !sameNotes(notesNow[c]!, defaultNotes(c))).map((c) => [c, notesNow[c]!]),
      );
      const { cashNotes: _old, ...rest } = store.till ?? {
        returnWindowDays: null,
        cardApprovalRequired: false,
      };
      onSaved(
        await saveTill({
          ...rest,
          ...(Object.keys(custom).length > 0 ? { cashNotes: custom } : {}),
          returnWindowDays: typed,
          cardApprovalRequired: cardRequired,
          ...(blockNegative || store.till?.blockNegativeStock !== undefined
            ? { blockNegativeStock: blockNegative }
            : {}),
          creditOverLimit: blockOverLimit ? 'block' : 'approve',
          belowCostApproval: belowCost,
          showOldPound: oldPound,
          scanBeep: beep,
          cashierLock: lock,
          warrantyAskCustomer: askCustomer,
          warrantyTerms: terms.trim() || null,
        }),
      );
      setSavedSnap(snap(notesNow));
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
      stickyBar
      footer={
        <>
          {error ? <FailedNote>{error}</FailedNote> : null}
          {unsaved && !error ? (
            <p role="status" className="me-auto text-sm font-semibold text-warning-ink">
              عندك تعديلات غير محفوظة
            </p>
          ) : null}
          {saved && !unsaved ? <SavedNote>حُفظ، ويصل إلى أجهزة الكاشير مع أول اتصال.</SavedNote> : null}
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
        error={daysBad ? 'اكتب عدداً من 1 إلى 365' : undefined}
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
        label="اطبع سطر «بالقديم» تحت الإجمالي"
        description="يُكتب المبلغ بالليرة القديمة تحت الإجمالي على الإيصال والفاتورة. للعرض فقط، ولا يغيّر أي مبلغ."
        checked={oldPound}
        onCheckedChange={setOldPound}
      />
      <Switch
        label="صوت عند مسح الباركود"
        description="نغمة قصيرة عند مسح صنف، ونغمة أخرى حين لا يُعرف الباركود. أطفئه إن أزعجك الصوت."
        checked={beep}
        onCheckedChange={setBeep}
      />
      <Switch
        label="قفل الكاشير على شاشة البيع"
        description="لا يخرج الكاشير من شاشة البيع إلى الإدارة أو الإعدادات إلا برمز المدير."
        checked={lock}
        onCheckedChange={setLock}
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
      {currencies.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">فئات النقد</h3>
            <p className="text-sm text-ink-muted">
              الأوراق التي يعدّها الكاشير عند فتح الوردية وإغلاقها. أضف فئة جديدة أو احذف فئة لم تعد تُتداول.
            </p>
          </div>
          {oldNotes ? (
            <Alert tone="info" title="فئات الليرة من العملة القديمة">
              <span className="flex flex-col items-start gap-2">
                <span>
                  عندك فئات مثل 1000 و5000. فئات الليرة الجديدة هي {defaultNotes('SYP').join('، ')}. لا يتغيّر
                  شيء حتى تضغط الزر.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  loading={saving}
                  onClick={() => {
                    const next = { ...notes, SYP: defaultNotes('SYP') };
                    setNotes(next);
                    void save(next);
                  }}
                >
                  حدّث الفئات للعملة الجديدة
                </Button>
              </span>
            </Alert>
          ) : null}
          {currencies.map((c) => (
            <CashNotesField
              key={c}
              currency={c as CurrencyCode}
              notes={notes[c]!}
              onChange={(next) => setNotes((all) => ({ ...all, [c]: next }))}
            />
          ))}
        </div>
      ) : null}
    </SettingsCard>
  );
}

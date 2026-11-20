import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CURRENCIES, type InstalmentSettings, type MarkupBand } from '@serva/core';
import { Alert, Button, PageHeader, Select, Skeleton, Switch, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getInstalmentSettings, saveInstalmentSettings } from './api';

const NOTES_TEXT = {
  none: 'بدون كمبيالات',
  each: 'كمبيالة لكل قسط',
  single: 'كمبيالة واحدة بكل المبلغ',
} as const;

/** 500 → «5», 1250 → «12.5» */
const percentText = (bp: number) => String(bp / 100);
/** «5» → 500, «12.5» → 1250; null when it is not a percent from 0 to 100 */
function percentBp(text: string): number | null {
  const n = Number(text.trim().replace('٫', '.'));
  if (!text.trim() || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/**
 * «إعدادات التقسيط»: whether the store sells on instalments, the smallest down payment, the longest
 * plan, the markup per number of months (shown to the customer as one line «رسم التقسيط»), the
 * reminders and the promissory notes. A late fee and an early-settlement discount are off.
 */
export function SettingsPage() {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const unit = CURRENCIES[base].symbolAr;
  const [loaded, setLoaded] = useState<InstalmentSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minDown, setMinDown] = useState('20');
  const [maxCount, setMaxCount] = useState('12');
  const [bands, setBands] = useState<{ upToCount: string; percent: string }[]>([]);
  const [step, setStep] = useState('0');
  const [guarantorOver, setGuarantorOver] = useState('');
  const [before, setBefore] = useState('1');
  const [after, setAfter] = useState('3');
  const [notesMode, setNotesMode] = useState<InstalmentSettings['notesMode']>('none');
  const [noteText, setNoteText] = useState('');
  const [notePlace, setNotePlace] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // what is wrong in each field, shown next to it (key: the field's name)
  const [bad, setBad] = useState<Record<string, string>>({});

  useEffect(() => {
    getInstalmentSettings()
      .then((s) => {
        setLoaded(s);
        setEnabled(s.enabled);
        setMinDown(percentText(s.minDownBp));
        setMaxCount(String(s.maxCount));
        setBands(s.markupBands.map((b) => ({ upToCount: String(b.upToCount), percent: percentText(b.bp) })));
        setStep(String(s.roundingStepMinor / 100));
        setGuarantorOver(s.guarantorOverMinor === null ? '' : String(s.guarantorOverMinor / 100));
        setBefore(String(s.reminderBeforeDays));
        setAfter(String(s.reminderAfterDays));
        setNotesMode(s.notesMode);
        setNoteText(s.noteText ?? '');
        setNotePlace(s.notePlace ?? '');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const found: Record<string, string> = {};
    const parsed: MarkupBand[] = [];
    bands.forEach((b, i) => {
      const bp = percentBp(b.percent);
      const count = Number(b.upToCount);
      if (!Number.isInteger(count) || count < 1 || count > 60) found[`band-count-${i}`] = 'من 1 إلى 60';
      if (bp === null) found[`band-percent-${i}`] = 'نسبة من 0 إلى 100';
      if (bp !== null && Number.isInteger(count) && count >= 1) parsed.push({ upToCount: count, bp });
    });
    const down = percentBp(minDown);
    if (down === null) found.minDown = 'اكتب نسبة من 0 إلى 100.';
    const whole = (t: string, min: number, max: number) => {
      const n = Number(t.trim());
      return t.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
    };
    if (!whole(maxCount, 1, 60)) found.maxCount = 'اكتب عدداً من 1 إلى 60.';
    if (!whole(before, 0, 30)) found.before = 'اكتب عدداً من 0 إلى 30.';
    if (!whole(after, 0, 60)) found.after = 'اكتب عدداً من 0 إلى 60.';
    const money = (t: string) => Number.isFinite(Number(t.trim() || '0')) && Number(t.trim() || '0') >= 0;
    if (!money(step)) found.step = 'اكتب مبلغاً صحيحاً (0 أو أكثر).';
    if (guarantorOver.trim() && !money(guarantorOver))
      found.guarantorOver = 'اكتب مبلغاً صحيحاً (0 أو أكثر).';
    if (new Set(bands.map((b) => b.upToCount.trim())).size !== bands.length)
      found['band-count-0'] = found['band-count-0'] ?? 'عدد أقساط مكرر في النسب';
    setBad(found);
    if (Object.keys(found).length > 0) {
      setSaving(false);
      setError('راجع الحقول المعلّمة بالأحمر.');
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.scrollIntoView?.({ block: 'center' }),
      );
      return;
    }
    try {
      const overMinor = guarantorOver.trim() ? Math.round(Number(guarantorOver) * 100) : null;
      const next = await saveInstalmentSettings({
        enabled,
        minDownBp: down!,
        maxCount: Number(maxCount),
        markupBands: parsed,
        roundingStepMinor: Math.round(Number(step || '0') * 100),
        guarantorOverMinor: overMinor,
        reminderBeforeDays: Number(before),
        reminderAfterDays: Number(after),
        notesMode,
        noteText: noteText.trim() || null,
        notePlace: notePlace.trim() || null,
      });
      setLoaded(next);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <title>إعدادات التقسيط · SERVA</title>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          title="إعدادات التقسيط"
          description="تحدد هنا قواعد البيع بالتقسيط على الكاشير."
          actions={
            <Link to="/installments">
              <Button variant="secondary">كل الخطط</Button>
            </Link>
          }
        />
        {error && !loaded ? <Alert tone="error">{error}</Alert> : null}
        {saved ? <Alert tone="success">حُفظت الإعدادات. تصل الكاشير مع أول مزامنة.</Alert> : null}
        {!loaded && !error ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <form
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Switch
              label="البيع بالتقسيط"
              description="عند التشغيل يظهر خيار «بيع بالتقسيط» في شاشة الدفع بعد اختيار الزبون."
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <section className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
              <TextField
                label="أقل دفعة أولى (%)"
                hint="المدير يستطيع تخفيضها عند البيع."
                inputMode="decimal"
                dir="ltr"
                value={minDown}
                onChange={(e) => setMinDown(e.target.value)}
                error={bad.minDown}
              />
              <TextField
                label="أكثر عدد للأقساط"
                inputMode="numeric"
                dir="ltr"
                value={maxCount}
                onChange={(e) => setMaxCount(e.target.value)}
                error={bad.maxCount}
              />
              <TextField
                label={`تقريب القسط (${unit})`}
                hint="0 يعني بلا تقريب. الأخير يأخذ الفرق."
                inputMode="decimal"
                dir="ltr"
                value={step}
                onChange={(e) => setStep(e.target.value)}
                error={bad.step}
              />
              <TextField
                label={`كفيل إجباري فوق (${unit})`}
                hint="اتركه فارغاً: الكفيل اختياري دائماً."
                inputMode="decimal"
                dir="ltr"
                value={guarantorOver}
                onChange={(e) => setGuarantorOver(e.target.value)}
                error={bad.guarantorOver}
              />
            </section>
            <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <h2 className="font-semibold">رسم التقسيط</h2>
              <p className="text-sm text-ink-muted">
                نسبة تُضاف على المبلغ المتبقي بعد الدفعة الأولى، بحسب عدد الأقساط، وتظهر سطراً واحداً في
                الفاتورة.
              </p>
              {bands.map((b, i) => (
                <div key={i} className="grid grid-cols-3 items-end gap-3">
                  <TextField
                    label="حتى عدد أقساط"
                    inputMode="numeric"
                    dir="ltr"
                    value={b.upToCount}
                    error={bad[`band-count-${i}`]}
                    onChange={(e) =>
                      setBands((list) =>
                        list.map((x, j) => (j === i ? { ...x, upToCount: e.target.value } : x)),
                      )
                    }
                  />
                  <TextField
                    label="النسبة (%)"
                    inputMode="decimal"
                    dir="ltr"
                    value={b.percent}
                    error={bad[`band-percent-${i}`]}
                    onChange={(e) =>
                      setBands((list) =>
                        list.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)),
                      )
                    }
                  />
                  <Button variant="ghost" onClick={() => setBands((list) => list.filter((_, j) => j !== i))}>
                    احذف
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setBands((list) => [...list, { upToCount: '', percent: '' }])}
                >
                  أضف نسبة
                </Button>
              </div>
            </section>
            <section className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
              <TextField
                label="التذكير قبل الاستحقاق (أيام)"
                inputMode="numeric"
                dir="ltr"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                error={bad.before}
              />
              <TextField
                label="التذكير بعد الاستحقاق (أيام)"
                inputMode="numeric"
                dir="ltr"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                error={bad.after}
              />
            </section>
            <section className="grid gap-4 rounded-card border border-line bg-surface p-4">
              <Select
                label="الكمبيالات"
                value={notesMode}
                onChange={(e) => setNotesMode(e.target.value as InstalmentSettings['notesMode'])}
              >
                {(Object.keys(NOTES_TEXT) as (keyof typeof NOTES_TEXT)[]).map((k) => (
                  <option key={k} value={k}>
                    {NOTES_TEXT[k]}
                  </option>
                ))}
              </Select>
              <TextField
                label="مكان الإصدار"
                hint="مثل: دمشق"
                value={notePlace}
                onChange={(e) => setNotePlace(e.target.value)}
              />
              <TextField
                label="نص الكمبيالة"
                hint="اتركه فارغاً لنص جاهز. اكتب {store} ليُوضع اسم المتجر. يُفضّل أن يراجعه محامٍ."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                maxLength={600}
              />
            </section>
            <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-line bg-surface px-1 py-3">
              {error && loaded ? <Alert tone="error">{error}</Alert> : null}
              <div>
                <Button type="submit" loading={saving}>
                  احفظ
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

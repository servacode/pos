import { useState } from 'react';
import type { StoreResponse } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import { Alert, Button, Card, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveLoyalty } from './api';

/** Whole amounts in the store's currency to minor units («1000» → 100,000); null while unusable. */
function minorOf(text: string, decimals: number): number | null {
  const clean = text.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!clean || [...clean].some((c) => c < '0' || c > '9')) return null;
  const n = Number(clean) * 10 ** decimals;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * «نقاط الولاء» (03 › الألبسة): a customer named on a sale earns a point for every amount spent, and
 * spends them at the till («نقاط» at payment) at a point's value. What they spend is the
 * programme's cost (6700). Off by default.
 */
export function LoyaltyForm({
  store,
  onSaved,
}: {
  store: StoreResponse;
  onSaved: (s: StoreResponse) => void;
}) {
  const decimals = CURRENCIES[store.baseCurrency].decimals;
  const unit = 10 ** decimals;
  const [enabled, setEnabled] = useState(store.loyalty !== null);
  const [every, setEvery] = useState(String((store.loyalty?.earnEveryMinor ?? 100_000) / unit));
  const [value, setValue] = useState(String((store.loyalty?.pointValueMinor ?? 1_000) / unit));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const earnEveryMinor = minorOf(every, decimals);
  const pointValueMinor = minorOf(value, decimals);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(
        await saveLoyalty({
          loyalty: enabled && earnEveryMinor && pointValueMinor ? { earnEveryMinor, pointValueMinor } : null,
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
    <Card>
      <form
        aria-label="نقاط الولاء"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Switch
          label="الزبون يجمع نقاطاً"
          description="لكل زبون مختار على الفاتورة. يصرفها على الكاشير عند الدفع من «نقاط»."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        {enabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="نقطة لكل"
              hint={`بالـ${CURRENCIES[store.baseCurrency].symbolAr} من المشتريات`}
              dir="ltr"
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value.slice(0, 12))}
              error={earnEveryMinor === null ? 'اكتب مبلغاً' : undefined}
            />
            <TextField
              label="قيمة النقطة"
              hint="ما تخصمه النقطة عند الصرف"
              dir="ltr"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, 12))}
              error={pointValueMinor === null ? 'اكتب مبلغاً' : undefined}
            />
          </div>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {saved ? <Alert tone="success">حُفظ، ويصل إلى أجهزة الكاشير مع أول اتصال.</Alert> : null}
        <div>
          <Button type="submit" loading={saving} disabled={enabled && (!earnEveryMinor || !pointValueMinor)}>
            احفظ
          </Button>
        </div>
      </form>
    </Card>
  );
}

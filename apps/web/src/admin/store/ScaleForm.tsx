import { useState } from 'react';
import type { ScaleBarcodeConfig, StoreResponse } from '@serva/core';
import { DEFAULT_SCALE_BARCODE } from '@serva/core/scale';
import { Alert, Button, Card, SegmentedControl, Select, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveScale } from './api';

/**
 * «باركود الميزان» (03 › المولات والسوبرماركت): how the shop's scales print their labels, so the
 * till reads the item and its weight or price from one scan. Each weighed product gets its number
 * on the scale as a barcode (e.g. 00123).
 */
export function ScaleForm({ store, onSaved }: { store: StoreResponse; onSaved: (s: StoreResponse) => void }) {
  const initial = store.scaleBarcode;
  const [enabled, setEnabled] = useState(initial !== null);
  const [config, setConfig] = useState<ScaleBarcodeConfig>(initial ?? DEFAULT_SCALE_BARCODE);
  const [prefixes, setPrefixes] = useState((initial ?? DEFAULT_SCALE_BARCODE).prefixes.join(' '));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const list = prefixes.split(/[\s,،]+/).filter(Boolean);
      onSaved(await saveScale({ scaleBarcode: enabled ? { ...config, prefixes: list } : null }));
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
        aria-label="باركود الميزان"
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        {saved ? <Alert tone="success">حُفظ باركود الميزان، ويصل الكاشير مع أول مزامنة.</Alert> : null}
        <Switch
          label="ميزاني يطبع ملصقات بالباركود"
          description="الكاشير يقرأ من الملصق الصنف ووزنه أو سعره. أعطِ كل صنف موزون رقمه على الميزان باركوداً."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        {enabled ? (
          <>
            <TextField
              label="بادئات الميزان"
              hint="الخانتان الأوليان من الملصق، من 20 إلى 28، مفصولة بمسافة"
              dir="ltr"
              value={prefixes}
              onChange={(e) => setPrefixes(e.target.value)}
            />
            <Select
              label="خانات رقم الصنف"
              value={String(config.itemDigits)}
              onChange={(e) => setConfig({ ...config, itemDigits: Number(e.target.value) })}
            >
              <option value="4">4 خانات</option>
              <option value="5">5 خانات</option>
              <option value="6">6 خانات</option>
            </Select>
            <SegmentedControl
              label="الملصق يحمل"
              value={config.valueKind}
              onValueChange={(valueKind) =>
                setConfig({ ...config, valueKind, valueDecimals: valueKind === 'weight' ? 3 : 0 })
              }
              options={[
                { value: 'weight', label: 'الوزن' },
                { value: 'price', label: 'السعر' },
              ]}
            />
            <Select
              label={config.valueKind === 'weight' ? 'دقة الوزن' : 'كسور السعر'}
              value={String(config.valueDecimals)}
              onChange={(e) => setConfig({ ...config, valueDecimals: Number(e.target.value) })}
            >
              {config.valueKind === 'weight' ? (
                <>
                  <option value="3">بالغرام (01250 = 1.250 كغ)</option>
                  <option value="2">بعشرات الغرامات (00125 = 1.25 كغ)</option>
                </>
              ) : (
                <>
                  <option value="0">ليرات كاملة (12500 = 12,500 ل.س)</option>
                  <option value="2">مع القروش (1250000 = 12,500.00)</option>
                </>
              )}
            </Select>
          </>
        ) : null}
        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" size="lg" loading={saving} className="max-sm:w-full">
            احفظ
          </Button>
        </div>
      </form>
    </Card>
  );
}

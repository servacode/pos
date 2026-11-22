import { useState } from 'react';
import type { ScaleBarcodeConfig, StoreResponse } from '@serva/core';
import { DEFAULT_SCALE_BARCODE, scaleHasCheck, scaleLabelLength, scaleValueDigits } from '@serva/core/scale';
import { Button, SegmentedControl, Select, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { saveScale } from './api';
import { FailedNote, SavedNote, SETTINGS_SECTIONS, SettingsCard } from './parts';
import { ScaleTester } from './ScaleTester';

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

  const autoDigits = scaleValueDigits({ itemDigits: config.itemDigits, checkDigit: config.checkDigit });

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const list = prefixes.split(/[\s,،]+/).filter(Boolean);
      // The two round-38 fields are stored only when they differ from the default: an old format stays as it was
      const { valueDigits, checkDigit, ...base } = config;
      onSaved(
        await saveScale({
          scaleBarcode: enabled
            ? {
                ...base,
                prefixes: list,
                ...(valueDigits !== undefined ? { valueDigits } : {}),
                ...(checkDigit === false ? { checkDigit: false } : {}),
              }
            : null,
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
      section={SETTINGS_SECTIONS.scale}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          {error ? <FailedNote>{error}</FailedNote> : null}
          {saved ? <SavedNote>حُفظ باركود الميزان، ويصل إلى أجهزة الكاشير مع أول اتصال.</SavedNote> : null}
          <Button type="submit" loading={saving} className="max-sm:w-full">
            احفظ
          </Button>
        </>
      }
    >
      <Switch
        label="ميزاني يطبع ملصقات بالباركود"
        description="الكاشير يقرأ من الملصق الصنف ووزنه أو سعره. أعطِ كل صنف موزون رقمه على الميزان باركوداً."
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      {enabled ? (
        <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <TextField
            label="بادئات الميزان"
            hint="الخانتان الأوليان من الملصق، من 20 إلى 28، مفصولة بمسافة"
            dir="ltr"
            inputClassName="num"
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
          {/* The group is named by its own label; this one shows it like the fields' labels. */}
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="text-sm font-semibold text-ink-muted">
              الملصق يحمل
            </span>
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
              fullWidth
            />
          </div>
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
          <Select
            label="خانات الوزن أو السعر"
            hint="كم خانة تحمل القيمة في الملصق"
            value={config.valueDigits === undefined ? '' : String(config.valueDigits)}
            onChange={(e) =>
              setConfig({
                ...config,
                valueDigits: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          >
            <option value="">{`تلقائي (${autoDigits} خانات)`}</option>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{`${n} خانات`}</option>
            ))}
          </Select>
          <Switch
            label="آخر خانة رقم تحقق"
            description="تُحسب من باقي الأرقام (EAN). أطفئها إن كان ميزانك لا يطبع رقم تحقق."
            checked={scaleHasCheck(config)}
            onCheckedChange={(on) => setConfig({ ...config, checkDigit: on ? undefined : false })}
          />
          <p className="num text-sm text-ink-muted sm:col-span-2">
            {`طول الملصق ${scaleLabelLength(config)} خانة: بادئة 2 + صنف ${config.itemDigits} + قيمة ${scaleValueDigits(config)}${scaleHasCheck(config) ? ' + تحقق 1' : ''}`}
          </p>
          <div className="sm:col-span-2">
            <ScaleTester
              config={{ ...config, prefixes: prefixes.split(/[\s,،]+/).filter(Boolean) }}
              base={store.baseCurrency}
            />
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}

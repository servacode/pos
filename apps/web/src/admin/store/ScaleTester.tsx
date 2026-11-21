import { useEffect, useState } from 'react';
import {
  diagnoseScaleBarcode,
  qtyForPrice,
  type ScaleBarcodeConfig,
  type ScaleMiss,
  type StoreResponse,
} from '@serva/core';
import { Alert, formatQuantity, Money, TextField, useDigits } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { getProduct, probeBarcode } from '../catalog/api';

const MISS_TEXT: Record<ScaleMiss, (expected: number) => string> = {
  length: (n) => `ليس ملصق ميزان بهذا الشكل: طول الملصق ${n} خانة.`,
  letters: () => 'الملصق أرقام فقط، وفي ما كتبتَ حروف أو رموز.',
  prefix: () => 'بادئة الملصق ليست من بادئات الميزان التي كتبتَها.',
  check: () => 'خانة التحقق الأخيرة لا تطابق باقي الأرقام.',
  zero: () => 'قيمة الوزن أو السعر في الملصق صفر.',
};

interface Found {
  name: string;
  priceMinor: number;
  currency: StoreResponse['baseCurrency'];
}

/**
 * «جرّب ملصقاً»: type or scan a label and see how the format above cuts it (prefix, item, value, check digit),
 * what it reads (the weight or the price) and which product it finds, before the till ever meets it.
 */
export function ScaleTester({
  config,
  base,
}: {
  config: ScaleBarcodeConfig;
  base: StoreResponse['baseCurrency'];
}) {
  const digits = useDigits();
  const [code, setCode] = useState('');
  const typed = code.trim();
  const result = typed ? diagnoseScaleBarcode(typed, config) : null;
  const itemCode = result?.ok ? result.itemCode : null;
  const [found, setFound] = useState<Found | 'none' | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    setFound(null);
    setLookupError(null);
    if (!itemCode) return;
    let live = true;
    probeBarcode(itemCode)
      .then(async (hit) => {
        if (!live) return;
        if (!hit) {
          setFound('none');
          return;
        }
        const product = await getProduct(hit.productId);
        const variant = product.variants.find((v) => v.id === hit.variantId) ?? product.variants[0];
        if (live && variant) {
          setFound({
            name: product.nameAr,
            priceMinor: variant.price.priceMinor,
            currency: variant.price.currency,
          });
        }
      })
      .catch((e: unknown) => {
        if (live) setLookupError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [itemCode]);

  const reading = result?.ok ? result.reading : null;
  // The line's cost, as the till would work it out: weight × the unit price, or the label's own price
  const sameCurrency = found && found !== 'none' && found.currency === base;
  const cost =
    reading && found && found !== 'none' && sameCurrency
      ? reading.kind === 'weight'
        ? Math.round((reading.qty * found.priceMinor) / 1000)
        : reading.priceMinor
      : null;
  const weightOfPrice =
    reading?.kind === 'price' && found && found !== 'none' && sameCurrency && found.priceMinor > 0
      ? qtyForPrice(reading.priceMinor, found.priceMinor)
      : null;

  return (
    <div className="grid gap-3 border-t border-line pt-5" data-testid="scale-tester">
      <TextField
        label="جرّب ملصقاً"
        hint="امسح ملصق الميزان بالقارئ أو اكتب أرقامه، لترى كيف يقرؤه الكاشير"
        dir="ltr"
        inputMode="numeric"
        inputClassName="num"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\s+/g, '').slice(0, 24))}
      />
      {result && !result.ok ? (
        <Alert tone="warning">{MISS_TEXT[result.miss](result.expectedLength)}</Alert>
      ) : null}
      {result?.ok && reading ? (
        <div className="grid gap-2 rounded-card border border-line bg-surface-muted p-3 text-sm/5">
          <p className="num flex flex-wrap gap-x-4 gap-y-1" dir="ltr">
            <span>
              <b className="text-ink-muted">بادئة </b>
              {result.prefix}
            </span>
            <span>
              <b className="text-ink-muted">صنف </b>
              {result.itemCode}
            </span>
            <span>
              <b className="text-ink-muted">قيمة </b>
              {result.valueText}
            </span>
            {result.check !== null ? (
              <span>
                <b className="text-ink-muted">تحقق </b>
                {result.check}
              </span>
            ) : null}
          </p>
          <p className="font-semibold text-ink">
            {reading.kind === 'weight' ? (
              <>
                الوزن <bdi className="num">{formatQuantity(reading.qty, digits)}</bdi> كغ
              </>
            ) : (
              <>
                السعر على الملصق <Money minor={reading.priceMinor} currency={base} />
              </>
            )}
          </p>
          {found === 'none' ? (
            <Alert tone="warning">
              لا منتج باركوده <bdi className="num">{result.itemCode}</bdi>. أعطِ المنتج الموزون رقمه على
              الميزان باركوداً.
            </Alert>
          ) : null}
          {found && found !== 'none' ? (
            <p className="text-ink">
              المنتج: <b>{found.name}</b>
              {cost !== null ? (
                <>
                  {' '}
                  · الكاشير يسجّل <Money minor={cost} currency={base} />
                </>
              ) : null}
              {weightOfPrice !== null ? (
                <>
                  {' '}
                  · أي <bdi className="num">{formatQuantity(weightOfPrice, digits)}</bdi> كغ
                </>
              ) : null}
            </p>
          ) : null}
          {lookupError ? <p className="text-danger-ink">{lookupError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

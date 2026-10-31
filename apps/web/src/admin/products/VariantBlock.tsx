import { useState } from 'react';
import { Link } from 'react-router';
import { CURRENCIES, INTERNAL_BARCODE_PREFIX, barcodeCodeSchema, type CurrencyCode } from '@serva/core';
import {
  AddIcon,
  Badge,
  BarcodeIcon,
  Button,
  DeleteIcon,
  IconButton,
  MoneyField,
  NumberField,
  Select,
  TextField,
  textLinkClass,
} from '@serva/ui';
import { ApiError } from '../../lib/api';
import { lookupBarcode } from '../catalog/api';
import { barcodeOf } from '../catalog/catalog';
import { newBarcode, variantLabel, type BarcodeDraft, type FieldErrors, type VariantDraft } from './form';

interface VariantBlockProps {
  variant: VariantDraft;
  /** Shown as the block's title when the product has options */
  titled: boolean;
  productId: string | null;
  currencies: readonly CurrencyCode[];
  unitSymbol: string;
  allowsFraction: boolean;
  errors: FieldErrors;
  /** Every code already in the card, to refuse a repeat before asking the server */
  codesInCard: ReadonlySet<string>;
  onChange: (variant: VariantDraft) => void;
}

type AddError = { text: string; productId?: string } | null;

/**
 * One variant's selling data (kit admin/ProductCard › الأسعار والوحدات، الباركودات): the shelf price
 * in pounds or dollars, the lowest bargaining price, the branch minimum, and its barcodes, which a
 * scanner adds by itself (it types the code and Enter).
 */
export function VariantBlock({
  variant,
  titled,
  productId,
  currencies,
  unitSymbol,
  allowsFraction,
  errors,
  codesInCard,
  onChange,
}: VariantBlockProps) {
  const [newCode, setNewCode] = useState('');
  const [addError, setAddError] = useState<AddError>(null);
  const [checking, setChecking] = useState(false);
  const label = variantLabel(variant.attributes);
  const k = (field: string) => `v.${variant.key}.${field}`;
  const set = (patch: Partial<VariantDraft>) => onChange({ ...variant, ...patch });
  const setBarcode = (barcode: BarcodeDraft) =>
    set({ barcodes: variant.barcodes.map((b) => (b.key === barcode.key ? barcode : b)) });

  async function addCode() {
    const parsed = barcodeCodeSchema.safeParse(barcodeOf(newCode));
    if (!parsed.success) {
      setAddError({ text: parsed.error.issues[0]?.message ?? 'الباركود غير صالح' });
      return;
    }
    const code = parsed.data;
    if (codesInCard.has(code)) {
      setAddError({ text: 'الباركود مكرر في هذا المنتج' });
      return;
    }
    setChecking(true);
    try {
      const found = await lookupBarcode(code);
      if (found.productId !== productId) {
        setAddError({ text: 'هذا الباركود على منتج آخر.', productId: found.productId });
        return;
      }
    } catch (error) {
      // 404: the code is free. Without the network the server checks it again on save.
      if (!(error instanceof ApiError) || (error.code !== 'not_found' && error.status !== 0)) {
        setAddError({ text: error instanceof Error ? error.message : 'حدث خطأ غير متوقع. حاول مجدداً.' });
        return;
      }
    } finally {
      setChecking(false);
    }
    set({ barcodes: [...variant.barcodes, newBarcode('standard', code)] });
    setNewCode('');
    setAddError(null);
  }

  const priceRow = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex items-start gap-2">
        <MoneyField
          key={variant.currency}
          name={k('price')}
          label={titled ? `سعر البيع لـ«${label}»` : 'سعر البيع'}
          currency={variant.currency}
          valueMinor={variant.priceMinor}
          onValueChange={(priceMinor) => set({ priceMinor })}
          error={errors[k('price')]}
          className="flex-1"
        />
        {currencies.length > 1 ? (
          <Select
            label={titled ? `عملة سعر «${label}»` : 'العملة'}
            value={variant.currency}
            onChange={(event) =>
              set({
                currency: event.target.value as CurrencyCode,
                priceMinor: null,
                minPriceMinor: null,
                barcodes: variant.barcodes.map((b) => ({ ...b, packPriceMinor: null })),
              })
            }
            className="w-28"
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {CURRENCIES[code].symbolAr}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <MoneyField
        key={`min-${variant.currency}`}
        name={k('minPriceMinor')}
        label="السعر الأدنى للمفاصلة"
        hint="الكاشير ينزل حتى هذا السعر دون رمز المدير."
        currency={variant.currency}
        valueMinor={variant.minPriceMinor}
        onValueChange={(minPriceMinor) => set({ minPriceMinor })}
        error={errors[k('minPriceMinor')]}
      />
      {variant.currency !== 'SYP' ? (
        <p className="text-sm text-ink-muted sm:col-span-2">
          يبقى السعر بالدولار، ويحوّله الكاشير إلى الليرة بسعر الصرف الحالي عند البيع.
        </p>
      ) : null}
      <NumberField
        name={k('minStockQty')}
        label="الحد الأدنى في الفرع"
        hint="تحته يصلك تنبيه النقص."
        value={variant.minStock}
        onValueChange={(minStock) => set({ minStock })}
        decimals={allowsFraction ? 3 : 0}
        unit={unitSymbol}
        error={errors[k('minStockQty')]}
      />
    </div>
  );

  return (
    <fieldset className="flex flex-col gap-4 border-t border-line pt-4 first:border-0 first:pt-0">
      {titled ? <legend className="mb-3 font-semibold text-ink">{label}</legend> : null}
      {errors[k('attributes')] ? <p className="text-sm text-danger-ink">{errors[k('attributes')]}</p> : null}
      {priceRow}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">الباركودات</p>
        {variant.barcodes.length === 0 ? (
          <p className="text-sm text-ink-muted">لا باركود بعد. امسحه هنا أو ولّد باركوداً داخلياً.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {variant.barcodes.map((barcode) => (
              <BarcodeRow
                key={barcode.key}
                barcode={barcode}
                currency={variant.currency}
                errors={errors}
                onChange={setBarcode}
                onRemove={() => set({ barcodes: variant.barcodes.filter((b) => b.key !== barcode.key) })}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <TextField
            label={titled ? `باركود جديد لـ«${label}»` : 'باركود جديد'}
            hideLabel
            placeholder="امسح الباركود أو اكتبه"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={newCode}
            onChange={(event) => {
              setNewCode(event.target.value);
              setAddError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addCode();
              }
            }}
            error={addError?.text}
            startAdornment={<BarcodeIcon className="ms-3.5 text-ink-subtle" />}
            className="min-w-48 flex-1"
          />
          <Button variant="secondary" icon={<AddIcon />} loading={checking} onClick={() => void addCode()}>
            أضف
          </Button>
          <Button
            variant="ghost"
            onClick={() => set({ barcodes: [...variant.barcodes, newBarcode('internal')] })}
          >
            ولّد باركوداً داخلياً
          </Button>
        </div>
        {addError?.productId ? (
          <Link to={`/products/${addError.productId}`} className={`${textLinkClass} text-sm`}>
            افتح المنتج الذي عليه هذا الباركود
          </Link>
        ) : null}
      </div>
    </fieldset>
  );
}

interface BarcodeRowProps {
  barcode: BarcodeDraft;
  currency: CurrencyCode;
  errors: FieldErrors;
  onChange: (barcode: BarcodeDraft) => void;
  onRemove: () => void;
}

/** A barcode with its pack: «كرتونة» of 12 pieces at its own price, or 12 × the unit price. */
function BarcodeRow({ barcode, currency, errors, onChange, onRemove }: BarcodeRowProps) {
  const k = (field: string) => `b.${barcode.key}.${field}`;
  const name = barcode.code || `${INTERNAL_BARCODE_PREFIX}…`;
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line px-3 py-2">
      <div className="flex items-center gap-2">
        <BarcodeIcon className="text-ink-muted" />
        {barcode.code ? (
          <bdi dir="ltr" className="num font-semibold text-ink">
            {barcode.code}
          </bdi>
        ) : (
          <span className="text-ink-muted">يُولَّد عند الحفظ، ويبدأ بـ{INTERNAL_BARCODE_PREFIX}</span>
        )}
        {barcode.kind === 'internal' ? <Badge tone="brand">داخلي</Badge> : null}
        <IconButton
          size="sm"
          label={`أزل الباركود ${name}`}
          icon={<DeleteIcon />}
          onClick={onRemove}
          className="ms-auto"
        />
      </div>
      {errors[k('code')] ? (
        <p role="alert" className="text-sm text-danger-ink">
          {errors[k('code')]}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <NumberField
          name={k('packQty')}
          label="عدد القطع فيه"
          value={barcode.packCount}
          onValueChange={(packCount) => onChange({ ...barcode, packCount })}
          error={errors[k('packQty')]}
        />
        <TextField
          name={k('packName')}
          label="اسم العبوة"
          placeholder="كرتونة"
          value={barcode.packName}
          onChange={(event) => onChange({ ...barcode, packName: event.target.value })}
          error={errors[k('packName')]}
        />
        <MoneyField
          key={currency}
          name={k('packPriceMinor')}
          label="سعر العبوة"
          placeholder="بعدد القطع"
          currency={currency}
          valueMinor={barcode.packPriceMinor}
          onValueChange={(packPriceMinor) => onChange({ ...barcode, packPriceMinor })}
          error={errors[k('packPriceMinor')]}
        />
      </div>
    </li>
  );
}

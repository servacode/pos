import { memo, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CURRENCIES, INTERNAL_BARCODE_PREFIX, barcodeCodeSchema, type CurrencyCode } from '@serva/core';
import {
  AddIcon,
  Badge,
  BarcodeIcon,
  Button,
  CONTROL_HEIGHT,
  DeleteIcon,
  ExpandIcon,
  IconButton,
  MoneyField,
  NumberField,
  Select,
  SparklesIcon,
  TextField,
  cn,
  textLinkClass,
  useDensity,
} from '@serva/ui';
import { ApiError } from '../../lib/api';
import { lookupBarcode } from '../catalog/api';
import { barcodeOf } from '../catalog/catalog';
import { newBarcode, variantLabel, type BarcodeDraft, type FieldErrors, type VariantDraft } from './form';

interface VariantBlockProps {
  variant: VariantDraft;
  /**
   * The product has options: the variant is one row of the VariantGrid, named by its values,
   * instead of the simple product's full block.
   */
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

// The grid of a product with options (هوية 4 › DataTable, as a form): the variant's name, then its
// prices and minimum, one column each. On a phone it scrolls sideways inside its card and the
// variant's name stays in view at the start.
const GRID_COLUMNS = {
  one: 'grid-cols-[minmax(6rem,auto)_minmax(8.5rem,1.3fr)_repeat(2,minmax(7.5rem,1fr))_minmax(6.5rem,1fr)]',
  many: 'grid-cols-[minmax(6rem,auto)_minmax(8.5rem,1.3fr)_minmax(5.5rem,auto)_repeat(2,minmax(7.5rem,1fr))_minmax(6.5rem,1fr)]',
} as const;

/** The column heads of the VariantGrid: seen only; every field keeps its own full name. */
const GRID_HEADS = ['سعر البيع', 'الأدنى للمفاصلة', 'سعر الجملة', 'الحد الأدنى'] as const;

/**
 * The size × colour variants of a product, one row each (VariantBlock with `titled`): the prices
 * and the branch minimum of every piece side by side, its barcodes under them.
 */
export function VariantGrid({
  currencies,
  children,
}: {
  currencies: readonly CurrencyCode[];
  children: ReactNode;
}) {
  const many = currencies.length > 1;
  return (
    // `relative` keeps the fields' hidden labels inside the sideways scroll on a phone.
    <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
      <div className={cn('grid gap-x-3', many ? GRID_COLUMNS.many : GRID_COLUMNS.one)}>
        <div
          aria-hidden="true"
          className="col-span-full grid grid-cols-subgrid items-end border-b border-line pb-2 text-xs font-semibold text-ink-subtle"
        >
          <span className="sticky start-0 z-1 bg-surface">المتغيّر</span>
          <span>{GRID_HEADS[0]}</span>
          {many ? <span>العملة</span> : null}
          <span>{GRID_HEADS[1]}</span>
          <span>{GRID_HEADS[2]}</span>
          <span>{GRID_HEADS[3]}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * One variant's selling data (kit admin/ProductCard › الأسعار والوحدات، الباركودات): the shelf price
 * in pounds or dollars, the lowest bargaining price, the branch minimum, and its barcodes, which a
 * scanner adds by itself (it types the code and Enter).
 */
export const VariantBlock = memo(function VariantBlock({
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
  // A row that already has a barcode keeps its scan box folded until asked for («باركود آخر»).
  const [adding, setAdding] = useState(false);
  const labelId = useId();
  const density = useDensity();
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

  const price = (
    <MoneyField
      key={variant.currency}
      name={k('price')}
      label={titled ? `سعر البيع لـ«${label}»` : 'سعر البيع'}
      hideLabel={titled}
      currency={variant.currency}
      valueMinor={variant.priceMinor}
      onValueChange={(priceMinor) => set({ priceMinor })}
      error={errors[k('price')]}
      className="min-w-0 flex-1"
    />
  );
  const currency =
    currencies.length > 1 ? (
      <Select
        label={titled ? `عملة سعر «${label}»` : 'العملة'}
        hideLabel={titled}
        value={variant.currency}
        onChange={(event) =>
          set({
            currency: event.target.value as CurrencyCode,
            priceMinor: null,
            minPriceMinor: null,
            wholesalePriceMinor: null,
            barcodes: variant.barcodes.map((b) => ({ ...b, packPriceMinor: null })),
          })
        }
        className={titled ? undefined : 'w-28'}
      >
        {currencies.map((code) => (
          <option key={code} value={code}>
            {CURRENCIES[code].symbolAr}
          </option>
        ))}
      </Select>
    ) : null;
  const minPrice = (
    <MoneyField
      key={`min-${variant.currency}`}
      name={k('minPriceMinor')}
      label="السعر الأدنى للمفاصلة"
      hideLabel={titled}
      hint={titled ? undefined : 'الكاشير ينزل حتى هذا السعر دون رمز المدير.'}
      currency={variant.currency}
      valueMinor={variant.minPriceMinor}
      onValueChange={(minPriceMinor) => set({ minPriceMinor })}
      error={errors[k('minPriceMinor')]}
    />
  );
  const wholesale = (
    <MoneyField
      key={`wholesale-${variant.currency}`}
      name={k('wholesalePriceMinor')}
      label="سعر الجملة (اختياري)"
      hideLabel={titled}
      hint={titled ? undefined : 'يُباع به عند اختيار «سعر الجملة» على الكاشير أو لزبون جملة.'}
      currency={variant.currency}
      valueMinor={variant.wholesalePriceMinor ?? null}
      onValueChange={(wholesalePriceMinor) => set({ wholesalePriceMinor })}
      error={errors[k('wholesalePriceMinor')]}
    />
  );
  const minStock = (
    <NumberField
      name={k('minStockQty')}
      label="الحد الأدنى في الفرع"
      hideLabel={titled}
      hint={titled ? undefined : 'تحته يصلك تنبيه النقص.'}
      value={variant.minStock}
      onValueChange={(minStock) => set({ minStock })}
      decimals={allowsFraction ? 3 : 0}
      unit={unitSymbol}
      error={errors[k('minStockQty')]}
    />
  );
  const attributesError = errors[k('attributes')] ? (
    <p className="text-sm text-danger-ink">{errors[k('attributes')]}</p>
  ) : null;

  const showAdd = !titled || variant.barcodes.length === 0 || adding || newCode !== '' || addError !== null;
  const barcodes = (
    <div className="flex flex-col gap-2">
      {variant.barcodes.length === 0 ? (
        titled ? null : (
          <p className="text-sm text-ink-muted">لا باركود بعد. امسحه هنا أو ولّد باركوداً داخلياً.</p>
        )
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <ul className="flex min-w-0 flex-1 basis-80 flex-col gap-2">
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
          {showAdd ? null : (
            <Button variant="ghost" icon={<AddIcon />} onClick={() => setAdding(true)}>
              باركود آخر
            </Button>
          )}
        </div>
      )}
      {showAdd ? (
        <div className="flex flex-wrap items-start gap-2">
          <TextField
            label={titled ? `باركود جديد لـ«${label}»` : 'باركود جديد'}
            hideLabel
            placeholder="امسح الباركود أو اكتبه"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            // Opened with «باركود آخر»: the scanner can type at once.
            autoFocus={adding && newCode === ''}
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
            startAdornment={<BarcodeIcon className="ms-3 text-ink-subtle" />}
            className="min-w-48 flex-1"
          />
          <Button variant="secondary" icon={<AddIcon />} loading={checking} onClick={() => void addCode()}>
            أضف
          </Button>
          <Button
            variant="ghost"
            icon={<SparklesIcon />}
            onClick={() => set({ barcodes: [...variant.barcodes, newBarcode('internal')] })}
          >
            ولّد باركوداً داخلياً
          </Button>
        </div>
      ) : null}
      {addError?.productId ? (
        <Link to={`/products/${addError.productId}`} className={cn(textLinkClass, 'self-start text-sm')}>
          افتح المنتج الذي عليه هذا الباركود
        </Link>
      ) : null}
    </div>
  );

  if (titled) {
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        className="col-span-full grid grid-cols-subgrid items-start gap-y-3 border-b border-line py-4 last:border-b-0"
      >
        <span
          id={labelId}
          className={cn(
            'sticky start-0 z-1 flex items-center bg-surface pe-2 font-semibold text-ink',
            CONTROL_HEIGHT[density],
          )}
        >
          {label}
        </span>
        {price}
        {currency}
        {minPrice}
        {wholesale}
        {minStock}
        {attributesError ? <div className="col-start-2 -col-end-1">{attributesError}</div> : null}
        <div className="col-start-2 -col-end-1">{barcodes}</div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {attributesError}
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2">
          {price}
          {currency}
        </div>
        {minPrice}
        {wholesale}
        {minStock}
        {variant.currency !== 'SYP' ? (
          <p className="text-sm text-ink-muted sm:col-span-2">
            يبقى السعر بالدولار، ويحوّله الكاشير إلى الليرة بسعر الصرف الحالي عند البيع.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold text-ink">الباركودات</h3>
          <p className="text-sm text-ink-muted">
            امسحه بالماسح، أو اكتب رقمه واضغط <kbd className="font-sans font-semibold">Enter</kbd>.
          </p>
        </div>
        {barcodes}
      </div>
    </div>
  );
});

interface BarcodeRowProps {
  barcode: BarcodeDraft;
  currency: CurrencyCode;
  errors: FieldErrors;
  onChange: (barcode: BarcodeDraft) => void;
  onRemove: () => void;
}

/**
 * A barcode with its pack: «كرتونة» of 12 pieces at its own price, or 12 × the unit price. A code
 * of one piece keeps the pack's fields folded; a pack, or a pack field with an error, shows them.
 */
function BarcodeRow({ barcode, currency, errors, onChange, onRemove }: BarcodeRowProps) {
  const k = (field: string) => `b.${barcode.key}.${field}`;
  const packId = useId();
  const [opened, setOpened] = useState(false);
  const name = barcode.code || `${INTERNAL_BARCODE_PREFIX}…`;
  const isPack = barcode.packCount !== '1' || barcode.packName !== '' || barcode.packPriceMinor !== null;
  const packError = Boolean(errors[k('packQty')] || errors[k('packName')] || errors[k('packPriceMinor')]);
  const showPack = opened || isPack || packError;
  return (
    <li className="flex flex-col gap-3 rounded-control border border-line bg-surface px-3 py-2">
      <div className="flex min-h-9 flex-wrap items-center gap-x-2.5 gap-y-1">
        <BarcodeIcon className="text-ink-subtle" />
        {barcode.code ? (
          <bdi dir="ltr" className="num font-semibold text-ink">
            {barcode.code}
          </bdi>
        ) : (
          <span className="text-sm text-ink-muted">يُولَّد عند الحفظ، ويبدأ بـ{INTERNAL_BARCODE_PREFIX}</span>
        )}
        {barcode.kind === 'internal' ? <Badge tone="brand">داخلي</Badge> : null}
        <span className="ms-auto flex items-center gap-1">
          {isPack || packError ? null : (
            <Button
              variant="ghost"
              size="xs"
              aria-expanded={opened}
              aria-controls={opened ? packId : undefined}
              onClick={() => setOpened((open) => !open)}
            >
              عبوة بعدة قطع
              <ExpandIcon
                size={16}
                className={cn('transition-transform duration-120 ease-standard', opened && 'rotate-180')}
              />
            </Button>
          )}
          <IconButton size="sm" label={`أزل الباركود ${name}`} icon={<DeleteIcon />} onClick={onRemove} />
        </span>
      </div>
      {errors[k('code')] ? (
        <p role="alert" className="text-sm text-danger-ink">
          {errors[k('code')]}
        </p>
      ) : null}
      {showPack ? (
        <div id={packId} className="grid grid-cols-1 gap-3 border-t border-line pt-3 pb-1 sm:grid-cols-3">
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
      ) : null}
    </li>
  );
}

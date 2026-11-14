import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { catalogOptionsOf } from '@serva/core';
import type { CatalogOptions, Category, CurrencyCode, ProductDetail, TaxRate, Unit } from '@serva/core';
import {
  Alert,
  ArchiveIcon,
  BackIcon,
  Badge,
  BarcodeIcon,
  Button,
  CameraIcon,
  Card,
  CategoriesIcon,
  CheckIcon,
  Dialog,
  GiftIcon,
  PageHeader,
  PrintIcon,
  ProductsIcon,
  RetryIcon,
  Select,
  ShirtIcon,
  Skeleton,
  SkeletonText,
  StatusChip,
  StockIcon,
  StoreIcon,
  Switch,
  TextField,
  UndoIcon,
  cn,
  formatQuantity,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { dayText, isoDay, zonedDateTime } from '../../lib/dates';
import {
  createProduct,
  getProduct,
  listCategories,
  listTaxRates,
  listUnits,
  setProductArchived,
  updateProduct,
} from '../catalog/api';
import { saveCatalogOptions } from '../store/api';
import { barcodeOf, canManageCatalog, categoryOptionLabel, categoryTree } from '../catalog/catalog';
import {
  applyAxes,
  buildCreate,
  buildUpdate,
  changedParts,
  draftFromDetail,
  emptyDraft,
  errorsFromServer,
  isEmptyUpdate,
  validateBuilt,
  checkPendingCodes,
  withGeneratedBarcodes,
  type Axis,
  type FieldErrors,
  type ProductDraft,
  type VariantDraft,
} from './form';
import { normalizeArabic, type SectorKey } from '@serva/core';
import {
  MODIFIER_SECTORS,
  RENTAL_SECTORS,
  SERIAL_SECTORS,
  storeSells,
  WEIGHED_SECTORS,
} from '../../lib/sectors';
import { ModifiersEditor } from './ModifiersEditor';
import { ImagesEditor } from './ImagesEditor';
import { RecipeSection } from './RecipeSection';
import { ShopTextSection } from './ShopTextSection';
import { BulkApply } from './BulkApply';
import { OptionsEditor } from './OptionsEditor';
import { ButtonLink, Fact, SectionCard } from './parts';
import { StockGrid } from './StockGrid';
import { UnitsDialog } from './UnitsDialog';
import { VariantBlock, VariantGrid } from './VariantBlock';

interface Lookups {
  units: Unit[];
  taxRates: TaxRate[];
  categories: Category[];
}

/** The order the fields are focused in when several are wrong. */
const TOP_FIELDS = [
  'nameAr',
  'nameEn',
  'categoryId',
  'brand',
  'season',
  'genericName',
  'requiresPrescription',
  'controlled',
  'requiresExpiry',
  'tracksSerial',
  'rentable',
  'warrantyMonths',
  'type',
  'unitId',
  'taxRateId',
  'sellOnPos',
  'modifiers',
];

/** No groups yet: one array for every render, so the memoized editor is not redrawn for nothing. */
const NO_MODIFIERS: NonNullable<ProductDraft['modifiers']> = [];

/** The two columns of the card from 1280 px: the product's parts, and its status at the side. */
const COLUMNS = 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]';

/** «في كل الفروع»: the stock of every live variant, summed per branch. */
function StockByBranch({ product, numberFormat }: { product: ProductDetail; numberFormat: 'latn' | 'arab' }) {
  const branches = new Map<string, { name: string; qty: number }>();
  for (const variant of product.variants) {
    if (variant.archivedAt) continue;
    for (const stock of variant.stock) {
      const entry = branches.get(stock.branchId) ?? { name: stock.branchName, qty: 0 };
      entry.qty += stock.qty;
      branches.set(stock.branchId, entry);
    }
  }
  if (branches.size === 0) return <p className="text-sm text-ink-muted">لا مخزون مسجّل بعد.</p>;
  const total = [...branches.values()].reduce((sum, branch) => sum + branch.qty, 0);
  return (
    <dl className="-my-2.5 flex flex-col divide-y divide-line">
      {[...branches.entries()].map(([id, { name, qty }]) => (
        <div key={id} className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-sm text-ink">{name}</dt>
          <dd className={cn('num font-semibold', qty < 0 ? 'text-danger-ink' : 'text-ink')}>
            {formatQuantity(qty, numberFormat)}
          </dd>
        </div>
      ))}
      {branches.size > 1 ? (
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-sm font-semibold text-ink-muted">في كل الفروع معاً</dt>
          <dd className={cn('num font-bold', total < 0 ? 'text-danger-ink' : 'text-ink')}>
            {formatQuantity(total, numberFormat)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Back to the list, above the title. */
function BackToProducts() {
  return (
    <nav aria-label="مسار الصفحة">
      <Link
        to="/products"
        className="inline-flex min-h-8 items-center gap-1.5 rounded-small text-sm font-semibold text-ink-muted transition-colors duration-120 ease-standard hover:text-ink"
      >
        <BackIcon size={16} />
        المنتجات
      </Link>
    </nav>
  );
}

/** A new product and a saved one are different cards: a fresh state for each address. */
export function ProductRoute() {
  const { id } = useParams();
  return <ProductPage key={id} />;
}

/**
 * «بطاقة المنتج» (12 › بطاقة المنتج; kit admin/ProductCard): the basic data, the price in pounds or
 * dollars, barcodes, the size × colour matrix, the branch minimum and archiving. New at
 * /products/new (?barcode= from an unknown scan), existing at /products/{id}.
 */
export function ProductPage() {
  // The card keeps its state below the shell, so typing in it never redraws the menu and the top bar.
  return (
    <AppShell>
      <ProductCard />
    </AppShell>
  );
}

function ProductCard() {
  const { id = null } = useParams();
  const productId = id === 'new' ? null : id;
  const me = useMe();
  const fits = (sectors: readonly SectorKey[]) => storeSells(me.tenant.sectors, sectors);
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const canManage = canManageCatalog(me);
  const formRef = useRef<HTMLFormElement>(null);

  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // A price of 0 is saved only after the owner says the item is free.
  const [askFree, setAskFree] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const freeOk = useRef(false);
  // «ولّد باركود عند الحفظ»: the store's setting (catalogOptions), saved when it is switched
  const [options, setOptions] = useState<CatalogOptions>(() => catalogOptionsOf(me.settings.catalogOptions));
  const autoBarcode = options.autoBarcode;
  const setAutoBarcode = (on: boolean) => {
    const next = { ...options, autoBarcode: on };
    setOptions(next);
    saveCatalogOptions(next)
      .then((store) => setOptions(catalogOptionsOf(store.catalogOptions)))
      .catch((error: unknown) => setNotice(errorMessage(error)));
  };
  const [notice, setNotice] = useState<string | null>(
    (location.state as { saved?: boolean } | null)?.saved
      ? 'حُفظ المنتج، ويصل إلى أجهزة الكاشير مع أول اتصال.'
      : null,
  );
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<'ask' | 'busy' | null>(null);
  const [unitsOpen, setUnitsOpen] = useState(false);

  const { enabledCurrencies, baseCurrency } = me.settings;
  const currencies: CurrencyCode[] = useMemo(
    () => (enabledCurrencies.length ? enabledCurrencies : [baseCurrency]),
    [enabledCurrencies, baseCurrency],
  );
  const initialBarcode = search.get('barcode');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [units, taxRates, categories, detail] = await Promise.all([
        listUnits(),
        listTaxRates(),
        listCategories(),
        productId ? getProduct(productId) : Promise.resolve(null),
      ]);
      setLookups({ units: units.items, taxRates: taxRates.items, categories: categories.items });
      setProduct(detail);
      if (detail) setDraft(draftFromDetail(detail));
      else {
        const piece = units.items.find((u) => !u.allowsFraction && !u.archivedAt) ?? units.items[0];
        // A new product starts with the store's default tax rate (الضرائب), when it chose one
        const defaultBp = taxRates.defaultRateBp ?? 0;
        const defaultTax =
          defaultBp > 0 ? taxRates.items.find((t) => !t.archivedAt && t.rateBp === defaultBp) : undefined;
        setDraft({
          ...emptyDraft({
            currency: me.settings.baseCurrency,
            unitId: piece?.id ?? '',
            barcode: initialBarcode ? barcodeOf(initialBarcode) : undefined,
          }),
          taxRateId: defaultTax?.id ?? '',
        });
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [productId, initialBarcode, me.settings.baseCurrency]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stable across renders (they only call the state setters), so the memoized parts of the card
  // (OptionsEditor, VariantBlock, ImagesEditor, ModifiersEditor) skip a render while another field is
  // typed in.
  const update = useCallback((patch: Partial<ProductDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  }, []);

  const updateVariant = useCallback(
    (variant: VariantDraft) =>
      setDraft((current) =>
        current
          ? { ...current, variants: current.variants.map((v) => (v.key === variant.key ? variant : v)) }
          : current,
      ),
    [],
  );

  const setAxes = useCallback(
    (axes: Axis[]) =>
      setDraft((current) =>
        current ? { ...current, axes, variants: applyAxes(current.variants, axes) } : current,
      ),
    [],
  );

  const setModifiers = useCallback(
    (modifiers: NonNullable<ProductDraft['modifiers']>) => update({ modifiers }),
    [update],
  );

  const variants = draft?.variants;
  const axes = draft?.axes;
  const codesInCard = useMemo(
    () => new Set((variants ?? []).flatMap((v) => v.barcodes.map((b) => b.code)).filter(Boolean)),
    [variants],
  );
  const optionValues = useMemo(() => [...new Set((axes ?? []).flatMap((a) => a.values))], [axes]);

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const { _form, ...fields } = next;
    setFormError(_form ?? (Object.keys(fields).length ? 'راجع الخانات المعلَّمة بالأحمر.' : null));
    const keys = Object.keys(fields);
    const first = [
      ...TOP_FIELDS.filter((f) => keys.includes(f)),
      ...keys.filter((k) => !TOP_FIELDS.includes(k)),
    ][0];
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    setNotice(null);
    setConflict(null);
    setFormError(null);
    const toSave: ProductDraft =
      autoBarcode && draft.axes.length > 0
        ? { ...draft, variants: withGeneratedBarcodes(draft.variants) }
        : draft;
    const built = product ? buildUpdate(toSave, product) : buildCreate(toSave);
    const clientErrors = {
      ...validateBuilt(built, product ? 'update' : 'create'),
      ...checkPendingCodes(draft.variants),
    };
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors);
      return;
    }
    if (product && 'version' in built.body && isEmptyUpdate(built.body)) {
      setNotice('لا تغييرات لحفظها.');
      return;
    }
    const zero = draft.variants.filter((v) => !v.archived && v.priceMinor === 0);
    if (zero.length > 0 && !freeOk.current) {
      setAskFree(true);
      setFormError(
        zero.length === 1 && draft.variants.length === 1
          ? 'سعر البيع صفر: سيُباع المنتج مجاناً. هل هذا مقصود؟'
          : `سعر البيع صفر في ${String(zero.length)} من المتغيّرات: ستُباع مجاناً. هل هذا مقصود؟`,
      );
      return;
    }
    freeOk.current = false;
    setAskFree(false);
    setErrors({});
    setSaving(true);
    try {
      if (product && 'version' in built.body) {
        const saved = await updateProduct(product.id, built.body);
        setProduct(saved);
        setDraft(draftFromDetail(saved));
        setNotice('حُفظ المنتج، ويصل إلى أجهزة الكاشير مع أول اتصال.');
      } else if (!('version' in built.body)) {
        const saved = await createProduct(built.body);
        void navigate(`/products/${saved.id}`, { replace: true, state: { saved: true } });
      }
    } catch (error) {
      if (product && error instanceof ApiError && error.code === 'stale_version') {
        await reloadAfterConflict(product);
      } else if (error instanceof ApiError && error.fields && Object.keys(error.fields).length) {
        showErrors(errorsFromServer(error.fields, built.sent));
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadAfterConflict(before: ProductDetail) {
    try {
      const fresh = await getProduct(before.id);
      const parts = changedParts(before, fresh);
      setProduct(fresh);
      setDraft(draftFromDetail(fresh));
      setConflict(
        `غيّر أحدٌ هذا المنتج قبل قليل${parts.length ? ` (${parts.join('، ')})` : ''}. ` +
          'حمّلنا آخر نسخة: أعد تعديلك عليها ثم احفظ.',
      );
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function toggleArchive(archived: boolean) {
    if (!product) return;
    setArchiving('busy');
    setFormError(null);
    try {
      const saved = await setProductArchived(product.id, archived);
      setProduct(saved);
      setDraft(draftFromDetail(saved));
      setNotice(archived ? 'أُرشف المنتج، ولم يعد يظهر على الكاشير.' : 'عاد المنتج إلى البيع.');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setArchiving(null);
    }
  }

  const title = product?.nameAr ?? 'منتج جديد';
  const digits = me.settings.numberFormat;

  if (loadError || !lookups || !draft) {
    return (
      <>
        <title>{`${title} · SERFA`}</title>
        <div className="flex flex-col gap-6">
          <BackToProducts />
          {loadError ? (
            <Card className="flex flex-col items-start gap-4">
              <Alert tone="error" className="self-stretch">
                {loadError}
              </Alert>
              <Button variant="secondary" icon={<RetryIcon />} onClick={() => void load()}>
                أعد المحاولة
              </Button>
            </Card>
          ) : (
            <div aria-busy="true" className="flex flex-col gap-6">
              <span className="sr-only">نحمّل المنتج…</span>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <div className={COLUMNS}>
                <div className="flex flex-col gap-6">
                  <Card>
                    <SkeletonText lines={5} />
                  </Card>
                  <Card>
                    <SkeletonText lines={4} />
                  </Card>
                </div>
                <Card>
                  <SkeletonText lines={4} />
                </Card>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  const unit = lookups.units.find((u) => u.id === draft.unitId);
  const fractionUnit = (fraction: boolean) =>
    lookups.units.find((u) => u.allowsFraction === fraction && !u.archivedAt && u.isSystem) ??
    lookups.units.find((u) => u.allowsFraction === fraction && !u.archivedAt);
  const liveVariants = draft.variants.filter((v) => !v.archived);
  const archivedVariants = draft.variants.filter((v) => v.archived);
  const titled = draft.axes.length > 0 && liveVariants.some((v) => v.attributes.length > 0);
  const tree = categoryTree(lookups.categories.filter((c) => !c.archivedAt || c.id === draft.categoryId));
  const needle = normalizeArabic(categoryQuery.trim());
  const shownTree = needle
    ? tree.filter(
        (n) => n.category.id === draft.categoryId || normalizeArabic(n.category.name).includes(needle),
      )
    : tree;
  const archived = Boolean(product?.archivedAt);
  const barcodeCount = liveVariants.reduce((sum, v) => sum + v.barcodes.length, 0);

  const variantBlock = (variant: VariantDraft) => (
    <VariantBlock
      key={variant.key}
      variant={variant}
      titled={titled}
      productId={product?.id ?? null}
      currencies={currencies}
      unitSymbol={unit?.symbol ?? ''}
      allowsFraction={unit?.allowsFraction ?? false}
      errors={errors}
      codesInCard={codesInCard}
      onChange={updateVariant}
    />
  );

  return (
    <>
      <title>{`${title} · SERFA`}</title>
      <form
        ref={formRef}
        noValidate
        onSubmit={save}
        // A field reached with Tab scrolls clear of the sticky top bar and the save bar.
        className="flex flex-col gap-6 [&_:is(input,select,textarea,button)]:scroll-my-28"
      >
        <div className="flex flex-col gap-2">
          <BackToProducts />
          <PageHeader
            title={title}
            description={
              product ? (
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  {product.status === 'temporary' ? <Badge tone="warning">بانتظار المراجعة</Badge> : null}
                  {archived ? <Badge>مؤرشف</Badge> : null}
                  {!archived && product.status !== 'temporary' ? <StatusChip status="active" /> : null}
                  {!product.sellOnPos ? <Badge>لا يظهر على الكاشير</Badge> : null}
                </span>
              ) : (
                'الاسم والسعر والباركود تكفي ليُباع على الكاشير، والباقي حين تحتاجه.'
              )
            }
            actions={
              canManage && product ? (
                <>
                  {!archived ? (
                    <ButtonLink to={`/labels?product=${product.id}`} icon={<PrintIcon />}>
                      اطبع الملصقات
                    </ButtonLink>
                  ) : null}
                  {archived ? (
                    <Button
                      variant="secondary"
                      icon={<UndoIcon />}
                      loading={archiving === 'busy'}
                      onClick={() => void toggleArchive(false)}
                    >
                      أعد المنتج إلى البيع
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={<ArchiveIcon />} onClick={() => setArchiving('ask')}>
                      أرشف
                    </Button>
                  )}
                </>
              ) : undefined
            }
          />
        </div>

        <div className={COLUMNS}>
          <div className="flex min-w-0 flex-col gap-6">
            <fieldset disabled={!canManage} className="flex min-w-0 flex-col gap-6">
              <SectionCard
                title="البيانات الأساسية"
                icon={<ProductsIcon />}
                description="الاسم كما يظهر على الكاشير والإيصال والملصق."
              >
                <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
                  <TextField
                    name="nameAr"
                    label="اسم المنتج"
                    value={draft.nameAr}
                    onChange={(event) => update({ nameAr: event.target.value })}
                    error={errors.nameAr}
                    className="sm:col-span-2"
                  />
                  <TextField
                    name="nameEn"
                    label="الاسم بالإنجليزية (اختياري)"
                    dir="ltr"
                    value={draft.nameEn}
                    onChange={(event) => update({ nameEn: event.target.value })}
                    error={errors.nameEn}
                  />
                  <TextField
                    name="brand"
                    label="الماركة (اختياري)"
                    value={draft.brand}
                    onChange={(event) => update({ brand: event.target.value })}
                    error={errors.brand}
                  />
                  {fits(['clothing']) || draft.season ? (
                    <TextField
                      name="season"
                      label="الموسم/التشكيلة (اختياري)"
                      hint="مثل صيف 2026: تفلتر به القائمة والتقارير"
                      value={draft.season ?? ''}
                      onChange={(event) => update({ season: event.target.value })}
                      error={errors.season}
                    />
                  ) : null}
                  {fits(['pharmacy']) || draft.genericName ? (
                    <TextField
                      name="genericName"
                      label="الاسم العلمي (للأدوية، اختياري)"
                      hint="الكاشير يجد الدواء به أيضاً"
                      value={draft.genericName ?? ''}
                      onChange={(event) => update({ genericName: event.target.value })}
                      error={errors.genericName}
                    />
                  ) : null}
                  {fits(['pharmacy']) || draft.requiresPrescription || draft.controlled ? (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-5 border-t border-line pt-5 sm:col-span-2 sm:grid-cols-2">
                      <Switch
                        label="يحتاج وصفة"
                        description="الكاشير يطلب رقم الوصفة واسم الطبيب قبل الدفع."
                        checked={draft.requiresPrescription ?? false}
                        disabled={!canManage}
                        onCheckedChange={(requiresPrescription) => update({ requiresPrescription })}
                      />
                      <Switch
                        label="مراقَب"
                        description="لا يبيعه إلا الصيدلاني، ويدخل سجل الأدوية المراقبة."
                        checked={draft.controlled ?? false}
                        disabled={!canManage}
                        onCheckedChange={(controlled) => update({ controlled })}
                      />
                    </div>
                  ) : null}
                  {fits(['pharmacy', 'medical_supplies']) || draft.requiresExpiry ? (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-5 border-t border-line pt-5 sm:col-span-2 sm:grid-cols-2">
                      <Switch
                        label="يتطلب صلاحية"
                        description="فاتورة الشراء لا تقبل هذا الصنف بلا تاريخ انتهاء، ويحكم الكاشير على دفعاته."
                        checked={draft.requiresExpiry ?? false}
                        disabled={!canManage}
                        onCheckedChange={(requiresExpiry) => update({ requiresExpiry })}
                      />
                    </div>
                  ) : null}
                  {fits(SERIAL_SECTORS) || draft.tracksSerial || draft.warranty ? (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-5 border-t border-line pt-5 sm:col-span-2 sm:grid-cols-2">
                      <Switch
                        label="له رقم تسلسلي أو IMEI"
                        description="يُستلم ويُباع كل جهاز برقمه، ويُطبع الرقم على الإيصال."
                        checked={draft.tracksSerial ?? false}
                        disabled={!canManage}
                        onCheckedChange={(tracksSerial) => update({ tracksSerial })}
                        className="sm:col-span-2"
                      />
                      {fits(RENTAL_SECTORS) || draft.rentable ? (
                        <Switch
                          label="قابل للتأجير"
                          description="تُؤجَّر قطعه من شاشة التأجير على الصندوق، وتُمنع من البيع وهي عند الزبون."
                          checked={draft.rentable ?? false}
                          disabled={!canManage || !draft.tracksSerial}
                          onCheckedChange={(rentable) => update({ rentable })}
                          className="sm:col-span-2"
                        />
                      ) : null}
                      <TextField
                        name="warrantyMonths"
                        label="الكفالة بالأشهر (اختياري)"
                        inputMode="numeric"
                        dir="ltr"
                        value={draft.warranty ?? ''}
                        disabled={!canManage}
                        onChange={(event) => update({ warranty: event.target.value })}
                        error={errors.warrantyMonths}
                      />
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title={fits(['clothing']) ? 'المقاسات والألوان' : 'الأنواع والخيارات'}
                icon={<ShirtIcon />}
              >
                <OptionsEditor
                  axes={draft.axes}
                  variantCount={liveVariants.length}
                  onChange={setAxes}
                  fashion={fits(['clothing'])}
                />
                {errors.variants ? <p className="text-sm text-danger-ink">{errors.variants}</p> : null}
              </SectionCard>

              <SectionCard
                title={titled ? 'الأسعار والباركودات' : 'السعر والباركود'}
                icon={<BarcodeIcon />}
                description={
                  titled
                    ? fits(['clothing'])
                      ? 'لكل مقاس ولون سعره وباركوده. القطعة الجديدة تبدأ بسعر الأولى.'
                      : 'لكل نوع سعره وباركوده. النوع الجديد يبدأ بسعر الأول.'
                    : 'سعر البيع على الكاشير، والباركودات التي تُمسح له.'
                }
              >
                {titled ? (
                  <>
                    {canManage ? (
                      <BulkApply
                        axes={draft.axes}
                        variants={draft.variants}
                        currency={liveVariants[0]?.currency ?? 'SYP'}
                        autoBarcode={autoBarcode}
                        onAutoBarcode={setAutoBarcode}
                        onChange={(variants) => update({ variants })}
                      />
                    ) : null}
                    <VariantGrid currencies={currencies}>{liveVariants.map(variantBlock)}</VariantGrid>
                    <ul className="flex flex-col gap-1 text-sm text-ink-subtle">
                      <li>الأدنى للمفاصلة: الكاشير ينزل حتى هذا السعر دون رمز المدير.</li>
                      <li>سعر الجملة: يُباع به عند اختيار «سعر الجملة» على الكاشير أو لزبون جملة.</li>
                      <li>الحد الأدنى في الفرع: تحته يصلك تنبيه النقص.</li>
                      {liveVariants.some((v) => v.currency !== 'SYP') ? (
                        <li>
                          السعر بالدولار يبقى بالدولار، ويحوّله الكاشير إلى الليرة بسعر الصرف عند البيع.
                        </li>
                      ) : null}
                    </ul>
                  </>
                ) : (
                  liveVariants.map(variantBlock)
                )}
                {archivedVariants.length > 0 ? (
                  <p className="flex items-start gap-2 rounded-control bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                    <ArchiveIcon size={16} className="mt-0.5 text-ink-subtle" />
                    <span>
                      متغيّرات مؤرشفة تبقى في الفواتير السابقة:{' '}
                      {archivedVariants
                        .map((v) => v.attributes.map((a) => a.value).join(' · ') || '—')
                        .join('، ')}
                    </span>
                  </p>
                ) : null}
              </SectionCard>

              <SectionCard
                title="الصور"
                icon={<CameraIcon />}
                description="تظهر في المتجر الإلكتروني؛ الأولى هي الرئيسية."
              >
                <ImagesEditor
                  productId={product?.id ?? null}
                  optionValues={optionValues}
                  disabled={!canManage}
                />
              </SectionCard>

              <ShopTextSection
                productId={product?.id ?? null}
                productName={product?.nameAr ?? ''}
                disabled={!canManage}
              />

              {fits(MODIFIER_SECTORS) || (draft.modifiers?.length ?? 0) > 0 ? (
                <SectionCard
                  title="الإضافات والخيارات (للمطاعم والمقاهي)"
                  icon={<GiftIcon />}
                  description="ما يختاره الزبون مع الطلب، كالحجم والإضافات، وما يزيده على السعر."
                >
                  <ModifiersEditor
                    groups={draft.modifiers ?? NO_MODIFIERS}
                    currency={liveVariants[0]?.currency ?? 'SYP'}
                    disabled={!canManage}
                    onChange={setModifiers}
                  />
                  {errors.modifiers ? <p className="text-sm text-danger-ink">{errors.modifiers}</p> : null}
                </SectionCard>
              ) : null}

              {product && fits(MODIFIER_SECTORS) ? (
                <RecipeSection productId={product.id} disabled={!canManage} />
              ) : null}
            </fieldset>

            {product && draft.type === 'stock' ? (
              <StockGrid product={product} numberFormat={me.settings.numberFormat} />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <fieldset disabled={!canManage} className="flex min-w-0 flex-col gap-6">
              <SectionCard title="الحالة" icon={<StoreIcon />}>
                <Switch
                  label="يُباع على الكاشير"
                  description="أطفئه ليختفي من شاشة البيع ويبقى في المخزون."
                  checked={draft.sellOnPos}
                  disabled={!canManage}
                  onCheckedChange={(sellOnPos) => update({ sellOnPos })}
                />
                {archived ? (
                  <p className="rounded-control bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                    في الأرشيف: لا يظهر على الكاشير حتى تعيده إلى البيع.
                  </p>
                ) : null}
                {product ? (
                  <dl className="-my-2.5 flex flex-col divide-y divide-line border-t border-line">
                    {titled ? (
                      <Fact label="المتغيّرات">
                        <bdi className="num">{liveVariants.length}</bdi>
                      </Fact>
                    ) : null}
                    <Fact label="الباركودات">
                      <bdi className="num">{barcodeCount}</bdi>
                    </Fact>
                    <Fact label="أُضيف في">
                      <bdi className="num">
                        {dayText(isoDay(Date.parse(product.createdAt), me.tenant.timezone), digits)}
                      </bdi>
                    </Fact>
                  </dl>
                ) : null}
              </SectionCard>

              <SectionCard title="التنظيم" icon={<CategoriesIcon />}>
                <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="flex flex-col gap-2">
                    {tree.length > 6 ? (
                      <TextField
                        label="ابحث في التصنيفات"
                        placeholder="اكتب جزءاً من اسم التصنيف"
                        value={categoryQuery}
                        onChange={(event) => setCategoryQuery(event.target.value)}
                      />
                    ) : null}
                    <Select
                      name="categoryId"
                      label="التصنيف"
                      value={draft.categoryId}
                      onChange={(event) => update({ categoryId: event.target.value })}
                      error={errors.categoryId}
                    >
                      <option value="">بلا تصنيف</option>
                      {shownTree.map((node) => (
                        <option key={node.category.id} value={node.category.id}>
                          {categoryOptionLabel(node)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Select
                    name="type"
                    label="نوع المنتج"
                    value={draft.type}
                    onChange={(event) => update({ type: event.target.value as ProductDraft['type'] })}
                    error={errors.type}
                  >
                    <option value="stock">بضاعة لها مخزون</option>
                    <option value="service">خدمة بلا مخزون</option>
                  </Select>
                  <Select
                    name="unitId"
                    label="الوحدة"
                    value={draft.unitId}
                    onChange={(event) => update({ unitId: event.target.value })}
                    error={errors.unitId}
                    hint={
                      canManage ? (
                        <button
                          type="button"
                          onClick={() => setUnitsOpen(true)}
                          className="rounded-small font-semibold text-brand-ink underline-offset-4 hover:underline"
                        >
                          أضف وحدة (علبة، كرتونة، متر…)
                        </button>
                      ) : undefined
                    }
                  >
                    {lookups.units
                      .filter((u) => !u.archivedAt || u.id === draft.unitId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.allowsFraction ? `${u.name} (بالوزن)` : u.name}
                        </option>
                      ))}
                  </Select>
                  <Select
                    name="taxRateId"
                    label="الضريبة"
                    value={draft.taxRateId}
                    onChange={(event) => update({ taxRateId: event.target.value })}
                    error={errors.taxRateId}
                    hint={
                      lookups.taxRates.length === 0 ? (
                        <Link to="/tax-rates" className="font-semibold underline underline-offset-4">
                          لا ضرائب بعد: أضفها من «الضرائب»
                        </Link>
                      ) : undefined
                    }
                  >
                    <option value="">بلا ضريبة</option>
                    {lookups.taxRates
                      .filter((t) => !t.archivedAt || t.id === draft.taxRateId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {`${t.name} ${t.rateBp / 100}%`}
                        </option>
                      ))}
                  </Select>
                  {fits(WEIGHED_SECTORS) || unit?.allowsFraction ? (
                    <Switch
                      label="يُباع بالوزن"
                      description="الكمية على الكاشير بالكيلو، مثل 0.250"
                      checked={unit?.allowsFraction ?? false}
                      disabled={!canManage || !fractionUnit(!(unit?.allowsFraction ?? false))}
                      onCheckedChange={(checked) => {
                        const next = fractionUnit(checked);
                        if (next) update({ unitId: next.id });
                      }}
                      className="sm:col-span-2 xl:col-span-1"
                    />
                  ) : null}
                </div>
              </SectionCard>
            </fieldset>

            {product && draft.type === 'stock' ? (
              <SectionCard title="في كل الفروع" icon={<StockIcon />}>
                <StockByBranch product={product} numberFormat={me.settings.numberFormat} />
              </SectionCard>
            ) : null}
          </div>
        </div>

        {canManage || notice || conflict || formError ? (
          // Saving happens here, so what it answers shows here too, whatever the scroll.
          <div className="sticky bottom-3 z-10 flex flex-col gap-2">
            {notice ? (
              <Alert tone="success" className="shadow-e2">
                {notice}
              </Alert>
            ) : null}
            {conflict ? (
              <Alert tone="error" className="shadow-e2">
                {conflict}
              </Alert>
            ) : null}
            {formError ? (
              <Alert tone="error" className="shadow-e2">
                {formError}
                {askFree ? (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      freeOk.current = true;
                      formRef.current?.requestSubmit();
                    }}
                  >
                    نعم، مجاني: احفظ
                  </Button>
                ) : null}
              </Alert>
            ) : null}
            {canManage ? (
              <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-e3">
                <p className="ps-2 text-sm text-ink-muted max-sm:hidden">
                  {product ? (
                    <>
                      آخر حفظ:{' '}
                      <bdi className="num">
                        {zonedDateTime(product.updatedAt, me.tenant.timezone, digits)}
                      </bdi>
                    </>
                  ) : (
                    'منتج جديد: يصل إلى أجهزة الكاشير بعد الحفظ.'
                  )}
                </p>
                <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
                  <ButtonLink to="/products" variant="ghost">
                    إلغاء
                  </ButtonLink>
                  <Button type="submit" loading={saving} icon={<CheckIcon />} className="max-sm:flex-1">
                    احفظ
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>

      {unitsOpen ? (
        <UnitsDialog
          units={lookups.units}
          onChange={(units) => setLookups((l) => (l ? { ...l, units } : l))}
          onClose={() => setUnitsOpen(false)}
        />
      ) : null}

      <Dialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        size="sm"
        title={`أرشف «${title}»؟`}
        description="يختفي من البيع على الكاشير، وتبقى فواتيره ومخزونه. تستطيع إعادته متى شئت."
        actions={
          <>
            <Button variant="secondary" onClick={() => setArchiving(null)}>
              تراجع
            </Button>
            <Button
              variant="danger"
              icon={<ArchiveIcon />}
              loading={archiving === 'busy'}
              onClick={() => void toggleArchive(true)}
            >
              أرشف المنتج
            </Button>
          </>
        }
      />
    </>
  );
}

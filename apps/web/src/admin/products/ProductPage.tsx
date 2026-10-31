import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Category, CurrencyCode, ProductDetail, TaxRate, Unit } from '@serva/core';
import {
  Alert,
  ArchiveIcon,
  Badge,
  Button,
  Card,
  Dialog,
  RetryIcon,
  Select,
  SkeletonText,
  Switch,
  TextField,
  UndoIcon,
  formatQuantity,
  textLinkClass,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import {
  createProduct,
  getProduct,
  listCategories,
  listTaxRates,
  listUnits,
  setProductArchived,
  updateProduct,
} from '../catalog/api';
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
  type Axis,
  type FieldErrors,
  type ProductDraft,
  type VariantDraft,
} from './form';
import { OptionsEditor } from './OptionsEditor';
import { VariantBlock } from './VariantBlock';

interface Lookups {
  units: Unit[];
  taxRates: TaxRate[];
  categories: Category[];
}

/** The order the fields are focused in when several are wrong. */
const TOP_FIELDS = ['nameAr', 'nameEn', 'categoryId', 'brand', 'type', 'unitId', 'taxRateId', 'sellOnPos'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card className="flex flex-col gap-4">
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <h2 id={id} className="text-lg font-bold text-ink">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

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
  if (branches.size === 0) return <p className="text-ink-muted">لا مخزون مسجّل بعد.</p>;
  return (
    <dl className="flex flex-col divide-y divide-line">
      {[...branches.entries()].map(([id, { name, qty }]) => (
        <div key={id} className="flex items-center justify-between py-2">
          <dt className="text-ink">{name}</dt>
          <dd className={qty < 0 ? 'num font-semibold text-danger-ink' : 'num font-semibold text-ink'}>
            {formatQuantity(qty, numberFormat)}
          </dd>
        </div>
      ))}
    </dl>
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
  const { id = null } = useParams();
  const productId = id === 'new' ? null : id;
  const me = useMe();
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
  const [notice, setNotice] = useState<string | null>(
    (location.state as { saved?: boolean } | null)?.saved
      ? 'حُفظ المنتج، ويصل إلى أجهزة الكاشير مع أول اتصال.'
      : null,
  );
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<'ask' | 'busy' | null>(null);

  const currencies: CurrencyCode[] = me.settings.enabledCurrencies.length
    ? me.settings.enabledCurrencies
    : [me.settings.baseCurrency];
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
        setDraft(
          emptyDraft({
            currency: me.settings.baseCurrency,
            unitId: piece?.id ?? '',
            barcode: initialBarcode ? barcodeOf(initialBarcode) : undefined,
          }),
        );
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [productId, initialBarcode, me.settings.baseCurrency]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<ProductDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  const updateVariant = (variant: VariantDraft) =>
    setDraft((current) =>
      current
        ? { ...current, variants: current.variants.map((v) => (v.key === variant.key ? variant : v)) }
        : current,
    );

  const setAxes = (axes: Axis[]) =>
    setDraft((current) =>
      current ? { ...current, axes, variants: applyAxes(current.variants, axes) } : current,
    );

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
    const built = product ? buildUpdate(draft, product) : buildCreate(draft);
    const clientErrors = validateBuilt(built, product ? 'update' : 'create');
    if (Object.keys(clientErrors).length > 0) {
      showErrors(clientErrors);
      return;
    }
    if (product && 'version' in built.body && isEmptyUpdate(built.body)) {
      setNotice('لا تغييرات لحفظها.');
      return;
    }
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

  if (loadError || !lookups || !draft) {
    return (
      <AppShell>
        <title>{`${title} · Serva POS`}</title>
        <div className="flex flex-col gap-5">
          <Link to="/products" className={`${textLinkClass} self-start`}>
            المنتجات
          </Link>
          {loadError ? (
            <Card className="flex flex-col items-start gap-3">
              <Alert tone="error">{loadError}</Alert>
              <Button variant="secondary" icon={<RetryIcon />} onClick={() => void load()}>
                أعد المحاولة
              </Button>
            </Card>
          ) : (
            <Card aria-busy="true">
              <span className="sr-only">نحمّل المنتج…</span>
              <SkeletonText lines={6} />
            </Card>
          )}
        </div>
      </AppShell>
    );
  }

  const unit = lookups.units.find((u) => u.id === draft.unitId);
  const fractionUnit = (fraction: boolean) =>
    lookups.units.find((u) => u.allowsFraction === fraction && !u.archivedAt && u.isSystem) ??
    lookups.units.find((u) => u.allowsFraction === fraction && !u.archivedAt);
  const liveVariants = draft.variants.filter((v) => !v.archived);
  const archivedVariants = draft.variants.filter((v) => v.archived);
  const titled = draft.axes.length > 0 && liveVariants.some((v) => v.attributes.length > 0);
  const codesInCard = new Set(draft.variants.flatMap((v) => v.barcodes.map((b) => b.code)).filter(Boolean));
  const tree = categoryTree(lookups.categories.filter((c) => !c.archivedAt || c.id === draft.categoryId));
  const archived = Boolean(product?.archivedAt);

  return (
    <AppShell>
      <title>{`${title} · Serva POS`}</title>
      <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <nav aria-label="مسار الصفحة" className="text-sm">
            <Link to="/products" className={textLinkClass}>
              المنتجات
            </Link>
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-ink">{title}</h1>
              {product?.status === 'temporary' ? <Badge tone="warning">بانتظار المراجعة</Badge> : null}
              {archived ? <Badge>مؤرشف</Badge> : null}
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2 max-sm:w-full">
                {product ? (
                  archived ? (
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
                  )
                ) : null}
                <Button type="submit" loading={saving} className="max-sm:flex-1">
                  احفظ
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {conflict ? <Alert tone="error">{conflict}</Alert> : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <fieldset disabled={!canManage} className="flex min-w-0 flex-col gap-5">
          <Section title="الأساسي">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Select
                name="categoryId"
                label="التصنيف"
                value={draft.categoryId}
                onChange={(event) => update({ categoryId: event.target.value })}
                error={errors.categoryId}
              >
                <option value="">بلا تصنيف</option>
                {tree.map((node) => (
                  <option key={node.category.id} value={node.category.id}>
                    {categoryOptionLabel(node)}
                  </option>
                ))}
              </Select>
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
              <Switch
                label="يُباع بالوزن"
                description="الكمية على الكاشير بالكيلو، مثل 0.250"
                checked={unit?.allowsFraction ?? false}
                disabled={!canManage || !fractionUnit(!(unit?.allowsFraction ?? false))}
                onCheckedChange={(checked) => {
                  const next = fractionUnit(checked);
                  if (next) update({ unitId: next.id });
                }}
              />
              <Switch
                label="يُباع على الكاشير"
                description="أطفئه ليختفي من شاشة البيع ويبقى في المخزون."
                checked={draft.sellOnPos}
                disabled={!canManage}
                onCheckedChange={(sellOnPos) => update({ sellOnPos })}
              />
            </div>
          </Section>

          <Section title="المقاسات والألوان">
            <OptionsEditor axes={draft.axes} variantCount={liveVariants.length} onChange={setAxes} />
            {errors.variants ? <p className="text-sm text-danger-ink">{errors.variants}</p> : null}
          </Section>

          <Section title="السعر والباركود">
            {liveVariants.map((variant) => (
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
            ))}
            {archivedVariants.length > 0 ? (
              <p className="text-sm text-ink-muted">
                متغيّرات مؤرشفة تبقى في الفواتير السابقة:{' '}
                {archivedVariants.map((v) => v.attributes.map((a) => a.value).join(' · ') || '—').join('، ')}
              </p>
            ) : null}
          </Section>
        </fieldset>

        {product && draft.type === 'stock' ? (
          <Section title="في كل الفروع">
            <StockByBranch product={product} numberFormat={me.settings.numberFormat} />
          </Section>
        ) : null}
      </form>

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
    </AppShell>
  );
}

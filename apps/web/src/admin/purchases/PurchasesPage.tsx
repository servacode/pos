import { Link, useSearchParams } from 'react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  contactPhoneSchema,
  orderLineCost,
  orderLineRemaining,
  packOptionsOf,
  type PurchaseOrderDetail,
  type PurchasePayment,
  type PurchaseRow,
  type SupplierListResponse,
  type SupplierRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Avatar,
  Badge,
  BookIcon,
  Button,
  Card,
  CardHeader,
  CashIcon,
  ChequeIcon,
  ChoiceCard,
  DataTable,
  Dialog,
  EmptyState,
  formatQuantity,
  IconButton,
  Menu,
  MenuItem,
  Money,
  MoreIcon,
  NumberField,
  PackageOpenIcon,
  PageHeader,
  PrintIcon,
  ProgressBar,
  ProductsIcon,
  RadioGroup,
  SearchField,
  Select,
  Skeleton,
  Switch,
  TextField,
  TruckIcon,
  useDigits,
  UserIcon,
  type BadgeTone,
  type DataColumn,
  type Icon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { EXPIRY_SECTORS, serialWord, storeSells } from '../../lib/sectors';
import {
  createPurchase,
  createSupplier,
  getInventory,
  listPurchases,
  listSuppliers,
  moneyOf,
  paySupplier,
  qtyOf,
  today,
} from './api';
import { Caption, LinesHead, LinesTable, RemoveLine, SectionHead } from './parts';
import { SlimKpis } from '../SlimKpis';
import { PackQty } from './PackQty';
import { SanityDialog } from './SanityDialog';
import { PurchaseDetailDialog } from './PurchaseDetailDialog';
import { baseQtyOf, moneyText, packSummary, withPackChange } from './packLines';
import { purchaseWarnings, referenceCosts, type CostReference } from './purchaseSanity';
import { VariantPicker, type PickedVariant } from './VariantPicker';
import { getProduct } from '../catalog/api';
import { getOrder } from './orderApi';
import { findSupplierDuplicate, isAdvance, paymentProblem } from './supplierRules';
import { downloadCsv } from '../exportCsv';

const PAYMENT_TEXT: Record<PurchasePayment, string> = {
  credit: 'على حساب المورد',
  cash: 'نقداً من الخزنة',
  bank: 'من البنك',
};

/**
 * Each way of paying as a card and as a state in the list (هوية 4 › Badge): on the supplier's
 * account is still owed, so it reads as a warning; paid from the safe or the bank, as settled.
 */
const PAYMENT_LOOK: Record<PurchasePayment, { hint: string; icon: Icon; tone: BadgeTone }> = {
  credit: { hint: 'يُضاف إلى ما له عليك', icon: BookIcon, tone: 'warning' },
  cash: { hint: 'يُدفع الآن', icon: CashIcon, tone: 'success' },
  bank: { hint: 'يُحوَّل من حسابك', icon: ChequeIcon, tone: 'info' },
};

interface Line extends PickedVariant {
  /** Pieces, or packs of `packQty` pieces (thousandths) when the item has packs */
  qty: string;
  packQty: number;
  /** What one pack (or piece) cost, as typed; the total follows it */
  unitCost?: string;
  cost: string;
  /** «رقم الدفعة» and «تاريخ الانتهاء» (03 › الصيدليات), both optional */
  batch?: string;
  expiry?: string;
  /** Serial numbers or IMEIs, one per line of text (03 › الإلكترونيات) */
  serials?: string;
}

/**
 * «المشتريات» (08 › فاتورة شراء): the suppliers and what is owed to each, the purchases, a new
 * purchase (goods into the stock at what they cost) and a payment to a supplier.
 */
export function PurchasesPage() {
  const me = useMe();
  const [notice, setNotice] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'buy' | 'pay' | 'supplier'>('list');
  // «ابحث في المتجر» sends a purchase number here as ?q=PUR-…
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [opened, setOpened] = useState<PurchaseRow | null>(null);
  // «استلم البضاعة» on a purchase order sends the order's number here as ?order=…
  const orderId = params.get('order');
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([listSuppliers(), listPurchases()])
      .then(([s, p]) => {
        setSuppliers(s);
        setPurchases(p.items);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!orderId) return;
    getOrder(orderId)
      .then((o) => {
        setOrder(o);
        setMode('buy');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [orderId]);

  const base = suppliers?.baseCurrency ?? 'SYP';
  // After a save the form closes and the page is left scrolled down: bring the success message into view
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice && mode === 'list') noticeRef.current?.scrollIntoView?.({ block: 'start' });
  }, [notice, mode]);
  const done = (message: string) => {
    setNotice(message);
    setMode('list');
    setOrder(null);
    load();
  };

  // What the tiles and the search show, from the lists already loaded.
  const month = today().slice(0, 7);
  const thisMonth = (purchases ?? []).filter((p) => p.date.startsWith(month));
  const monthTotal = thisMonth.reduce((sum, p) => sum + p.totalMinor, 0);
  const topSupplier = (suppliers?.items ?? []).reduce<SupplierRow | null>(
    (top, s) => (s.balanceMinor > 0 && (!top || s.balanceMinor > top.balanceMinor) ? s : top),
    null,
  );
  const latest = purchases?.[0];
  const needle = query.trim().toLowerCase();
  const shownPurchases = (purchases ?? []).filter(
    (p) =>
      !needle ||
      p.number.toLowerCase().includes(needle) ||
      p.supplierName.toLowerCase().includes(needle) ||
      (p.reference ?? '').toLowerCase().includes(needle),
  );

  const purchaseColumns: DataColumn<PurchaseRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      className: 'md:whitespace-nowrap',
      cell: (p) => (
        <span className="flex flex-col items-start">
          <bdi dir="ltr" className="num font-semibold whitespace-nowrap text-ink">
            {p.number}
          </bdi>
          {p.reference ? (
            <span className="text-xs text-ink-subtle">
              رقمها عند المورد <bdi className="num">{p.reference}</bdi>
            </span>
          ) : null}
          {/* On a phone the supplier, the day and the payment sit under the number: the amount and «التفاصيل» stay on screen */}
          <span className="flex flex-col items-start gap-1 text-xs text-ink-muted md:hidden">
            <span>{p.supplierName}</span>
            <span>{dayText(p.date, me.settings.numberFormat)}</span>
            <Badge tone={PAYMENT_LOOK[p.payment].tone}>{PAYMENT_TEXT[p.payment]}</Badge>
            <Money minor={p.totalMinor} currency={base} className="text-sm font-semibold text-ink" />
          </span>
        </span>
      ),
    },
    {
      key: 'supplier',
      className: 'whitespace-nowrap max-md:hidden',
      header: 'المورد',
      cell: (p) => p.supplierName,
    },
    {
      key: 'date',
      header: 'التاريخ',
      className: 'whitespace-nowrap max-md:hidden',
      cell: (p) => (
        <span className="whitespace-nowrap text-ink-muted">{dayText(p.date, me.settings.numberFormat)}</span>
      ),
    },
    {
      key: 'payment',
      header: 'الدفع',
      className: 'max-md:hidden',
      cell: (p) => <Badge tone={PAYMENT_LOOK[p.payment].tone}>{PAYMENT_TEXT[p.payment]}</Badge>,
    },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      className: 'max-md:hidden',
      cell: (p) => <Money minor={p.totalMinor} currency={base} className="font-semibold" />,
    },
    {
      key: 'labels',
      header: '',
      className: 'w-px whitespace-nowrap',
      cell: (p) => (
        <span className="flex items-center gap-4">
          <Button variant="ghost" size="xs" aria-label={`تفاصيل ${p.number}`} onClick={() => setOpened(p)}>
            التفاصيل
          </Button>
          <Menu
            label={`المزيد: ${p.number}`}
            align="end"
            trigger={<IconButton label={`المزيد: ${p.number}`} icon={<MoreIcon />} />}
          >
            <MenuItem
              icon={<PrintIcon size={16} />}
              render={(props) => <Link to={`/labels?purchase=${p.id}`} {...props} />}
            >
              الملصقات
            </MenuItem>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <title>المشتريات · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="المشتريات والموردون"
          description={
            mode === 'buy'
              ? 'فاتورة شراء جديدة: البضاعة تدخل المخزون بكلفتها.'
              : 'فواتير الشراء من الموردين، وما لكل مورد عليك.'
          }
          actions={
            mode === 'buy' ? null : (
              <>
                <Button variant="secondary" icon={<UserIcon />} onClick={() => setMode('supplier')}>
                  مورد جديد
                </Button>
                <Button
                  variant="secondary"
                  icon={<CashIcon />}
                  onClick={() => setMode('pay')}
                  disabled={!suppliers?.items.length}
                >
                  دفعة لمورد
                </Button>
                <Button icon={<AddIcon />} onClick={() => setMode('buy')} disabled={!suppliers?.items.length}>
                  فاتورة شراء
                </Button>
              </>
            )
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice && mode === 'list' ? (
          <div ref={noticeRef} className="scroll-mt-36 sm:scroll-mt-28">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}
        {mode === 'buy' && suppliers ? (
          <PurchaseForm
            suppliers={suppliers.items}
            order={order}
            onSaved={(n) => done(`سُجّلت الفاتورة ${n} ودخلت البضاعة المخزون.`)}
            onCancel={() => {
              setOrder(null);
              setMode('list');
            }}
          />
        ) : (
          <>
            <SlimKpis
              label="أرقام المشتريات"
              items={[
                {
                  key: 'month',
                  label: 'مشتريات هذا الشهر',
                  value: purchases ? <Money minor={monthTotal} currency={base} /> : '…',
                  note: purchases ? (
                    <>
                      <span className="num">{thisMonth.length}</span> فاتورة من{' '}
                      <span className="num">{purchases.length}</span>
                      {latest ? (
                        <span className="max-sm:hidden">
                          {' '}
                          · آخرها{' '}
                          <bdi dir="ltr" className="num">
                            {latest.number}
                          </bdi>
                        </span>
                      ) : null}
                    </>
                  ) : undefined,
                },
                {
                  key: 'owed',
                  label: 'المستحق للموردين',
                  value: suppliers ? <Money minor={suppliers.totalOwedMinor} currency={base} /> : '…',
                  note: topSupplier ? (
                    <span className="block truncate">{`أكبر رصيد: ${topSupplier.name}`}</span>
                  ) : suppliers ? (
                    'لا شيء عليك لأي مورد'
                  ) : undefined,
                },
              ]}
            />
            <section aria-label="فواتير الشراء" className="flex flex-col gap-3">
              <SectionHead title="فواتير الشراء" description="الأحدث أولاً. الملصقات تُطبع بعدد ما وصل.">
                <SearchField
                  label="ابحث برقم الفاتورة أو المورد"
                  value={query}
                  onValueChange={setQuery}
                  className="w-full sm:w-72"
                />
                <Button
                  variant="secondary"
                  disabled={shownPurchases.length === 0}
                  onClick={() => exportPurchases(shownPurchases)}
                >
                  صدّر إلى إكسل
                </Button>
              </SectionHead>
              <DataTable
                caption="فواتير الشراء"
                columns={purchaseColumns}
                rows={shownPurchases}
                rowKey={(p) => p.id}
                loading={!purchases && !error}
                empty={
                  needle && purchases?.length ? (
                    <EmptyState
                      icon={PackageOpenIcon}
                      title="لا فاتورة تطابق البحث."
                      description="جرّب رقماً آخر أو اسم المورد."
                    />
                  ) : (
                    <EmptyState
                      icon={PackageOpenIcon}
                      title="لا فواتير شراء بعد."
                      description="سجّل أول فاتورة من «فاتورة شراء»، فتدخل البضاعة المخزون بكلفتها."
                    />
                  )
                }
              />
            </section>
            <Suppliers suppliers={suppliers} failed={Boolean(error)} base={base} />
            {opened ? <PurchaseDetailDialog purchase={opened} onClose={() => setOpened(null)} /> : null}
          </>
        )}
        {mode === 'supplier' ? (
          <SupplierForm
            suppliers={suppliers?.items ?? []}
            onSaved={() => done('أُضيف المورد.')}
            onCancel={() => setMode('list')}
          />
        ) : null}
        {mode === 'pay' && suppliers ? (
          <PaymentForm
            suppliers={suppliers.items}
            base={base}
            onSaved={(n) => done(`سُجّل سند الدفع ${n}.`)}
            onCancel={() => setMode('list')}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

const pounds = (minor: number) => minor / 100;

/** The purchases on screen as a CSV file (Excel opens it in Arabic). */
function exportPurchases(rows: PurchaseRow[]) {
  downloadCsv(
    `المشتريات-${today()}`,
    ['الرقم', 'التاريخ', 'المورد', 'رقمها عند المورد', 'طريقة الدفع', 'الإجمالي'],
    rows.map((p) => [
      p.number,
      p.date,
      p.supplierName,
      p.reference ?? '',
      PAYMENT_TEXT[p.payment],
      pounds(p.totalMinor),
    ]),
  );
}

/** The suppliers with what is owed to each as a CSV file. */
function exportSuppliers(rows: SupplierRow[]) {
  downloadCsv(
    `الموردون-${today()}`,
    ['المورد', 'الجوال', 'ما له عليك', 'ملاحظات'],
    rows.map((x) => [x.name, x.phone ?? '', pounds(x.balanceMinor), x.notes ?? '']),
  );
}

/** The suppliers, each with what the store owes it and its share of the total: few and rich, so cards. */
function Suppliers({
  suppliers,
  failed,
  base,
}: {
  suppliers: SupplierListResponse | null;
  failed: boolean;
  base: SupplierListResponse['baseCurrency'];
}) {
  const owed = suppliers?.totalOwedMinor ?? 0;
  return (
    <section aria-label="الموردون" className="flex flex-col gap-3">
      <SectionHead title="الموردون" description="وما لكل منهم عليك، ونصيبه من المستحق.">
        <Button
          variant="secondary"
          disabled={!suppliers?.items.length}
          onClick={() => exportSuppliers(suppliers?.items ?? [])}
        >
          صدّر إلى إكسل
        </Button>
      </SectionHead>
      {!suppliers ? (
        failed ? (
          <p className="text-sm text-ink-muted">لا تظهر القائمة الآن.</p>
        ) : (
          <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1].map((i) => (
              <Card key={i} className="flex items-center gap-4">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-20" />
              </Card>
            ))}
          </div>
        )
      ) : suppliers.items.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title="لا موردين بعد."
          description="أضف مورداً أولاً، ثم سجّل فواتير الشراء منه."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.items.map((s) => (
            <li key={s.id}>
              <Card className="flex h-full flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold text-ink">{s.name}</span>
                    <span className="text-sm text-ink-muted">
                      {s.phone ? (
                        <bdi dir="ltr" className="num">
                          {s.phone}
                        </bdi>
                      ) : (
                        'بلا جوال'
                      )}
                    </span>
                  </div>
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-muted">له علينا</span>
                    <Money
                      minor={s.balanceMinor}
                      currency={base}
                      className="text-lg font-bold text-ink"
                      unitClassName="text-xs font-semibold text-ink-subtle"
                    />
                  </div>
                  {owed > 0 ? (
                    <ProgressBar
                      label={`نصيب ${s.name} من المستحق للموردين`}
                      value={Math.max(0, s.balanceMinor)}
                      max={owed}
                    />
                  ) : null}
                  <Link
                    to={`/suppliers/${s.id}/statement`}
                    className="self-start rounded-small text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
                  >
                    كشف الحساب
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      return await work();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, fields, run, setFields };
}

/** «مورد جديد»: the window to add a supplier (shared with «الموردون») */
export function SupplierForm({
  suppliers,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const s = useSaving();
  const duplicate = findSupplierDuplicate(suppliers, name, phone);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="مورد جديد"
      description="من تشتري منه البضاعة. يظهر هنا ما له عليك بعد كل فاتورة ودفعة."
    >
      <form
        aria-label="مورد جديد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (duplicate && !confirmed) {
            setConfirmed(true);
            return;
          }
          // A phone that cannot be right is told here, before anything is sent
          const wrong = contactPhoneSchema.safeParse(phone);
          if (!wrong.success) {
            s.setFields({ phone: wrong.error.issues[0]?.message ?? 'رقم الهاتف غير صحيح' });
            return;
          }
          void s.run(() => createSupplier({ name, phone })).then((r) => r && onSaved());
        }}
      >
        {s.error && !Object.keys(s.fields).length ? <Alert tone="error">{s.error}</Alert> : null}
        {duplicate ? (
          <Alert tone="warning">
            {duplicate.by === 'phone'
              ? `هذا الرقم مسجّل للمورد «${duplicate.supplier.name}».`
              : `يوجد مورد بالاسم نفسه «${duplicate.supplier.name}».`}{' '}
            <Link className="font-semibold underline" to={`/suppliers/${duplicate.supplier.id}/statement`}>
              افتح المورد
            </Link>
            {confirmed ? ' اضغط «أضِفه رغم ذلك» لتأكيد أنه مورد آخر.' : ''}
          </Alert>
        ) : null}
        <TextField
          label="اسم المورد"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={s.fields.name}
        />
        <TextField
          label="الجوال"
          hint="اختياري"
          dir="ltr"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (s.fields.phone) s.setFields({});
          }}
          error={s.fields.phone}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={s.saving}>
            {duplicate && confirmed ? 'أضِفه رغم ذلك' : 'احفظ'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * What a purchase order is still owed, as the lines of a purchase: the rest of each quantity at the
 * order's unit cost, which stays when the quantity is changed (the line's total follows it)
 */
function linesOfOrder(order: PurchaseOrderDetail): Line[] {
  return order.lines
    .filter((l) => orderLineRemaining(l) > 0)
    .map((l) => {
      const left = orderLineRemaining(l);
      return {
        variantId: l.variantId,
        name: l.name,
        qty: String(left / 1000),
        packQty: 1000,
        unitCost: moneyText(l.unitCostMinor),
        cost: moneyText(orderLineCost(l.unitCostMinor, left)),
      };
    });
}

/** The grid of a purchase line: the item, its quantity, its cost and the bin. */
const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_14rem_8rem_9rem_2.5rem]';

function PurchaseForm({
  suppliers,
  order,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  /** The purchase order being received: its supplier and what is still owed fill the form */
  order?: PurchaseOrderDetail | null;
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const digits = useDigits();
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? suppliers[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [payment, setPayment] = useState<PurchasePayment>('credit');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>(() => (order ? linesOfOrder(order) : []));
  // The items' flags (expiry, serial numbers, packs) come from their products, read after the form opens
  useEffect(() => {
    if (!order) return;
    let alive = true;
    for (const productId of new Set(order.lines.map((l) => l.productId))) {
      getProduct(productId)
        .then((d) => {
          if (!alive) return;
          setLines((all) =>
            all.map((l) => {
              const v = d.variants.find((x) => x.id === l.variantId);
              return v
                ? {
                    ...l,
                    packs: packOptionsOf(v.barcodes),
                    ...(d.requiresExpiry ? { requiresExpiry: true } : {}),
                    ...(d.tracksSerial ? { tracksSerial: true } : {}),
                    // The shelf price, so a cost far above it is asked about here too
                    ...(v.price.currency === 'SYP' && v.price.priceMinor > 0
                      ? { priceMinor: v.price.priceMinor }
                      : {}),
                  }
                : l;
            }),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [order]);
  // The batch, expiry and serial fields of a trade that does not use them, shown on demand (هوية 2:
  // a clothing shop sees no expiry dates or IMEI).
  const [allFields, setAllFields] = useState(false);
  const s = useSaving();
  // After an item is picked, the cursor goes to its quantity (the keyboard does not hunt for the new line)
  const formRef = useRef<HTMLFormElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const fields = formRef.current?.querySelectorAll<HTMLInputElement>('[data-qty-input]');
    fields?.[fields.length - 1]?.focus();
  }, [lines.length]);
  // A batch dated in the past is saved only after the buyer says the date is right
  const [pastOk, setPastOk] = useState(false);
  // What the shelf cost so far, to ask «هل أنت متأكد؟» about a cost far above it; a failed read means no warning
  const [averages, setAverages] = useState<Map<string, CostReference>>(new Map());
  const [warnings, setWarnings] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    getInventory()
      .then((r) => alive && setAverages(referenceCosts(r.items)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const pastLines = lines.filter((l) => l.expiry && l.expiry < today());
  const parsed = lines.map((l) => ({ qty: baseQtyOf(l), cost: moneyOf(l.cost) }));
  // A line with the quantity 0 is left out of the invoice, not a reason to stop: what did not arrive stays on the order
  const used = lines.flatMap((_, i) => (parsed[i]!.qty === 0 ? [] : [i]));
  const skipped = lines.length - used.length;
  const ready =
    used.length > 0 &&
    used.every((i) => parsed[i]!.qty && parsed[i]!.qty! > 0 && parsed[i]!.cost !== null) &&
    used.every((i) => !lines[i]!.requiresExpiry || Boolean(lines[i]!.expiry)) &&
    (pastLines.length === 0 || pastOk);
  const total = used.reduce((sum, i) => sum + (parsed[i]!.cost ?? 0), 0);
  /** Why «سجّل الفاتورة» waits, in words: the buttons never go grey without a reason */
  const missingExpiry = used.map((i) => lines[i]!).filter((l) => l.requiresExpiry && !l.expiry);
  const notReadyWhy =
    ready || lines.length === 0
      ? null
      : used.length === 0
        ? 'كل الأسطر بكمية صفر. اكتب كمية لسطر واحد على الأقل.'
        : used.some((i) => !(parsed[i]!.qty && parsed[i]!.qty! > 0) || parsed[i]!.cost === null)
          ? 'اكتب الكمية والكلفة لكل صنف ليُسجَّل.'
          : missingExpiry.length > 0
            ? `اكتب تاريخ الانتهاء لـ ${missingExpiry.map((l) => l.name).join('، ')} ليُسجَّل.`
            : 'أكّد أن تاريخ الانتهاء الماضي صحيح ليُسجَّل.';

  const withDates = storeSells(me.tenant.sectors, EXPIRY_SECTORS);
  const supplier = suppliers.find((x) => x.id === supplierId);
  const pieces = used.reduce((sum, i) => sum + (parsed[i]!.qty ?? 0), 0);

  function save() {
    // The zero-quantity lines go first, so the lines the server names are the ones still on the screen
    if (skipped > 0) setLines(used.map((i) => lines[i]!));
    void s
      .run(() =>
        createPurchase({
          supplierId,
          date,
          payment,
          reference: reference || null,
          notes: null,
          ...(order ? { purchaseOrderId: order.id } : {}),
          lines: used.map((i) => {
            const l = lines[i]!;
            return {
              variantId: l.variantId,
              qty: parsed[i]!.qty!,
              costMinor: parsed[i]!.cost!,
              batchNo: l.batch?.trim() || null,
              expiryDate: l.expiry || null,
              ...(l.serials?.trim()
                ? {
                    serials: l.serials
                      .split(/[\n,،]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }
                : {}),
            };
          }),
        }),
      )
      .then((r) => r && onSaved(r.number));
  }

  /** The message about one line's serial numbers: its own, or the invoice-wide one that names a number typed on it */
  function serialProblem(i: number): string | undefined {
    const own = s.fields[`lines.${i}.serials`];
    if (own) return own;
    const wide = s.fields.lines;
    const typed = (lines[i]?.serials ?? '').split(/[\n,،]+/).map((x) => x.trim());
    return wide && typed.some((x) => x !== '' && wide.includes(x)) ? wide : undefined;
  }

  return (
    <form
      ref={formRef}
      aria-label="فاتورة شراء"
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const doubts = purchaseWarnings(
          used.map((i) => ({
            variantId: lines[i]!.variantId,
            name: lines[i]!.name,
            qty: parsed[i]!.qty,
            costMinor: parsed[i]!.cost,
            priceMinor: lines[i]!.priceMinor ?? null,
          })),
          averages,
        );
        if (doubts.length > 0) {
          setWarnings(doubts);
          return;
        }
        save();
      }}
    >
      {warnings ? (
        <SanityDialog warnings={warnings} onConfirm={save} onClose={() => setWarnings(null)} />
      ) : null}
      <div className="flex min-w-0 flex-col gap-6">
        {s.error ? <Alert tone="error">{s.fields.lines ?? s.error}</Alert> : null}
        {order ? (
          <Alert tone="info">
            استلام من الطلبية{' '}
            <bdi dir="ltr" className="num font-semibold">
              {order.number}
            </bdi>
            : وضعنا الباقي منها فقط. عدّل الكمية والكلفة بما وصل فعلاً، وما لم يصل يبقى على الطلبية.
          </Alert>
        ) : null}
        <Card>
          <CardHeader
            icon={<TruckIcon />}
            title="المورد والتاريخ"
            description="من أين جاءت البضاعة، ومتى، وبأي رقم كتبها المورد."
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Select
              label="المورد"
              value={supplierId}
              disabled={Boolean(order)}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.name}
                </option>
              ))}
            </Select>
            <DateField label="التاريخ" value={date} onChange={setDate} required />
            <TextField
              label="رقم فاتورة المورد"
              hint="اختياري"
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<ProductsIcon />}
            title="الأصناف"
            description="ابحث بالاسم أو امسح الباركود. كلفة كل سطر هي مجموعه بالليرة."
          />
          <div className="flex flex-col gap-4">
            <VariantPicker
              onPick={(v) => {
                // only a line that is really added gets the cursor
                focusNew.current =
                  !lines.some((l) => l.variantId === v.variantId) ||
                  withDates ||
                  allFields ||
                  !!v.requiresExpiry;
                setLines((list) =>
                  // The same item twice is allowed where batches are kept: each on its own line, with its batch
                  list.some((l) => l.variantId === v.variantId) &&
                  !(withDates || allFields || v.requiresExpiry)
                    ? list
                    : [...list, { ...v, qty: '', packQty: 1000, cost: '', batch: '', expiry: '' }],
                );
              }}
              onPickGrid={(picked) =>
                setLines((list) => [
                  ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                  ...picked.map((p) => ({ ...p, packQty: 1000, batch: '', expiry: '' })),
                ])
              }
            />
            {lines.length > 0 && !withDates ? (
              <Switch
                label="الدفعة وتاريخ الانتهاء"
                checked={allFields}
                onCheckedChange={setAllFields}
                className="self-end"
              />
            ) : null}
            {lines.length > 0 ? (
              <LinesTable
                label="أصناف الفاتورة"
                head={
                  <LinesHead className={LINE_COLUMNS}>
                    <span>الصنف</span>
                    <span>الكمية</span>
                    <span>كلفة الوحدة</span>
                    <span>مجموع الكلفة</span>
                    <span />
                  </LinesHead>
                }
              >
                {lines.map((l, i) => {
                  const p = parsed[i]!;
                  const pack = l.packs?.find((x) => x.qty === l.packQty) ?? null;
                  const unit =
                    p.qty && p.qty > 0 && p.cost !== null ? Math.round(p.cost / (p.qty / 1000)) : null;
                  const showDates =
                    withDates ||
                    allFields ||
                    l.requiresExpiry === true ||
                    Boolean(l.batch || l.expiry || s.fields[`lines.${i}.expiryDate`]);
                  // Serial numbers only for a product that tracks them (one number per piece)
                  const showSerials = l.tracksSerial === true || Boolean(l.serials || serialProblem(i));
                  return (
                    <li key={`${l.variantId}-${i}`} className="flex flex-col gap-3 px-4 py-3">
                      <div
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 md:items-center ${LINE_COLUMNS}`}
                      >
                        <div className="col-span-2 flex min-w-0 flex-col md:col-span-1">
                          <span title={l.name} className="line-clamp-2 leading-snug font-semibold text-ink">
                            {l.name}
                          </span>
                          {pack && p.qty ? (
                            <span className="text-xs text-ink-subtle">
                              {packSummary(qtyOf(l.qty) ?? 0, pack, (q) => formatQuantity(q, digits))}
                            </span>
                          ) : null}
                          {unit !== null ? (
                            <span className="text-xs text-ink-subtle">
                              كلفة القطعة <Money minor={unit} currency="SYP" />
                            </span>
                          ) : null}
                        </div>
                        <div className="col-span-3 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto">
                          <Caption>الكمية</Caption>
                          <PackQty
                            name={l.name}
                            packs={l.packs}
                            qty={l.qty}
                            packQty={l.packQty}
                            onChange={(patch) =>
                              setLines((all) => all.map((x, j) => (j === i ? withPackChange(x, patch) : x)))
                            }
                            error={s.fields[`lines.${i}.qty`]}
                          />
                        </div>
                        <div className="col-start-1 row-start-3 md:col-start-auto md:row-start-auto">
                          <Caption>{pack ? `كلفة ${pack.name}` : 'كلفة الوحدة'}</Caption>
                          <NumberField
                            label={`كلفة وحدة ${l.name}`}
                            hideLabel
                            placeholder="كلفة الوحدة"
                            decimals={2}
                            value={l.unitCost ?? ''}
                            onValueChange={(unitCost) =>
                              setLines((all) =>
                                all.map((x, j) => (j === i ? withPackChange(x, { unitCost }) : x)),
                              )
                            }
                          />
                        </div>
                        <div className="col-span-2 col-start-2 row-start-3 md:col-span-1 md:col-start-auto md:row-start-auto">
                          <Caption>مجموع الكلفة</Caption>
                          <NumberField
                            label={`كلفة ${l.name}`}
                            hideLabel
                            placeholder="مجموع الكلفة"
                            decimals={2}
                            value={l.cost}
                            onValueChange={(cost) =>
                              setLines((all) =>
                                all.map((x, j) => (j === i ? withPackChange(x, { cost }) : x)),
                              )
                            }
                            error={s.fields[`lines.${i}.costMinor`]}
                          />
                          {p.cost !== null && p.cost > 0 ? (
                            <span className="mt-1 block text-xs text-ink-subtle">
                              <Money minor={p.cost} currency="SYP" />
                            </span>
                          ) : null}
                        </div>
                        <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                          <RemoveLine
                            name={l.name}
                            onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                          />
                        </div>
                      </div>
                      {showDates || showSerials ? (
                        <div className="grid grid-cols-1 gap-3 rounded-control bg-surface-muted/60 p-3 sm:grid-cols-2">
                          {showDates ? (
                            <>
                              <div>
                                <Caption always>رقم الدفعة (اختياري)</Caption>
                                <TextField
                                  label={`دفعة ${l.name}`}
                                  hideLabel
                                  dir="ltr"
                                  value={l.batch ?? ''}
                                  onChange={(e) =>
                                    setLines((all) =>
                                      all.map((x, j) => (j === i ? { ...x, batch: e.target.value } : x)),
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <DateField
                                  label={
                                    l.requiresExpiry ? 'تاريخ الانتهاء (مطلوب)' : 'تاريخ الانتهاء (اختياري)'
                                  }
                                  value={l.expiry ?? ''}
                                  onChange={(iso) =>
                                    setLines((all) =>
                                      all.map((x, j) => (j === i ? { ...x, expiry: iso } : x)),
                                    )
                                  }
                                  error={s.fields[`lines.${i}.expiryDate`]}
                                />
                                {l.expiry && l.expiry < today() ? (
                                  <p role="status" className="mt-1 text-xs font-semibold text-warning-ink">
                                    هذا التاريخ مضى: الدفعة منتهية الصلاحية. تأكد منه قبل الحفظ.
                                  </p>
                                ) : null}
                              </div>
                            </>
                          ) : null}
                          {showSerials ? (
                            <label className="flex flex-col gap-1.5 sm:col-span-2">
                              <span className="text-xs font-semibold text-ink-subtle">
                                {serialWord(me.tenant.sectors) === 'الرقم التسلسلي'
                                  ? 'الأرقام التسلسلية'
                                  : 'الأرقام التسلسلية أو IMEI'}{' '}
                                (رقم في كل سطر، للأجهزة)
                              </span>
                              <textarea
                                aria-label={`أرقام ${l.name}`}
                                dir="ltr"
                                rows={2}
                                value={l.serials ?? ''}
                                onChange={(e) =>
                                  setLines((all) =>
                                    all.map((x, j) => (j === i ? { ...x, serials: e.target.value } : x)),
                                  )
                                }
                                aria-invalid={serialProblem(i) ? true : undefined}
                                className={`num rounded-control border bg-surface px-3 py-2 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-120 ease-standard hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden ${serialProblem(i) ? 'border-danger' : 'border-line-control'}`}
                              />
                              {serialProblem(i) ? (
                                <span className="text-sm text-danger-ink">{serialProblem(i)}</span>
                              ) : null}
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </LinesTable>
            ) : (
              <EmptyState
                icon={PackageOpenIcon}
                title="الفاتورة فارغة."
                description={
                  storeSells(me.tenant.sectors, ['clothing'])
                    ? 'ابحث عن صنف بالأعلى؛ الموديل بمقاساته وألوانه يفتح جدولاً تكتب فيه الكميات دفعة واحدة.'
                    : 'ابحث عن صنف بالأعلى لتضيفه إلى الفاتورة، ثم اكتب الكمية والكلفة.'
                }
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<CashIcon />} title="الدفع" description="كيف دُفع ثمن البضاعة." />
          <RadioGroup legend="الدفع" hideLegend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {(Object.keys(PAYMENT_TEXT) as PurchasePayment[]).map((p) => {
                const PayIcon = PAYMENT_LOOK[p].icon;
                return (
                  <ChoiceCard
                    key={p}
                    name="purchase-payment"
                    value={p}
                    checked={payment === p}
                    onChange={() => setPayment(p)}
                    title={PAYMENT_TEXT[p]}
                    description={PAYMENT_LOOK[p].hint}
                    leading={<PayIcon />}
                  />
                );
              })}
            </div>
          </RadioGroup>
        </Card>
      </div>
      {/* The totals stay in view: beside the form on a wide screen, over the bottom edge on a phone. */}
      <div className="sticky z-10 max-lg:bottom-3 max-lg:rounded-card max-lg:shadow-e3 lg:top-24">
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink max-lg:hidden">ملخص الفاتورة</h2>
          <dl className="flex flex-col gap-3 text-sm max-lg:hidden">
            <SummaryRow term="المورد">{supplier?.name ?? '—'}</SummaryRow>
            {supplier ? (
              <SummaryRow term="له عليك الآن">
                <Money minor={supplier.balanceMinor} currency="SYP" />
              </SummaryRow>
            ) : null}
            <SummaryRow term="الدفع">{PAYMENT_TEXT[payment]}</SummaryRow>
            <SummaryRow term="الأصناف">
              <span className="num">{used.length}</span>
            </SummaryRow>
            <SummaryRow term="الكمية">
              <span className="num">{formatQuantity(pieces, digits)}</span>
            </SummaryRow>
          </dl>
          <div className="flex items-center justify-between gap-x-3 gap-y-1 rounded-control bg-surface-total px-4 py-3 lg:flex-col lg:items-start">
            <span className="text-sm font-semibold whitespace-nowrap text-ink-muted">مجموع الفاتورة</span>
            <Money
              minor={total}
              currency="SYP"
              className="text-2xl font-bold text-ink"
              unitClassName="text-base font-semibold text-ink-subtle"
            />
          </div>
          <div className="flex gap-3 lg:flex-col">
            <Button
              type="submit"
              loading={s.saving}
              disabled={!ready}
              aria-describedby={notReadyWhy ? 'purchase-not-ready' : undefined}
              className="flex-1 lg:w-full"
            >
              سجّل الفاتورة
            </Button>
            <Button variant="ghost" onClick={onCancel} className="lg:w-full">
              إلغاء
            </Button>
          </div>
          {pastLines.length > 0 ? (
            <Switch
              label="تاريخ الانتهاء الماضي صحيح، سجّله"
              description={`${pastLines.map((l) => l.name).join('، ')}: دفعة منتهية الصلاحية.`}
              checked={pastOk}
              onCheckedChange={setPastOk}
            />
          ) : null}
          {skipped > 0 && used.length > 0 ? (
            <p role="status" className="text-sm text-ink-muted">
              {skipped === 1 ? 'سطر واحد بكمية صفر' : `${skipped} أسطر بكمية صفر`} لن يُسجَّل
              {order ? '، ويبقى على الطلبية' : ''}.
            </p>
          ) : null}
          {notReadyWhy ? (
            <p id="purchase-not-ready" aria-live="polite" className="text-sm font-semibold text-warning-ink">
              {notReadyWhy}
            </p>
          ) : null}
        </Card>
      </div>
    </form>
  );
}

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 truncate text-end font-semibold text-ink">{children}</dd>
    </div>
  );
}

function PaymentForm({
  suppliers,
  base,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  base: SupplierListResponse['baseCurrency'];
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const owing = suppliers.filter((x) => x.balanceMinor > 0);
  const [supplierId, setSupplierId] = useState((owing[0] ?? suppliers[0])?.id ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [date, setDate] = useState(today());
  const [bank, setBank] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [dueDate, setDueDate] = useState(today());
  const chequeReady = method !== 'cheque' || (bank.trim() !== '' && chequeNo.trim() !== '' && dueDate !== '');
  const [advance, setAdvance] = useState(false);
  const s = useSaving();
  const minor = moneyOf(amount);
  const supplier = suppliers.find((x) => x.id === supplierId);
  const problem = paymentProblem(amount, minor);
  const over = minor !== null && supplier ? isAdvance(minor, supplier.balanceMinor) : false;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="دفعة لمورد"
      description="تنقص ما له عليك بقدرها، وتخرج من الخزنة أو من البنك."
    >
      <form
        aria-label="دفعة لمورد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!minor || (over && !advance) || !chequeReady) return;
          void s
            .run(() =>
              paySupplier({
                supplierId,
                date,
                amountMinor: minor,
                method: method === 'cheque' ? 'bank' : method,
                ...(method === 'cheque'
                  ? { cheque: { bank: bank.trim(), number: chequeNo.trim(), dueDate } }
                  : {}),
                note: null,
                ...(over ? { advance: true } : {}),
              }),
            )
            .then((r) => r && onSaved(r.number));
        }}
      >
        {s.error ? <Alert tone="error">{s.error}</Alert> : null}
        <Select
          label="المورد"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          hint={
            supplier ? (
              <>
                له عليك الآن <Money minor={supplier.balanceMinor} currency={base} className="font-semibold" />
              </>
            ) : undefined
          }
        >
          {suppliers.map((sup) => (
            <option key={sup.id} value={sup.id}>
              {sup.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="المبلغ بالليرة"
            inputMode="decimal"
            dir="ltr"
            autoFocus
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAdvance(false);
            }}
            error={problem ?? s.fields.amountMinor}
            inputClassName="num"
          />
          <DateField label="التاريخ" value={date} onChange={setDate} required />
        </div>
        {over ? (
          <Alert tone="warning">
            المبلغ أكبر مما للمورد عليك. الفرق يبقى دفعة مقدّمة له عندك، فيصير رصيده لك عنده.
            <Switch label="نعم، هذه دفعة مقدّمة" checked={advance} onCheckedChange={setAdvance} />
          </Alert>
        ) : null}
        <RadioGroup legend="من أين">
          <div className="grid grid-cols-1 gap-2">
            {(['cash', 'bank', 'cheque'] as const).map((m) => (
              <ChoiceCard
                key={m}
                name="supplier-payment-method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                title={m === 'cash' ? 'من الخزنة' : m === 'bank' ? 'من البنك' : 'بشيك'}
                leading={m === 'cash' ? <CashIcon /> : <ChequeIcon />}
              />
            ))}
          </div>
        </RadioGroup>
        {method === 'cheque' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="البنك" value={bank} onChange={(e) => setBank(e.target.value)} required />
            <TextField
              label="رقم الشيك"
              dir="ltr"
              inputMode="numeric"
              value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              inputClassName="num"
              required
            />
            <DateField
              label="تاريخ الاستحقاق"
              value={dueDate}
              onChange={setDueDate}
              required
              className="sm:col-span-2"
            />
            {dueDate !== '' && dueDate < today() ? (
              <Alert tone="warning" className="sm:col-span-2">
                تاريخ الاستحقاق مضى. تأكّد من التاريخ قبل أن تسجّل الدفعة.
              </Alert>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={s.saving} disabled={!minor || (over && !advance) || !chequeReady}>
            سجّل الدفعة
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

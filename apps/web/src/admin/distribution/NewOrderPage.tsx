import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  getCurrency,
  type CustomerListItem,
  type ProductDetail,
  type ProductListItem,
  type SalesOrderCreateInput,
} from '@serva/core';
import {
  Alert,
  BackIcon,
  Button,
  Card,
  CardHeader,
  CloseIcon,
  Money,
  PageHeader,
  SearchField,
  Select,
  TextField,
  TruckIcon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { DateField } from '../../lib/DateField';
import { ApiError, errorMessage } from '../../lib/api';
import { listProducts, getProduct } from '../catalog/api';
import { listCustomers } from '../customers/api';
import { createOrder, listReps, listVans } from './api';
import { qtyOf, thousandths, useLoad } from './parts';
import { minorOf } from './SettlementPage';

interface Line {
  variantId: string;
  name: string;
  qty: string;
  price: string;
}

/** The order's lines as the server takes them; the message names the first line that is not a quantity and a price */
export function orderLines(
  lines: readonly Line[],
  decimals: number,
): { lines: SalesOrderCreateInput['lines']; error: string | null } {
  const made: SalesOrderCreateInput['lines'] = [];
  for (const l of lines) {
    const qty = thousandths(l.qty);
    const price = minorOf(l.price, decimals);
    if (qty === null) return { lines: [], error: `اكتب كمية «${l.name}».` };
    if (price === null) return { lines: [], error: `اكتب سعر «${l.name}».` };
    made.push({ variantId: l.variantId, qty, deliveredQty: 0, unitPriceMinor: price });
  }
  return { lines: made, error: null };
}

/** A typed amount of money as the field shows it: 150000 minor of a two-decimal currency is «1500» */
const shown = (minor: number, decimals: number) => String(minor / 10 ** decimals);

/** «طلبية جديدة»: the office takes a pre-sale order for a customer, to be filled from a branch or a van */
export function NewOrderPage() {
  const me = useMe();
  const navigate = useNavigate();
  const base = me.settings.baseCurrency;
  const decimals = getCurrency(base).decimals;
  const vans = useLoad(listVans);
  const reps = useLoad(listReps);
  const [customerQ, setCustomerQ] = useState('');
  const [found, setFound] = useState<CustomerListItem[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [placeId, setPlaceId] = useState('');
  const [repId, setRepId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [productQ, setProductQ] = useState('');
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [picked, setPicked] = useState<ProductDetail | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const places = [
    ...me.branches.map((b) => ({ id: b.id, name: b.name })),
    ...(vans.data ?? []).filter((v) => v.isActive).map((v) => ({ id: v.id, name: `${v.name} (سيارة)` })),
  ];
  const place = placeId || places[0]?.id || '';

  useEffect(() => {
    if (customer || customerQ.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      listCustomers(customerQ.trim())
        .then((r) => live && setFound(r.items.filter((c) => !c.archived).slice(0, 8)))
        .catch(() => live && setFound([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [customerQ, customer]);

  useEffect(() => {
    if (productQ.trim().length < 2) {
      setProducts([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      listProducts({ q: productQ.trim(), limit: 8 })
        .then((r) => live && setProducts(r.items))
        .catch(() => live && setProducts([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [productQ]);

  function addVariant(product: ProductDetail, variantId: string) {
    const v = product.variants.find((x) => x.id === variantId);
    if (!v || lines.some((l) => l.variantId === variantId)) return;
    setLines((list) => [
      ...list,
      {
        variantId,
        name: v.label ? `${product.nameAr} ${v.label}` : product.nameAr,
        qty: '1',
        price: shown(v.price.priceMinor, decimals),
      },
    ]);
    setPicked(null);
    setProductQ('');
  }

  async function choose(p: ProductListItem) {
    try {
      const detail = await getProduct(p.id);
      const live = detail.variants.filter((v) => !v.archivedAt);
      if (live.length === 1) addVariant(detail, live[0]!.id);
      else setPicked(detail);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setFields({});
    if (!customer) return setError('اختر الزبون.');
    if (lines.length === 0) return setError('أضف صنفاً واحداً على الأقل.');
    const made = orderLines(lines, decimals);
    if (made.error) return setError(made.error);
    setSaving(true);
    setError(null);
    try {
      const order = await createOrder({
        customerId: customer.id,
        warehouseBranchId: place,
        repId: repId || null,
        currency: base,
        lines: made.lines,
        totalMinor: undefined,
        depositMinor: 0,
        depositReceiptId: null,
        deliveryDate: date || null,
        note: note.trim() === '' ? null : note,
      } as SalesOrderCreateInput);
      void navigate(`/distribution/orders/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const total = lines.reduce((sum, l) => {
    const qty = thousandths(l.qty);
    const price = minorOf(l.price, decimals);
    return qty === null || price === null ? sum : sum + Math.round((qty * price) / 1000);
  }, 0);

  return (
    <>
      <PageHeader
        title="طلبية جديدة"
        description="طلبية بيع مسبق للزبون: لا تُسجَّل مالياً حتى تُفوتَر عند التسليم."
        icon={<TruckIcon />}
        actions={
          <Link to="/distribution/orders">
            <Button variant="secondary" icon={<BackIcon />}>
              كل الطلبيات
            </Button>
          </Link>
        }
      />
      <form aria-label="طلبية جديدة" className="flex flex-col gap-6" onSubmit={(e) => void save(e)}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card>
          <CardHeader title="الزبون والتجهيز" />
          <div className="flex flex-col gap-4">
            {customer ? (
              <div className="flex items-center justify-between gap-3 rounded-control bg-surface-muted p-3">
                <span className="font-semibold">{customer.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                  غيّر
                </Button>
              </div>
            ) : (
              <>
                <SearchField
                  label="ابحث عن الزبون"
                  placeholder="الاسم أو الجوال"
                  value={customerQ}
                  onValueChange={setCustomerQ}
                />
                {found.length > 0 ? (
                  <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                    {found.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 p-3 text-start hover:bg-surface-muted"
                          onClick={() => {
                            setCustomer({ id: c.id, name: c.name });
                            setCustomerQ('');
                          }}
                        >
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-sm text-ink-muted">{c.phone ?? ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            <Select label="تُجهَّز من" value={place} onChange={(e) => setPlaceId(e.target.value)}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select label="المندوب" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">بلا مندوب</option>
              {(reps.data ?? [])
                .filter((r) => r.isActive)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.userName}
                  </option>
                ))}
            </Select>
            <DateField label="موعد التسليم" value={date} onChange={setDate} hint="اختياري" />
            <TextField
              label="ملاحظة"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 300))}
              error={fields.note}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="الأصناف" />
          <div className="flex flex-col gap-4">
            <SearchField
              label="ابحث عن صنف"
              placeholder="اسم الصنف أو الباركود"
              value={productQ}
              onValueChange={(v) => {
                setProductQ(v);
                setPicked(null);
              }}
            />
            {products.length > 0 && !picked ? (
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                {products.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 p-3 text-start hover:bg-surface-muted"
                      onClick={() => void choose(p)}
                    >
                      <span className="font-semibold">{p.nameAr}</span>
                      {p.price ? <Money minor={p.price.minMinor} currency={p.price.currency} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {picked ? (
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                {picked.variants
                  .filter((v) => !v.archivedAt)
                  .map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 p-3 text-start hover:bg-surface-muted"
                        onClick={() => addVariant(picked, v.id)}
                      >
                        <span className="font-semibold">{v.label ?? picked.nameAr}</span>
                        <Money minor={v.price.priceMinor} currency={v.price.currency} />
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
            {lines.length === 0 ? (
              <p className="py-3 text-center text-sm text-ink-muted">ابحث عن صنف لتضيفه إلى الطلبية.</p>
            ) : (
              <ul aria-label="بنود الطلبية" className="flex flex-col gap-3">
                {lines.map((l, i) => (
                  <li key={l.variantId} className="flex flex-wrap items-end gap-3">
                    <span className="min-w-0 flex-1 font-semibold">{l.name}</span>
                    <div className="w-24">
                      <TextField
                        label="الكمية"
                        inputMode="decimal"
                        dir="ltr"
                        value={l.qty}
                        onChange={(e) =>
                          setLines((list) =>
                            list.map((x, j) => (j === i ? { ...x, qty: e.target.value.slice(0, 9) } : x)),
                          )
                        }
                        inputClassName="num"
                      />
                    </div>
                    <div className="w-32">
                      <TextField
                        label={`السعر بـ ${base}`}
                        inputMode="decimal"
                        dir="ltr"
                        value={l.price}
                        onChange={(e) =>
                          setLines((list) =>
                            list.map((x, j) => (j === i ? { ...x, price: e.target.value.slice(0, 15) } : x)),
                          )
                        }
                        inputClassName="num"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`احذف ${l.name}`}
                      icon={<CloseIcon />}
                      onClick={() => setLines((list) => list.filter((_, j) => j !== i))}
                    />
                  </li>
                ))}
              </ul>
            )}
            {lines.length > 0 ? (
              <p className="flex justify-between gap-3 border-t border-line pt-3 font-semibold">
                <span>المجموع ({qtyOf(lines.reduce((n, l) => n + (thousandths(l.qty) ?? 0), 0))} قطعة)</span>
                <Money minor={total} currency={base} />
              </p>
            ) : null}
          </div>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="submit" loading={saving} disabled={!place}>
            احفظ الطلبية
          </Button>
        </div>
      </form>
    </>
  );
}

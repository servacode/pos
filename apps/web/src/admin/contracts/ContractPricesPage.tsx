import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CUSTOMER_KIND_LABELS,
  CUSTOMER_KINDS,
  getCurrency,
  toMinor,
  type ContractPrice,
  type CustomerKind,
  type CustomerListItem,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  Card,
  DeleteIcon,
  Dialog,
  EmptyState,
  IconButton,
  Money,
  OfferIcon,
  PageHeader,
  Select,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText } from '../../lib/dates';
import { ApiError, errorMessage } from '../../lib/api';
import { listCustomers } from '../customers/api';
import { VariantPicker, type PickedVariant } from '../purchases/VariantPicker';
import { SectionHead } from '../purchases/parts';
import { deleteContractPrice, listContractPrices, saveContractPrice } from './api';
import { DateField } from '../../lib/DateField';
import { PriceListSection } from './PriceListSection';

const fieldError = (e: unknown) =>
  e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e);

/** A price as the field shows it: 1250 minor units of a 2-decimal currency are «12.5» */
const priceText = (minor: number, currency: Parameters<typeof getCurrency>[0]) => {
  const { decimals } = getCurrency(currency);
  return String(minor / 10 ** decimals);
};

/** «c:<id>» is a customer, «k:hospital» a type of customer */
type Target = string;
const targetOf = (p: Pick<ContractPrice, 'customerId' | 'customerKind'>): Target =>
  p.customerId ? `c:${p.customerId}` : `k:${p.customerKind}`;

/**
 * «أسعار العقود» (03 › الأدوات الطبية): the price a hospital or a customer pays for a product, between
 * two days, used by the till automatically when that customer is picked. A price for the customer wins
 * over one for their type. Nothing posts here.
 */
export function ContractPricesPage() {
  const me = useMe();
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [filter, setFilter] = useState<Target>('');
  const [items, setItems] = useState<ContractPrice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ContractPrice | null>(null);
  const [removing, setRemoving] = useState<ContractPrice | null>(null);
  const [target, setTarget] = useState<Target>('');
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [price, setPrice] = useState('');
  const [validFrom, setValidFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [validTo, setValidTo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCustomers()
      .then((r) => setCustomers(r.items.filter((c) => !c.archived)))
      .catch(() => setCustomers([]));
  }, []);

  const load = useCallback(() => {
    setError(null);
    const [type, value] = filter.split(':');
    listContractPrices(
      type === 'c' ? { customerId: value! } : type === 'k' ? { kind: value as CustomerKind } : {},
    )
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [filter]);
  useEffect(load, [load]);

  function reset() {
    setEditing(null);
    setVariant(null);
    setPrice('');
    setValidTo('');
    setFormError(null);
  }

  function edit(p: ContractPrice) {
    setEditing(p);
    setTarget(targetOf(p));
    setVariant({ variantId: p.variantId, name: p.item });
    setPrice(priceText(p.priceMinor, base));
    setValidFrom(p.validFrom);
    setValidTo(p.validTo ?? '');
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!variant || !target) return;
    let priceMinor: number;
    try {
      priceMinor = toMinor(price, base);
    } catch {
      setFormError('اكتب السعر رقماً.');
      return;
    }
    const [type, value] = target.split(':');
    setSaving(true);
    try {
      await saveContractPrice(
        {
          ...(type === 'c' ? { customerId: value! } : { customerKind: value as CustomerKind }),
          variantId: variant.variantId,
          priceMinor,
          validFrom,
          validTo: validTo || null,
        },
        editing ? { id: editing.id, version: editing.version } : undefined,
      );
      reset();
      load();
    } catch (e) {
      setFormError(fieldError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: ContractPrice) {
    setError(null);
    try {
      await deleteContractPrice(p.id);
      load();
    } catch (e) {
      setError(fieldError(e));
    }
  }

  return (
    <AppShell>
      <title>أسعار العقود · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="أسعار العقود"
          description="سعر خاص لزبون أو لنوع من الزبائن (مشفى، عيادة…) على صنف، بين تاريخين. يطبّقه الصندوق وحده عند اختيار الزبون."
        />
        <section aria-label="سعر عقد" className="flex flex-col gap-3">
          <SectionHead title={editing ? 'تعديل السعر' : 'سعر جديد'} />
          <Card>
            <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
              {formError ? <Alert tone="error">{formError}</Alert> : null}
              <Select label="لمن" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">اختر</option>
                <optgroup label="نوع زبائن">
                  {CUSTOMER_KINDS.map((k) => (
                    <option key={k} value={`k:${k}`}>
                      كل زبائن النوع: {CUSTOMER_KIND_LABELS[k]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="زبون">
                  {customers.map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
              {variant ? (
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink">{variant.name}</span>
                  {editing ? null : (
                    <Button variant="ghost" onClick={() => setVariant(null)}>
                      غيّر الصنف
                    </Button>
                  )}
                </div>
              ) : (
                <VariantPicker onPick={setVariant} />
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  label="السعر للوحدة"
                  dir="ltr"
                  inputMode="decimal"
                  inputClassName="num"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <DateField label="من" value={validFrom} onChange={setValidFrom} />
                <DateField label="إلى (اختياري)" value={validTo} onChange={setValidTo} />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  icon={<AddIcon />}
                  loading={saving}
                  disabled={!variant || !target || !price.trim()}
                >
                  {editing ? 'احفظ التعديل' : 'أضف السعر'}
                </Button>
                {editing ? (
                  <Button variant="secondary" onClick={reset}>
                    إلغاء التعديل
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
        </section>

        <section aria-label="الأسعار" className="flex flex-col gap-3">
          <SectionHead title="الأسعار">
            <Select label="عرض" hideLabel value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">الكل</option>
              {CUSTOMER_KINDS.map((k) => (
                <option key={k} value={`k:${k}`}>
                  {CUSTOMER_KIND_LABELS[k]}
                </option>
              ))}
              {customers.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </Select>
          </SectionHead>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {items && items.length === 0 ? (
            <EmptyState
              icon={OfferIcon}
              title="لا أسعار عقود."
              description="أضف سعراً لمشفى أو عيادة على صنف، فيُسعَّر به الصندوق عند اختيارهم."
            />
          ) : null}
          <ul className="flex flex-col gap-2">
            {(items ?? []).map((p) => (
              <li key={p.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{p.item}</span>
                    <span className="text-sm text-ink-muted">
                      {p.customerName ?? `نوع الزبون: ${CUSTOMER_KIND_LABELS[p.customerKind!]}`}
                      {' · من '}
                      {dayText(p.validFrom, digits)}
                      {p.validTo ? ` إلى ${dayText(p.validTo, digits)}` : ' بلا نهاية'}
                    </span>
                  </span>
                  <Money minor={p.priceMinor} currency={p.currency} className="font-semibold" />
                  <Button variant="secondary" onClick={() => edit(p)}>
                    عدّل
                  </Button>
                  <IconButton
                    label={`احذف سعر ${p.item}`}
                    icon={<DeleteIcon />}
                    onClick={() => setRemoving(p)}
                  />
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <PriceListSection customers={customers} />
      </div>
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="احذف سعر العقد"
        description={removing?.item}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              تراجع
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const p = removing;
                setRemoving(null);
                if (p) void remove(p);
              }}
            >
              احذف السعر
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          يعود الصندوق إلى سعر المحل العادي لهذا الصنف مع هذا الزبون. لا يمكن التراجع عن الحذف.
        </p>
      </Dialog>
    </AppShell>
  );
}

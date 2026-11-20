import { useCallback, useEffect, useState } from 'react';
import type { DamagedStock, DamagedStockItem, DamagedStockLocation, SupplierListResponse } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  formatQuantity,
  Money,
  PackageOpenIcon,
  PageHeader,
  Select,
  Skeleton,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { createStocktake, getDamagedStock, listSuppliers, qtyOf, sendBackDamaged, today } from './api';

type Way = 'send_back' | 'write_off';
type Refund = 'credit' | 'cash' | 'bank';

const REFUND_TEXT: Record<Refund, string> = {
  credit: 'من رصيده عندي',
  cash: 'نقداً',
  bank: 'تحويل بنكي',
};

/** «12.5» → thousandths; the whole quantity when left as it came */
const pieces = (text: string, item: DamagedStockItem): number | null => {
  const q = qtyOf(text);
  return q !== null && q > 0 && q <= item.qty ? q : null;
};

/** What `qty` of the item cost, as the books hold it (its share of the item's value) */
const shareOf = (item: DamagedStockItem, qty: number) =>
  item.qty === 0 ? 0 : Math.round((item.valueMinor * qty) / item.qty);

/**
 * «البضاعة التالفة» (round 35, D7): what came back broken or past its date waits here for each store, out of
 * the stock that is sold, still at its cost. From here it goes back to the supplier (it comes off what the
 * store owes him, or he pays it back) or it is written off (the cost becomes a loss). Both are the ordinary
 * supplier return and stock count, made on the damaged place.
 */
export function DamagedStockPage() {
  const me = useMe();
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const canSendBack = me.user.permissions.includes('purchases.manage');
  const canWriteOff = me.user.permissions.includes('inventory.adjust');
  const [data, setData] = useState<DamagedStock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [act, setAct] = useState<{ way: Way; location: DamagedStockLocation; item: DamagedStockItem } | null>(
    null,
  );

  const load = useCallback(() => {
    getDamagedStock()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const total = (data?.locations ?? []).reduce((sum, l) => sum + l.totalValueMinor, 0);
  return (
    <AppShell>
      <title>البضاعة التالفة · SERVA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="البضاعة التالفة"
          description="قطع رجعت تالفة أو منتهية: لا تُباع، وتبقى بكلفتها حتى تُرجعها للمورد أو تشطبها."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        {!data && !error ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.locations.length === 0 ? (
          <EmptyState
            icon={PackageOpenIcon}
            title="لا بضاعة تالفة الآن."
            description="القطع التي تُرجَع تالفة من الكاشير أو من المندوب تظهر هنا بدل أن تعود إلى الرف."
          />
        ) : null}
        {data && data.locations.length > 0 ? (
          <p className="text-sm text-ink-muted">
            قيمتها بكلفتها: <Money minor={total} currency={base} />
          </p>
        ) : null}
        {(data?.locations ?? []).map((location) => (
          <Card key={location.branchId}>
            <CardHeader
              title={location.ownerName}
              description="بكلفتها في المخزون"
              action={<Money minor={location.totalValueMinor} currency={base} />}
            />
            <ul className="flex flex-col divide-y divide-line">
              {location.items.map((item) => (
                <li key={item.variantId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold text-ink">{item.name}</span>
                    <span className="text-sm text-ink-muted">
                      <bdi className="num">{formatQuantity(item.qty, digits)}</bdi> قطعة ·{' '}
                      <Money minor={item.valueMinor} currency={base} />
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canSendBack ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAct({ way: 'send_back', location, item })}
                      >
                        رجّعها للمورد
                      </Button>
                    ) : null}
                    {canWriteOff ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAct({ way: 'write_off', location, item })}
                      >
                        اشطبها
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {act ? (
        <ActDialog
          key={`${act.way}:${act.item.variantId}`}
          act={act}
          onClose={() => setAct(null)}
          onDone={(message) => {
            setAct(null);
            setDone(message);
            load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

/** The question of one item: how many, and for the supplier whom and how he pays back */
function ActDialog({
  act,
  onClose,
  onDone,
}: {
  act: { way: Way; location: DamagedStockLocation; item: DamagedStockItem };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const me = useMe();
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const { way, location, item } = act;
  const [qty, setQty] = useState(String(item.qty / 1000));
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [refund, setRefund] = useState<Refund>('credit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (way !== 'send_back') return;
    listSuppliers()
      .then((s) => {
        setSuppliers(s);
        setSupplierId((id) => id || (s.items.find((x) => !x.archived)?.id ?? ''));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [way]);

  const amount = pieces(qty, item);
  async function save() {
    if (amount === null) {
      setError(`اكتب عدداً من 1 إلى ${formatQuantity(item.qty, digits)}.`);
      return;
    }
    if (way === 'send_back' && !supplierId) {
      setError('اختر المورد.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (way === 'send_back') {
        const made = await sendBackDamaged({
          supplierId,
          branchId: location.branchId,
          date: today(),
          refund,
          note: 'بضاعة تالفة',
          lines: [{ variantId: item.variantId, qty: amount }],
        });
        onDone(`سُجّل المرتجع ${made.number} إلى المورد، وخرجت «${item.name}» من البضاعة التالفة.`);
      } else {
        await createStocktake({
          branchId: location.branchId,
          date: today(),
          note: 'شطب بضاعة تالفة',
          lines: [{ variantId: item.variantId, countedQty: item.qty - amount }],
        });
        onDone(`شُطبت «${item.name}» من البضاعة التالفة، وسُجّلت كلفتها خسارة.`);
      }
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && onClose()}
      size="md"
      title={way === 'send_back' ? 'رجّعها للمورد' : 'اشطبها'}
      description={`${item.name} · ${location.ownerName}`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="العدد"
          inputMode="decimal"
          dir="ltr"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setError(null);
          }}
          inputClassName="num"
          hint={`الموجود ${formatQuantity(item.qty, digits)}`}
        />
        {way === 'send_back' ? (
          <>
            <Select label="المورد" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">اختر المورد</option>
              {(suppliers?.items ?? [])
                .filter((s) => !s.archived)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
            <Select label="كيف يسترد" value={refund} onChange={(e) => setRefund(e.target.value as Refund)}>
              {(Object.keys(REFUND_TEXT) as Refund[]).map((r) => (
                <option key={r} value={r}>
                  {REFUND_TEXT[r]}
                </option>
              ))}
            </Select>
            <p className="text-sm text-ink-muted">
              تخرج القطع من هنا بكلفتها
              {amount !== null ? (
                <>
                  {' '}
                  <Money minor={shareOf(item, amount)} currency={base} />
                </>
              ) : null}
              ، ويُحسب للمورد هذا المبلغ.
            </p>
          </>
        ) : (
          <Alert tone="warning">
            تُشطب القطع من المخزون
            {amount !== null ? (
              <>
                {' '}
                وتصير خسارة <Money minor={shareOf(item, amount)} currency={base} />
              </>
            ) : null}
            . لا يُسترجع هذا الشطب من هنا.
          </Alert>
        )}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            رجوع
          </Button>
          <Button type="submit" loading={saving}>
            {way === 'send_back' ? 'سجّل المرتجع' : 'اشطب'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

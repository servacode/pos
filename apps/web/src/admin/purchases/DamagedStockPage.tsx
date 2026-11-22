import { useCallback, useEffect, useState } from 'react';
import type { DamagedStock, DamagedStockItem, DamagedStockLocation, SupplierListResponse } from '@serva/core';
import {
  Alert,
  Button,
  Dialog,
  formatQuantity,
  PackageOpenIcon,
  Select,
  Skeleton,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { SerialPick } from './SerialPick';
import { errorMessage } from '../../lib/api';
import { ReportScreen } from '../reports/parts';
import { Amt, PageTop, Panel, SalesPage } from '../sales/ui';
import {
  createStocktake,
  getDamagedStock,
  listSuppliers,
  newDocumentId,
  qtyOf,
  sendBackDamaged,
  storeToday,
} from './api';
import './inventory.css';

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
    setError(null);
    getDamagedStock()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const total = (data?.locations ?? []).reduce((sum, l) => sum + l.totalValueMinor, 0);
  const kinds = (data?.locations ?? []).reduce((sum, l) => sum + l.items.length, 0);
  return (
    <ReportScreen me={me} access={['inventory.adjust', 'purchases.manage']} title="البضاعة التالفة">
      <SalesPage>
        <PageTop
          title="البضاعة التالفة"
          subtitle="قطع رجعت تالفة أو منتهية: لا تُباع، وتبقى بكلفتها حتى تُرجعها للمورد أو تشطبها."
        />
        {error ? (
          <Alert tone="error">
            <span className="flex flex-wrap items-center gap-3">
              {error}
              <Button variant="secondary" size="sm" onClick={load}>
                حاول مرة أخرى
              </Button>
            </span>
          </Alert>
        ) : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        {!data && !error ? <Skeleton className="h-40 w-full" /> : null}
        {data && data.locations.length === 0 ? (
          <section className="sx-card ix-empty" aria-label="لا بضاعة تالفة">
            <PackageOpenIcon size={32} />
            <h3>لا بضاعة تالفة الآن.</h3>
            <p>القطع التي تُرجَع تالفة من الكاشير أو من المندوب تظهر هنا بدل أن تعود إلى الرف.</p>
          </section>
        ) : null}
        {data && data.locations.length > 0 ? (
          <section aria-label="قيمة التالف" className="sx-card sx-strip ix-hero">
            <div>
              <span className="sx-eyebrow">قيمة التالف بكلفته</span>
              <span className="v big">
                <Amt minor={total} currency={base} />
              </span>
              <span className="note">لا تُحسب من مخزون البيع</span>
            </div>
            <div>
              <span className="sx-eyebrow">أصناف تالفة</span>
              <span className="v sx-n">{formatQuantity(kinds * 1000, digits)}</span>
              <span className="note">في {data.locations.length.toLocaleString('en-US')} مكان</span>
            </div>
            <div>
              <span className="sx-eyebrow">ماذا تفعل بها</span>
              <span className="note">ترجعها للمورد فتنقص من دينك له، أو تشطبها فتصير خسارة.</span>
            </div>
          </section>
        ) : null}
        {(data?.locations ?? []).map((location) => (
          <Panel
            key={location.branchId}
            title={location.ownerName}
            aside={<Amt minor={location.totalValueMinor} currency={base} />}
          >
            <ul className="ix-list" aria-label={`التالف في ${location.ownerName}`}>
              {location.items.map((item) => (
                <li key={item.variantId}>
                  <div className="ix-main">
                    <span className="t">{item.name}</span>
                    <span className="d">
                      <bdi className="sx-n">{formatQuantity(item.qty, digits)}</bdi> قطعة ·{' '}
                      <Amt minor={item.valueMinor} currency={base} />
                    </span>
                  </div>
                  <div className="ix-acts">
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
                        variant="danger-soft"
                        onClick={() => setAct({ way: 'write_off', location, item })}
                      >
                        اشطبها
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </SalesPage>
      {act ? (
        <ActDialog
          key={`${act.way}:${act.item.variantId}`}
          act={act}
          asOf={data?.asOf}
          onClose={() => setAct(null)}
          onDone={(message) => {
            setAct(null);
            setDone(message);
            load();
          }}
        />
      ) : null}
    </ReportScreen>
  );
}

/** The question of one item: how many, and for the supplier whom and how he pays back */
function ActDialog({
  act,
  asOf,
  onClose,
  onDone,
}: {
  act: { way: Way; location: DamagedStockLocation; item: DamagedStockItem };
  /** When the list the owner is looking at was read: a write-off counts what moved after it */
  asOf?: string | undefined;
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
  // One id per opening of the dialog: a second press (or a retry) answers the document already made
  const [docId] = useState(newDocumentId);
  // A product that tracks serial numbers: which numbers leave (round 62). A write-off may leave them for later
  const [serials, setSerials] = useState<string[]>([]);

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
  const tracked = item.tracksSerial === true && amount !== null;
  const wholePieces = amount === null ? 0 : Math.ceil(amount / 1000);
  async function save() {
    if (amount === null) {
      setError(`اكتب عدداً من 1 إلى ${formatQuantity(item.qty, digits)}.`);
      return;
    }
    if (tracked && way === 'send_back' && serials.length !== wholePieces) {
      setError(`اختر ${wholePieces} رقماً تسلسلياً، واحداً لكل قطعة.`);
      return;
    }
    if (tracked && way === 'write_off' && serials.length > 0 && serials.length !== wholePieces) {
      setError(`اختر ${wholePieces} رقماً تسلسلياً، أو اترك الاختيار كله وصحّحها لاحقاً.`);
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
          date: storeToday(me.tenant.timezone),
          refund,
          note: 'بضاعة تالفة',
          lines: [{ variantId: item.variantId, qty: amount, ...(tracked ? { serials } : {}) }],
        });
        onDone(`سُجّل المرتجع ${made.number} إلى المورد، وخرجت «${item.name}» من البضاعة التالفة.`);
      } else {
        await createStocktake({
          id: docId,
          ...(tracked && serials.length === 0 ? { serialsLater: true as const } : {}),
          branchId: location.branchId,
          date: storeToday(me.tenant.timezone),
          ...(asOf ? { countedAt: asOf } : {}),
          note: 'شطب بضاعة تالفة',
          lines: [
            {
              variantId: item.variantId,
              countedQty: item.qty - amount,
              ...(tracked && serials.length > 0 ? { serials } : {}),
            },
          ],
        });
        onDone(
          `شُطبت «${item.name}» من البضاعة التالفة، وسُجّلت كلفتها خسارة.${
            tracked && serials.length === 0
              ? ' لم تُحدَّد أرقامها التسلسلية: صحّحها من صفحة «الأرقام التسلسلية».'
              : ''
          }`,
        );
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
        {tracked ? (
          <div className="sx">
            <SerialPick
              name={item.name}
              variantId={item.variantId}
              branchId={location.branchId}
              pieces={wholePieces}
              picked={serials}
              onChange={setSerials}
              optional={way === 'write_off'}
            />
          </div>
        ) : null}
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
                  <Amt minor={shareOf(item, amount)} currency={base} />
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
                وتصير خسارة <Amt minor={shareOf(item, amount)} currency={base} />
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
          <Button type="submit" variant={way === 'send_back' ? 'primary' : 'danger'} loading={saving}>
            {way === 'send_back' ? 'سجّل المرتجع' : 'اشطب'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

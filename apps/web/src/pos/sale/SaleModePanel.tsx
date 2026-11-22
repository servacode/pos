import { createPortal } from 'react-dom';
import { Suspense, type ReactNode } from 'react';
import { lazyChunk, TillBoundary } from '../chunks';
import { lineGross } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import { holdExpiryDaysOf } from '@serva/core/contracts/till';
import { businessDateOf } from '@serva/core/sale';
import type { prescriptionNeed } from '@serva/core/pharmacy';
import { Button, CloseIcon, displayNumber, KeyIcon, Money, useDigits } from '@serva/ui';
import { type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import type { planBatches } from './batches';
import { AdjustPanel, NEED_TEXT, type AdjustMode, type AdjustValue } from './AdjustPanel';
import {
  addItem,
  priceCart,
  setPriceTier,
  applyContractPrices,
  type ItemChoice,
  EMPTY_CART,
  removeLine,
  unitPriceOf,
  updateLine,
  type ApprovalNeed,
  type Cart,
  type CartLine as Line,
  type PricedCart,
  type PricingContext,
} from './cart';
import { fetchContractPrices } from '../rentals/api';
import { clearInvoiceDiscount, withGroupDiscount } from './groupDiscount';
import type { modelPieces } from './models';
import { UnitPanel } from './UnitPanel';
import { VariantPicker } from './VariantPicker';
import { cartFromOrder } from '../hall/hallCart';
import { HoldPanel } from './HoldPanel';
import { HeldList, HoldNamePanel } from './HeldList';
import { dollarNote } from './ItemsArea';
import { placeholderIconFor } from '../../lib/productPlaceholder';
import type { waitingOrders } from './onlineOrders';
import { ONLINE_SOLD_KEY, orderCart } from './onlineOrders';
import { SerialPanel } from './SerialPanel';
import { Kbd } from './Kbd';
import { SalePanel } from './SalePanel';
import {
  LAST_UNIT_KEY,
  SELLER_KEY,
  unitName,
  SHORTCUTS,
  type JustMade,
  type PosServices,
  type SaleMode,
  type SaleNotice,
  type SaleScreenProps,
} from './saleTypes';

// «تالف / هدر» needs the server and is rarely opened: its own chunk keeps the cashier's size down
// «أضف صنف جديد» and «بدائل متوفرة» (a pharmacy only) are rarely opened: their own chunks too
const NewProductPanel = lazyChunk(() =>
  import('./NewProductPanel').then((m) => ({ default: m.NewProductPanel })),
);
const AlternativesPanel = lazyChunk(() =>
  import('./AlternativesPanel').then((m) => ({ default: m.AlternativesPanel })),
);
const WastePanel = lazyChunk(() => import('./WastePanel').then((m) => ({ default: m.WastePanel })));
const PaymentPanel = lazyChunk(() =>
  import('../pay/PaymentPanel').then((m) => ({ default: m.PaymentPanel })),
);
// the table board and the bill split serve a restaurant or cafe only: their own chunks too
const TableBoard = lazyChunk(() => import('./TableBoard').then((m) => ({ default: m.TableBoard })));
const CancelSentLine = lazyChunk(() =>
  import('../hall/CancelSentLine').then((m) => ({ default: m.CancelSentLine })),
);
const OnlineOrdersPanel = lazyChunk(() =>
  import('./OnlineOrdersPanel').then((m) => ({ default: m.OnlineOrdersPanel })),
);
// «كود الخصم» is typed rarely: its own chunk too
const CouponForm = lazyChunk(() => import('./CouponForm'));
// a prescription (pharmacy) and a drink's choices (restaurant, café) serve one kind of store each: their own chunks too
const PrescriptionPanel = lazyChunk(() =>
  import('./PrescriptionPanel').then((m) => ({ default: m.PrescriptionPanel })),
);
const ModifierPanel = lazyChunk(() => import('./ModifierPanel').then((m) => ({ default: m.ModifierPanel })));
const SplitBill = lazyChunk(() => import('../hall/SplitBill').then((m) => ({ default: m.SplitBill })));

export interface SaleModePanelProps {
  props: SaleScreenProps;
  effectiveMode: SaleMode;
  catalog: Catalog;
  cart: Cart;
  ctx: PricingContext;
  staff: readonly StaffMember[];
  session: StaffSession;
  settings: NonNullable<Catalog['settings']>;
  seller: string;
  pos: PosServices;
  soldOnline: string[];
  setSoldOnline: (ids: string[]) => void;
  setCart: SaleScreenProps['setCart'];
  setMode: (mode: SaleMode) => void;
  setSelected: (lineNo: number | null) => void;
  setSeller: (id: string) => void;
  setNotice: (notice: SaleNotice | null) => void;
  setJustAdded: (text: string | null) => void;
  setJustSwapped: (text: string | null) => void;
  setJustMade: (made: JustMade | null) => void;
  setPlanFeeMinor: (minor: number) => void;
  add: (
    item: CatalogItem,
    hit?: BarcodeHit | null,
    weighedQty?: number,
    choice?: ItemChoice,
    feeMinor?: number,
  ) => void;
  lineOf: (lineNo: number) => Line | null;
  checkLine: (line: Line, value: AdjustValue) => { error: string } | { need: ApprovalNeed | null };
  applyLine: (line: Line, value: AdjustValue, approval: Approval | null) => void;
  checkInvoice: (value: AdjustValue) => { error: string } | { need: ApprovalNeed | null };
  removeNow: (lineNo: number, index: number, undoable?: boolean) => void;
  holdSale: (name?: string) => void;
  priced: PricedCart | null;
  totalMinor: number;
  lineCount: number;
  packsByVariant: Map<string, BarcodeHit[]>;
  lastUnits: Record<string, string>;
  setLastUnits: (units: Record<string, string>) => void;
  saleUnits: { current: Record<string, string> };
  pieces: ReturnType<typeof modelPieces>;
  inCartQty: Map<string, number>;
  pickerAddedAt: { current: number };
  outOk: { current: boolean };
  cartRef: { current: Cart };
  itemsArea: ReactNode;
  replacedLine: Line | undefined;
  batchPlan: ReturnType<typeof planBatches>;
  rxNeed: ReturnType<typeof prescriptionNeed>;
  hasControlled: boolean;
  waitingOnline: ReturnType<typeof waitingOrders>;
  service: NonNullable<Catalog['settings']>['service'] | null;
}

const closeButton = (label: string, onClick: () => void) => (
  <Button
    variant="secondary"
    size="md"
    icon={<CloseIcon size={20} />}
    aria-keyshortcuts="Escape"
    onClick={onClick}
  >
    {label}
    <Kbd>Esc</Kbd>
  </Button>
);

/** What the items area shows for the sale's mode: a panel for a line, the payment, a held list, the help... */
export function SaleModePanel(p: SaleModePanelProps) {
  const {
    props,
    effectiveMode,
    catalog,
    cart,
    ctx,
    staff,
    session,
    settings,
    seller,
    pos,
    soldOnline,
    setSoldOnline,
    setCart,
    setMode,
    setSelected,
    setSeller,
    setNotice,
    setJustAdded,
    setJustSwapped,
    setJustMade,
    setPlanFeeMinor,
    add,
    lineOf,
    checkLine,
    applyLine,
    checkInvoice,
    removeNow,
    holdSale,
    priced,
    totalMinor,
    lineCount,
    packsByVariant,
    lastUnits,
    setLastUnits,
    saleUnits,
    pieces,
    inCartQty,
    pickerAddedAt,
    outOk,
    cartRef,
    itemsArea,
    replacedLine,
    batchPlan,
    rxNeed,
    hasControlled,
    waitingOnline,
    service,
  } = p;
  const digits = useDigits();
  /** A picker over the grid it was opened from: the grid stays in view behind a scrim, the panel centred on the screen */
  const overPanel = (panel: ReactNode) => (
    <>
      {itemsArea}
      {/* In the page body, not inside the items tab: on a phone that tab is hidden while the cart shows (a unit sheet opened from the cart) */}
      {createPortal(
        <div
          className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/45 p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMode({ kind: 'items' });
          }}
        >
          {panel}
        </div>,
        document.body,
      )}
    </>
  );
  return (
    <>
      {effectiveMode.kind === 'pay' && priced ? (
        <TillBoundary onBack={() => setMode({ kind: 'items' })}>
          <Suspense fallback={null}>
            <PaymentPanel
              cart={cart}
              ctx={ctx}
              totalMinor={totalMinor}
              catalog={catalog}
              shiftId={props.shiftId}
              cashierId={session.userId}
              canCredit={session.permissions.has('sale.credit')}
              staff={staff}
              salespersonId={seller !== session.userId ? seller : null}
              onWholesaleCustomer={() => setCart((c) => setPriceTier(c, 'wholesale'))}
              onPlanFee={setPlanFeeMinor}
              onCustomer={(picked) =>
                setCart((c) => {
                  // The customer's group discount comes with them and leaves with them (sale/groupDiscount.ts)
                  if (picked)
                    return withGroupDiscount(
                      { ...c, customer: picked },
                      catalog.customers.find((k) => k.id === picked.id),
                    );
                  const { customer: _gone, ...rest } = c;
                  return withGroupDiscount(rest, undefined);
                })
              }
              onContractPrices={async (customerId) => {
                // A hospital's or clinic's contract prices (03 › أسعار العقود); none offline
                const prices = pos.device.token
                  ? await fetchContractPrices(customerId, pos.device.token, pos.fetch)
                  : [];
                if (prices.length > 0)
                  setCart((c) => ({ ...applyContractPrices(c, prices), contractPriced: true }));
                return prices.length > 0;
              }}
              onBack={() => setMode({ kind: 'items' })}
              onCompleted={(entry) => {
                // The seller picked is for this sale only
                setSeller(session.userId);
                void pos.local.remove(SELLER_KEY);
                setMode({ kind: 'items' });
                setSelected(null);
                const order = cart.onlineOrder;
                if (order) {
                  const ids = [...soldOnline.filter((id) => id !== order.id).slice(-49), order.id];
                  setSoldOnline(ids);
                  void pos.local.set(ONLINE_SOLD_KEY, ids);
                }
                props.onSaved(entry);
              }}
            />
          </Suspense>
        </TillBoundary>
      ) : effectiveMode.kind === 'done' ? (
        props.done
      ) : effectiveMode.kind === 'line' && lineOf(effectiveMode.lineNo) ? (
        (() => {
          const line = lineOf(effectiveMode.lineNo)!;
          const modes: AdjustMode[] =
            effectiveMode.adjust === 'qty' ? ['qty'] : ['percent', 'amount', 'price'];
          return (
            <AdjustPanel
              key={`${line.lineNo}:${effectiveMode.adjust}`}
              title={
                effectiveMode.adjust === 'qty'
                  ? line.weighed
                    ? 'الوزن'
                    : 'الكمية'
                  : effectiveMode.adjust === 'price'
                    ? catalog.byVariant.get(line.variantId)?.isService &&
                      catalog.byVariant.get(line.variantId)?.price.priceMinor === 0
                      ? 'حدّد الأجرة'
                      : 'سعر جديد في السلة'
                    : 'خصم على السطر'
              }
              subtitle={line.name}
              modes={modes}
              initialMode={effectiveMode.adjust}
              currency={ctx.currency}
              fractions={line.weighed}
              staff={staff}
              check={(value) => checkLine(line, value)}
              onApply={(value, approval) => applyLine(line, value, approval)}
              onRemove={
                line.adjustment
                  ? () => {
                      setCart((c) => updateLine(c, line.lineNo, { adjustment: null, approval: null }));
                      setMode({ kind: 'items' });
                    }
                  : undefined
              }
              onClose={() => {
                // A service whose fee was never entered leaves no line behind (cancel = nothing added)
                const item = catalog.byVariant.get(line.variantId);
                if (item?.isService && item.price.priceMinor === 0 && line.priceMinor === 0)
                  removeNow(line.lineNo, cart.lines.indexOf(line), false);
                else setMode({ kind: 'items' });
              }}
              preview={() => (
                <span>
                  {catalog.byVariant.get(line.variantId)?.isService ? (
                    'خدمة: الأجرة تُحدَّد عند البيع'
                  ) : (
                    <>
                      سعر الرف للواحدة{' '}
                      <Money
                        minor={unitPriceOf(line, ctx)}
                        currency={ctx.currency}
                        className="font-semibold text-ink"
                      />
                      {' · '}السطر{' '}
                      <Money
                        minor={lineGross(unitPriceOf(line, ctx), line.qty)}
                        currency={ctx.currency}
                        className="font-semibold text-ink"
                      />
                    </>
                  )}
                </span>
              )}
            />
          );
        })()
      ) : effectiveMode.kind === 'fee' ? (
        <AdjustPanel
          key={effectiveMode.item.variantId}
          title="حدّد الأجرة"
          subtitle={effectiveMode.item.name}
          modes={['price']}
          initialMode="price"
          compact
          currency={ctx.currency}
          staff={staff}
          check={(value) =>
            value.mode === 'price' && value.minor > 0 ? { need: null } : { error: 'اكتب الأجرة بالأرقام.' }
          }
          onApply={(value) => {
            if (value.mode !== 'price') return;
            const { item, hit } = effectiveMode;
            setMode({ kind: 'items' });
            add(item, hit, undefined, undefined, value.minor);
          }}
          onClose={() => setMode({ kind: 'items' })}
          preview={() => <span>خدمة: الأجرة تُحدَّد عند البيع</span>}
        />
      ) : effectiveMode.kind === 'invoice' ? (
        <AdjustPanel
          title="خصم على الفاتورة"
          subtitle={(() => {
            // A service (alteration fee, rent, contract) never takes the invoice discount
            const services = cart.lines.filter((l) => l.isService).length;
            const goods = displayNumber(String(lineCount - services), digits);
            return `يشمل كل أسطر الفاتورة (${goods})${services > 0 ? ' ما عدا الخدمات' : ''} وما تضيفه بعدها`;
          })()}
          modes={['percent', 'amount']}
          initialMode="percent"
          currency={ctx.currency}
          staff={staff}
          check={checkInvoice}
          onApply={(value, approval) => {
            setCart((c) => {
              const { invoiceGroup: _group, ...rest } = c;
              return {
                ...rest,
                invoiceDiscount:
                  value.mode === 'percent'
                    ? { type: 'percent', bp: value.bp }
                    : { type: 'amount', minor: (value as { minor: number }).minor },
                invoiceApproval: approval,
              };
            });
            setMode({ kind: 'items' });
          }}
          extra={
            <Suspense fallback={null}>
              <CouponForm
                coupons={catalog.coupons}
                cart={cart}
                ctx={ctx}
                timeZone={settings.timezone}
                onApplied={(applied) => {
                  setCart((c) => ({ ...c, coupon: applied }));
                  setMode({ kind: 'items' });
                }}
                onRemove={() => {
                  setCart((c) => {
                    const { coupon: _gone, ...rest } = c;
                    return rest;
                  });
                  setMode({ kind: 'items' });
                }}
              />
            </Suspense>
          }
          onRemove={
            cart.invoiceDiscount
              ? () => {
                  setCart(clearInvoiceDiscount);
                  setMode({ kind: 'items' });
                }
              : undefined
          }
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'approve' ? (
        <SalePanel title="موافقة على الخصم" icon={<KeyIcon size={20} />}>
          <ManagerCode
            staff={staff}
            permission="sale.discount_over_limit"
            reason={NEED_TEXT[effectiveMode.need]}
            onApproved={(approval) => {
              const { lineNo } = effectiveMode;
              setCart((c) =>
                lineNo === null ? { ...c, invoiceApproval: approval } : updateLine(c, lineNo, { approval }),
              );
              setMode({ kind: 'items' });
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />
        </SalePanel>
      ) : effectiveMode.kind === 'batchApprove' ? (
        <SalePanel title="موافقة على بيع بلا دفعة صالحة" icon={<KeyIcon size={20} />}>
          <ManagerCode
            staff={staff}
            permission="sale.discount_over_limit"
            reason={
              batchPlan.uncovered.some((i) => i.expiredQty > 0)
                ? 'دفعة منتهية الصلاحية: يوافق المدير على بيعها، ويُسجَّل ذلك'
                : 'لا دفعة صالحة تكفي بعض الأصناف: يوافق المدير على بيعها'
            }
            onApproved={(approval) => {
              setCart((c) => ({ ...c, batchApproval: { sig: batchPlan.signature, approval } }));
              setMode({ kind: 'items' });
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />
        </SalePanel>
      ) : effectiveMode.kind === 'rx' ? (
        <Suspense fallback={null}>
          <PrescriptionPanel
            need={rxNeed}
            initial={cart.prescription}
            controlled={hasControlled}
            onSave={(prescription) => {
              setCart((c) => ({ ...c, prescription }));
              setMode({ kind: 'pay' });
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'serial' && lineOf(effectiveMode.lineNo) ? (
        <SerialPanel
          key={effectiveMode.lineNo}
          line={lineOf(effectiveMode.lineNo)!}
          taken={
            new Set(
              cart.lines.filter((l) => l.lineNo !== effectiveMode.lineNo).flatMap((l) => l.serials ?? []),
            )
          }
          catalog={catalog}
          staff={staff}
          onSave={(serials, override) => {
            setCart((c) =>
              updateLine(c, effectiveMode.lineNo, {
                serials,
                serialOverrides: override ? serials : [],
                serialApprovedBy: override?.approval.userId ?? null,
              }),
            );
            setMode({ kind: 'items' });
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'unit' && catalog.byVariant.has(effectiveMode.variantId) ? (
        overPanel(
          <UnitPanel
            key={effectiveMode.variantId}
            item={catalog.byVariant.get(effectiveMode.variantId)!}
            packs={packsByVariant.get(effectiveMode.variantId) ?? []}
            lastUnit={lastUnits[effectiveMode.variantId]}
            onPick={(hit) => {
              const item = catalog.byVariant.get(effectiveMode.variantId)!;
              const next = { ...lastUnits, [effectiveMode.variantId]: hit ? hit.barcode.id : 'piece' };
              setLastUnits(next);
              saleUnits.current[effectiveMode.variantId] = hit ? hit.barcode.id : 'piece';
              void pos.local.set(LAST_UNIT_KEY, next);
              setMode({ kind: 'items' });
              const old = effectiveMode.replaceLine
                ? cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                : undefined;
              if (old) {
                // The same quantity in the other unit: the line is replaced, not added to
                setCart((c) => {
                  const index = c.lines.findIndex((l) => l.lineNo === old.lineNo);
                  const without = removeLine(c, old.lineNo);
                  const next = addItem(without, item, hit, old.qty);
                  // The new line takes the old one's place, not the end of the cart
                  const added = next.lines.length > without.lines.length ? next.lines.at(-1) : undefined;
                  if (!added || index < 0) return next;
                  const lines = next.lines.slice(0, -1);
                  lines.splice(Math.min(index, lines.length), 0, added);
                  return { ...next, lines };
                });
                setSelected(null);
              } else {
                add(item, hit);
                setJustAdded(`${item.name} · ${unitName(hit)}`);
              }
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />,
        )
      ) : effectiveMode.kind === 'pick' && pieces.get(effectiveMode.productId) ? (
        overPanel(
          <VariantPicker
            key={effectiveMode.productId}
            {...(effectiveMode.initial ? { initial: effectiveMode.initial } : {})}
            {...(effectiveMode.replaceLine !== undefined
              ? {
                  actionLabel: 'بدّل في السلة',
                  swap: true,
                  ...(cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                    ? { fixedQty: cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)!.qty }
                    : {}),
                }
              : {})}
            name={pieces.get(effectiveMode.productId)![0]!.productName ?? ''}
            pieces={pieces.get(effectiveMode.productId)!}
            inCart={inCartQty}
            priceNote={(minor, currency) =>
              catalog.settings
                ? dollarNote(minor, currency, { base: catalog.settings.baseCurrency, rates: catalog.rates })
                : null
            }
            Kind={placeholderIconFor({
              categoryName: null,
              name: pieces.get(effectiveMode.productId)![0]!.productName ?? '',
              sectors: catalog.settings?.sectors ?? [],
            })}
            onAdd={(piece, qty) => {
              pickerAddedAt.current = Date.now();
              setMode({ kind: 'items' });
              const old =
                effectiveMode.replaceLine !== undefined
                  ? cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                  : undefined;
              if (old) {
                // Another size or colour for the same quantity: the line is replaced where it stands
                setCart((c) => {
                  const index = c.lines.findIndex((l) => l.lineNo === old.lineNo);
                  const without = removeLine(c, old.lineNo);
                  const next = addItem(without, piece, null, old.qty);
                  const added = next.lines.length > without.lines.length ? next.lines.at(-1) : undefined;
                  if (!added || index < 0) return next;
                  const lines = next.lines.slice(0, -1);
                  lines.splice(Math.min(index, lines.length), 0, added);
                  return { ...next, lines };
                });
                setSelected(null);
                setJustSwapped(piece.name);
                return;
              }
              setJustAdded(piece.name);
              // The picker has already asked about a size with nothing left: no second question
              outOk.current = true;
              try {
                add(piece, null, qty > 1 ? qty * 1000 : undefined);
              } finally {
                outOk.current = false;
              }
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />,
        )
      ) : effectiveMode.kind === 'choose' ? (
        <Suspense fallback={null}>
          <ModifierPanel
            key={effectiveMode.item.variantId}
            item={effectiveMode.item}
            onAdd={(choice) => {
              const { item, hit } = effectiveMode;
              setMode({ kind: 'items' });
              add(item, hit, undefined, choice);
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'alternatives' && catalog.byVariant.get(effectiveMode.variantId) ? (
        <Suspense fallback={null}>
          <AlternativesPanel
            source={catalog.byVariant.get(effectiveMode.variantId)!}
            catalog={catalog}
            today={businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff)}
            replacing={replacedLine?.name}
            onPick={(picked, available) => {
              setMode({ kind: 'items' });
              // The blocked line (no valid batch, expired) goes: the alternative takes its place with its quantity,
              // as much as the alternative has (round 39)
              if (replacedLine) {
                const without = removeLine(cartRef.current, replacedLine.lineNo);
                cartRef.current = without;
                setCart(() => without);
                setSelected(null);
                const same = replacedLine.packQty === 1000 ? replacedLine.qty : 1000;
                add(picked, null, Math.max(1000, Math.min(same, available)));
                return;
              }
              add(picked, null);
            }}
            onClose={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'newProduct' ? (
        <Suspense fallback={null}>
          <NewProductPanel
            barcode={effectiveMode.barcode}
            currency={ctx.currency}
            categories={catalog.categoryChoices ?? []}
            staff={staff}
            canManage={session.permissions.has('catalog.manage')}
            userId={session.userId}
            businessDate={() => businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff)}
            pharmacy={Boolean(settings.pharmacy)}
            onClose={() => setMode({ kind: 'items' })}
            onDone={(added) => {
              setMode({ kind: 'items' });
              // It goes into the cart as soon as the catalog holds it (the effect above), so the cashier scans nothing twice
              setJustMade({ variantId: added.variantId, name: added.name, offline: added.offline });
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'waste' ? (
        <Suspense fallback={null}>
          <WastePanel
            catalog={catalog}
            reasons={settings.till?.wasteReasons}
            staff={staff}
            canAdjust={session.permissions.has('inventory.adjust')}
            userId={session.userId}
            onClose={() => setMode({ kind: 'items' })}
            onDone={(text) => {
              setMode({ kind: 'items' });
              setNotice({ tone: 'info', text });
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'hold' && priced ? (
        <HoldPanel
          cart={cart}
          totalMinor={totalMinor}
          currency={ctx.currency}
          shiftId={props.shiftId}
          cashierId={session.userId}
          timezone={settings.timezone}
          cutoff={settings.businessDayCutoff}
          onPrintDeposit={props.onPrintDeposit}
          days={holdExpiryDaysOf(settings.till)}
          onClose={() => setMode({ kind: 'items' })}
          onDone={(hold) => {
            setCart(() => EMPTY_CART);
            setSelected(null);
            setMode({ kind: 'items' });
            setNotice({
              tone: 'info',
              text: hold.depositCode
                ? `حُجز ${hold.number}. العربون بالقسيمة ${hold.depositCode} ويُخصم عند الاستلام.`
                : `حُجز ${hold.number}. يجده الكاشير في «طلبات المتجر» عند الاستلام.`,
            });
          }}
        />
      ) : effectiveMode.kind === 'holdName' && priced ? (
        <HoldNamePanel
          initial={cart.customer?.name ?? cart.onlineOrder?.customerName ?? ''}
          onHold={(name) => {
            setMode({ kind: 'items' });
            setSelected(null);
            holdSale(name);
          }}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'heldList' ? (
        <HeldList
          carts={props.heldList ?? []}
          currency={ctx.currency}
          totalOf={(c) => {
            try {
              return c.lines.length > 0 ? priceCart(c, ctx).priced.totals.totalMinor : 0;
            } catch {
              return 0;
            }
          }}
          currentHasLines={cart.lines.length > 0}
          sellerOf={(c) => (c.sellerId ? (staff.find((m) => m.id === c.sellerId)?.fullName ?? null) : null)}
          onPick={(index) => {
            setMode({ kind: 'items' });
            setSelected(null);
            props.onResume(index);
          }}
          onDiscard={(index) => props.onDiscardHeld?.(index)}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'online' ? (
        <Suspense fallback={null}>
          <OnlineOrdersPanel
            orders={waitingOnline}
            onClose={() => setMode({ kind: 'items' })}
            onOpen={(order) => {
              if (cart.lines.length > 0) {
                setNotice({ tone: 'warning', text: 'أنهِ الفاتورة الحالية أو علّقها، ثم افتح الطلب.' });
                setMode({ kind: 'items' });
                return;
              }
              const { cart: opened, missing } = orderCart(order, catalog);
              setCart(() => opened);
              setMode({ kind: 'items' });
              if (props.done) props.onNextSale();
              setNotice(
                missing.length > 0
                  ? { tone: 'warning', text: `غير موجود على هذا الجهاز: ${missing.join('، ')}. أضفه يدوياً.` }
                  : { tone: 'info', text: `فُتح طلب المتجر ${order.number} للزبون ${order.customerName}.` },
              );
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'tables' && service ? (
        <Suspense fallback={null}>
          <TableBoard
            tables={service.tables}
            held={props.heldCarts ?? []}
            current={cart}
            currency={ctx.currency}
            totalOf={(c) => {
              try {
                return c.lines.length > 0 ? priceCart(c, ctx).priced.totals.totalMinor : 0;
              } catch {
                return 0;
              }
            }}
            onPick={(table) => {
              setMode({ kind: 'items' });
              props.onOpenTable?.(table);
            }}
            onMove={props.hallTools?.onMoveTable}
            onClose={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'split' && props.hallTools?.order ? (
        <Suspense fallback={null}>
          <SplitBill
            order={props.hallTools.order}
            currency={ctx.currency}
            blocked={
              cart.lines.some((l) => l.qty > (cart.hall?.known[l.lineNo] ?? 0))
                ? 'في الطلب أصناف لم تُرسل بعد. أرسلها للمطبخ ثم قسّم الحساب.'
                : null
            }
            totalOf={(lineIds) => {
              try {
                const part = cartFromOrder(props.hallTools!.order!, catalog, null, { lineIds }).cart;
                return part.lines.length > 0 ? priceCart(part, ctx).priced.totals.totalMinor : 0;
              } catch {
                return 0;
              }
            }}
            onItems={(lineIds) => {
              setMode({ kind: 'items' });
              props.hallTools!.onSplitItems(lineIds);
            }}
            onEqual={(parts) => {
              setMode({ kind: 'items' });
              props.hallTools!.onSplitEqual(parts);
            }}
            onClose={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'cancelSent' && lineOf(effectiveMode.lineNo) && props.hallTools ? (
        <Suspense fallback={null}>
          <CancelSentLine
            name={lineOf(effectiveMode.lineNo)!.name}
            staff={staff}
            onBack={() => setMode({ kind: 'items' })}
            onLocalOnly={() => {
              const at = cart.lines.findIndex((l) => l.lineNo === effectiveMode.lineNo);
              setMode({ kind: 'items' });
              if (at >= 0) removeNow(effectiveMode.lineNo, at);
            }}
            onConfirm={async (input) => {
              const answer = await props.hallTools!.cancelSent(effectiveMode.lineNo, input);
              if (answer.kind === 'ok') {
                const at = cart.lines.findIndex((l) => l.lineNo === effectiveMode.lineNo);
                setMode({ kind: 'items' });
                if (at >= 0) removeNow(effectiveMode.lineNo, at, false);
                setNotice({
                  tone: 'info',
                  text: answer.queued
                    ? 'حُذف البند. سيصل إلغاؤه للمطبخ حين يعود الاتصال.'
                    : 'أُلغي البند ووصل الإلغاء لشاشة المطبخ.',
                });
              }
              return answer;
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'help' ? (
        <SalePanel title="دليل الاختصارات" actions={closeButton('أغلق', () => setMode({ kind: 'items' }))}>
          <ul className="flex flex-col divide-y divide-line">
            {SHORTCUTS.map(([action, key]) => (
              <li key={action} className="flex min-h-12 items-center justify-between gap-4 py-2">
                <span className="text-ink">{action}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-sm text-ink-subtle">
                  {key.split(' ').map((part, index) =>
                    part === 'أو' || part === 'ثم' ? (
                      <span key={index}>{part}</span>
                    ) : (
                      <Kbd key={index} always>
                        {part}
                      </Kbd>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SalePanel>
      ) : (
        itemsArea
      )}
    </>
  );
}

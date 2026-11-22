import {
  Badge,
  Button,
  CalendarIcon,
  CheckIcon,
  CartIcon,
  DeleteIcon,
  displayNumber,
  IconChip,
  InboxIcon,
  Menu,
  MenuItem,
  MoreIcon,
  OfferIcon,
  PrintIcon,
  useDigits,
} from '@serva/ui';
import { counted } from '../format';
import type { StaffMember, StaffSession } from '../staff/staff';
import { setPriceTier, type Cart, type PricedCart } from './cart';
import { SELLER_KEY, type PosServices, type SaleMode, type SaleScreenProps } from './saleTypes';

export interface CartHeaderProps {
  lineCount: number;
  pieceTotal: number;
  serviceCount: number;
  cart: Cart;
  setCart: SaleScreenProps['setCart'];
  staff: readonly StaffMember[];
  session: StaffSession;
  seller: string;
  setSeller: (id: string) => void;
  pos: PosServices;
  ticketTools: boolean;
  waitingOnline: readonly unknown[];
  canHoldForCustomer: boolean;
  priced: PricedCart | null;
  showWholesale: boolean;
  wholesaleOn: boolean;
  canWaste: boolean;
  heldCount: number;
  setMode: (mode: SaleMode) => void;
  setQuoteAsk: (priced: PricedCart | null) => void;
}

/** The ticket's head: what it is, who sells, and the actions on the whole ticket */
export function CartHeader({
  lineCount,
  pieceTotal,
  serviceCount,
  cart,
  setCart,
  staff,
  session,
  seller,
  setSeller,
  pos,
  ticketTools,
  waitingOnline,
  canHoldForCustomer,
  priced,
  showWholesale,
  wholesaleOn,
  canWaste,
  heldCount,
  setMode,
  setQuoteAsk,
}: CartHeaderProps) {
  const digits = useDigits();
  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b border-line px-4 py-2.5">
      <div className="flex items-center gap-3">
        <IconChip size="md">
          <CartIcon size={20} />
        </IconChip>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-lg/6 font-semibold text-ink">
            {lineCount === 0 ? 'فاتورة جديدة' : 'الفاتورة الحالية'}
          </h2>
          {/* Who the sale is for: a quotation's or a picked customer's name, never cut short on a phone */}
          {cart.customer?.name ? (
            <p className="text-sm/5 font-semibold text-ink">
              <bdi>{cart.customer.name}</bdi>
            </p>
          ) : null}
          {/* Wraps between its two parts rather than cut: on a phone the seller box shares this row */}
          <p className="flex flex-wrap gap-x-1 text-sm/5 text-ink-muted">
            {lineCount === 0 ? (
              'لا أسطر بعد'
            ) : (
              <>
                <span className="me-2 whitespace-nowrap">
                  {counted(lineCount, ['سطر واحد', 'سطران', 'أسطر', 'سطراً'], digits)}
                </span>
                <span className="whitespace-nowrap">
                  {pieceTotal > 0
                    ? counted(pieceTotal, ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'], digits)
                    : null}
                  {pieceTotal > 0 && serviceCount > 0 ? ' + ' : null}
                  {serviceCount > 0
                    ? counted(serviceCount, ['خدمة', 'خدمتان', 'خدمات', 'خدمة'], digits)
                    : null}
                </span>
              </>
            )}
          </p>
        </div>
        {staff.length > 1 ? (
          <div className="flex shrink-0 items-center gap-2">
            {/* A small chip with the seller's name: the native list opens from it (named «البائع» for screen readers) */}
            <select
              aria-label="البائع"
              value={seller}
              onChange={(e) => {
                setSeller(e.target.value);
                void pos.local.set(SELLER_KEY, { by: session.userId, id: e.target.value });
                const picked = e.target.value;
                if (cart.lines.length > 0) setCart((c) => ({ ...c, sellerId: picked }));
              }}
              className="min-h-9 max-w-32 truncate rounded-full border border-line bg-surface-muted ps-3 pe-1 text-sm font-semibold text-ink"
            >
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {ticketTools ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {waitingOnline.length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              icon={<InboxIcon size={20} />}
              aria-label={`طلبات المتجر (${waitingOnline.length})`}
              title="طلبات المتجر التي قبلها المدير وتنتظر البيع هنا. الطلبات الجديدة تظهر عند المدير حتى يقبلها."
              onClick={() => setMode({ kind: 'online' })}
              className="border-brand/40 bg-brand-soft text-brand-ink"
            >
              <span aria-hidden="true">طلبات جاهزة</span>
              <span
                aria-hidden="true"
                className="num grid h-7 min-w-7 place-items-center rounded-full bg-brand px-2 text-sm font-bold text-on-brand shadow-e1"
              >
                {displayNumber(String(waitingOnline.length), digits)}
              </span>
            </Button>
          ) : null}
          {/* The rest of the ticket's tools in one «⋯»: hold for a customer, a quotation, the wholesale price */}
          {canHoldForCustomer || priced || showWholesale || canWaste ? (
            <Menu
              label="أدوات الفاتورة"
              align="start"
              className="w-60"
              trigger={
                <Button variant="ghost" size="md" icon={<MoreIcon />} aria-label="أدوات الفاتورة">
                  المزيد
                </Button>
              }
            >
              {canHoldForCustomer ? (
                <MenuItem icon={<CalendarIcon />} onSelect={() => setMode({ kind: 'hold' })}>
                  احجز
                </MenuItem>
              ) : null}
              {priced ? (
                <MenuItem icon={<PrintIcon />} onSelect={() => setQuoteAsk(priced)}>
                  عرض سعر
                </MenuItem>
              ) : null}
              {showWholesale ? (
                <MenuItem
                  icon={<OfferIcon />}
                  onSelect={() =>
                    setCart((c) => setPriceTier(c, c.priceTier === 'wholesale' ? 'retail' : 'wholesale'))
                  }
                >
                  {wholesaleOn ? 'ارجع إلى سعر المفرق' : cart.contractPriced ? 'سعر العقد' : 'سعر الجملة'}
                </MenuItem>
              ) : null}
              {canWaste ? (
                <MenuItem icon={<DeleteIcon />} onSelect={() => setMode({ kind: 'waste' })}>
                  تالف / هدر
                </MenuItem>
              ) : null}
            </Menu>
          ) : null}
          {/* On, the wholesale price shows beside the tools as a lit switch: one tap turns it off */}
          {showWholesale && wholesaleOn ? (
            <Button
              variant="primary"
              size="md"
              aria-pressed
              icon={<CheckIcon size={16} />}
              title="اضغط للرجوع إلى سعر المفرق"
              onClick={() => setCart((c) => setPriceTier(c, 'retail'))}
            >
              {cart.contractPriced ? 'سعر العقد' : 'سعر الجملة'}
            </Button>
          ) : null}
          <span className="flex-1" />
          {heldCount > 0 ? (
            <button
              type="button"
              aria-label="افتح الفواتير المعلّقة"
              title="الفواتير المعلّقة: اضغط لفتح القائمة"
              onClick={() => setMode({ kind: 'heldList' })}
              className="min-h-11 rounded-full transition-opacity duration-120 ease-standard hover:opacity-80"
            >
              <Badge tone="warning">{`${heldCount} معلّقة`}</Badge>
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

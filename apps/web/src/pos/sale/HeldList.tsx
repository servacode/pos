import { useState } from 'react';
import type { CurrencyCode } from '@serva/core';
import {
  Button,
  CloseIcon,
  ClockIcon,
  DeleteIcon,
  IconButton,
  Money,
  TextField,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import { clockText, counted } from '../format';
import { pieceCount, type Cart } from './cart';
import { Kbd } from './Kbd';
import { SalePanel } from './SalePanel';

/** What a held cart is called in the list: its name, else its table, else its customer, else «بدون اسم». */
export function heldTitle(cart: Cart): string {
  const name = cart.held?.name.trim();
  if (name) return name;
  if (cart.service?.table) return `طاولة ${cart.service.table}`;
  return cart.customer?.name ?? cart.onlineOrder?.customerName ?? 'بدون اسم';
}

/**
 * «علّق» (hold): asks for an optional name, so a cart put aside is found again by it among the
 * others. The customer's name is there already when one is attached.
 */
export function HoldNamePanel({
  initial,
  onHold,
  onClose,
}: {
  initial: string;
  onHold: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <SalePanel
      label="علّق الفاتورة"
      title="علّق الفاتورة"
      subtitle="اكتب اسماً لتجدها بسهولة، أو اتركه فارغاً."
      icon={<ClockIcon size={20} />}
      actions={
        <Button
          variant="secondary"
          size="md"
          icon={<CloseIcon size={20} />}
          aria-keyshortcuts="Escape"
          onClick={onClose}
        >
          ارجع للأصناف
          <Kbd>Esc</Kbd>
        </Button>
      }
      footer={
        <Button size="lg" fullWidth icon={<ClockIcon size={20} />} onClick={() => onHold(name)}>
          علّق الفاتورة
        </Button>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onHold(name);
        }}
      >
        <TextField
          label="اسم الفاتورة (اختياري)"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="مثلاً: أم أحمد"
          autoComplete="off"
          autoFocus
        />
      </form>
    </SalePanel>
  );
}

/**
 * The held carts (a stack the cashier picks from): each with its name, customer, how many pieces,
 * the total and when it was put aside. Picking one brings it back; a cart being taken is held first.
 */
export function HeldList({
  carts,
  currency,
  totalOf,
  currentHasLines,
  onPick,
  onDiscard,
  onClose,
}: {
  carts: readonly Cart[];
  currency: CurrencyCode;
  totalOf: (cart: Cart) => number;
  /** The cart being taken has lines: picking a held one holds it first */
  currentHasLines: boolean;
  onPick: (index: number) => void;
  onDiscard: (index: number) => void;
  onClose: () => void;
}) {
  const digits = useDigits();
  // The cart whose «احذف» was pressed once: a second press drops it
  const [asked, setAsked] = useState<number | null>(null);
  return (
    <SalePanel
      label="الفواتير المعلّقة"
      title="الفواتير المعلّقة"
      subtitle={
        carts.length === 0
          ? 'لا شيء معلّق.'
          : `${counted(carts.length, ['فاتورة واحدة', 'فاتورتان', 'فواتير', 'فاتورة'], digits)}${currentHasLines ? ' · الفاتورة الحالية تُعلَّق عند الاسترجاع' : ''}`
      }
      icon={<ClockIcon size={20} />}
      actions={
        <Button
          variant="secondary"
          size="md"
          icon={<CloseIcon size={20} />}
          aria-keyshortcuts="Escape"
          onClick={onClose}
        >
          ارجع للأصناف
          <Kbd>Esc</Kbd>
        </Button>
      }
    >
      <ul aria-label="الفواتير المعلّقة" className="flex flex-col gap-2">
        {carts.map((cart, index) => {
          const customer = cart.customer?.name ?? cart.onlineOrder?.customerName ?? null;
          const title = heldTitle(cart);
          return (
            <li
              key={`${cart.held?.at ?? 0}-${index}`}
              className="flex items-center gap-2 rounded-card border border-line bg-surface p-2"
            >
              <button
                type="button"
                onClick={() => onPick(index)}
                aria-label={`استرجع ${title}`}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-control px-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-ink">{title}</span>
                  <span className="truncate text-sm text-ink-muted">
                    {customer && customer !== title ? `${customer} · ` : ''}
                    {counted(pieceCount(cart), ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'], digits)}
                    {cart.held ? ` · ${clockText(cart.held.at, digits)}` : ''}
                  </span>
                </span>
                <Money minor={totalOf(cart)} currency={currency} className="text-base font-bold text-ink" />
                <UndoIcon size={20} className="shrink-0 text-ink-muted" />
              </button>
              {asked === index ? (
                <Button
                  variant="danger-soft"
                  size="md"
                  icon={<DeleteIcon size={20} />}
                  onClick={() => {
                    setAsked(null);
                    onDiscard(index);
                  }}
                >
                  تأكيد الحذف
                </Button>
              ) : (
                <IconButton
                  label={`احذف ${title}`}
                  size="md"
                  variant="danger-soft"
                  icon={<DeleteIcon size={20} />}
                  onClick={() => setAsked(index)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </SalePanel>
  );
}

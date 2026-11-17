import { useEffect, useState } from 'react';
import type { CustomerInstalments } from '@serva/core/contracts/installments';
import type { CurrencyCode } from '@serva/core/currencies';
import { allocatePayment } from '@serva/core/installments';
import type { ReceiptAllocation } from '@serva/core/contracts/installments';
import { Badge, Button, CalendarIcon, Money, Switch, type BadgeTone } from '@serva/ui';
import { APP_VERSION } from '../../offline/sync';
import { usePos } from '../services';

/** GET /v1/device/installments/customer/{id} (`Authorization: Device <token>`); null without an answer */
export async function fetchInstalments(
  id: string,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<CustomerInstalments | null> {
  try {
    const res = await fetchFn(`/v1/device/installments/customer/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', Authorization: `Device ${token}`, 'X-App-Version': APP_VERSION },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CustomerInstalments;
  } catch {
    return null;
  }
}

/** The customer's open plans (online only): undefined while loading, null when there is no answer */
export function useCustomerInstalments(customerId: string | null): CustomerInstalments | null | undefined {
  const pos = usePos();
  const [data, setData] = useState<CustomerInstalments | null | undefined>(undefined);
  useEffect(() => {
    setData(undefined);
    const token = pos.device.token;
    if (!customerId) return;
    if (!token || !pos.online()) {
      setData(null);
      return;
    }
    let alive = true;
    void fetchInstalments(customerId, token, pos.fetch).then((got) => alive && setData(got));
    return () => {
      alive = false;
    };
  }, [customerId, pos]);
  return data;
}

const TONE: Record<string, BadgeTone> = {
  late: 'danger',
  due_today: 'warning',
  partial: 'warning',
  upcoming: 'neutral',
};
const TEXT: Record<string, string> = {
  late: 'متأخر',
  due_today: 'اليوم',
  partial: 'جزئي',
  upcoming: 'قادم',
};

/** What a payment of `amountMinor` settles of the picked plan, oldest first; [] when nothing */
export function allocationsFor(
  plans: CustomerInstalments,
  planId: string,
  amountMinor: number,
): ReceiptAllocation[] {
  const plan = plans.plans.find((p) => p.id === planId);
  if (!plan) return [];
  const open = plan.instalments
    .filter((i) => i.state !== 'paid' && i.state !== 'cancelled')
    .map((i) => ({
      id: String(i.no),
      dueDate: i.dueDate,
      amountMinor: i.amountMinor,
      paidMinor: i.paidMinor,
    }));
  return allocatePayment(open, amountMinor).allocations.map((a) => ({
    planId,
    no: Number(a.installmentId),
    amountMinor: a.amountMinor,
  }));
}

/**
 * «على قسط»: when the customer has an open instalment plan, the payment can be taken toward it: the
 * oldest instalment first. The receipt posts as any receipt does; this only says what it settles.
 */
export function InstalmentPick({
  data,
  base,
  on,
  onToggle,
  planId,
  onPlan,
  onFill,
}: {
  data: CustomerInstalments;
  base: CurrencyCode;
  on: boolean;
  onToggle: (on: boolean) => void;
  planId: string;
  onPlan: (id: string) => void;
  /** Fill the amount with what the next instalment still needs */
  onFill: (minor: number) => void;
}) {
  const plan = data.plans.find((p) => p.id === planId) ?? data.plans[0];
  if (!plan) return null;
  // The oldest first, as a payment fills them
  const open = plan.instalments
    .filter((i) => i.state !== 'paid' && i.state !== 'cancelled')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.no - b.no);
  const next = open[0];
  return (
    <section
      aria-label="أقساط الزبون"
      className="flex flex-col gap-3 rounded-card border border-brand/30 bg-brand-soft/40 p-3"
    >
      <Switch
        label="القبض على قسط"
        description="يُسدَّد أقدم قسط، ثم الذي يليه."
        checked={on}
        onCheckedChange={onToggle}
      />
      {data.plans.length > 1 ? (
        <div role="group" aria-label="الخطة" className="flex flex-wrap gap-2">
          {data.plans.map((p) => (
            <Button
              key={p.id}
              size="md"
              variant={p.id === plan.id ? 'primary' : 'secondary'}
              aria-pressed={p.id === plan.id}
              onClick={() => onPlan(p.id)}
            >
              <bdi dir="ltr" className="num">
                {p.number}
              </bdi>
            </Button>
          ))}
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {open.map((i) => (
          <li key={i.no} className="flex items-center gap-3 px-3 py-2">
            <span className="num w-6 shrink-0 text-sm text-ink-muted">{i.no}</span>
            <bdi dir="ltr" className="num flex-1 whitespace-nowrap">
              {i.dueDate}
            </bdi>
            <Badge tone={TONE[i.state] ?? 'neutral'}>{TEXT[i.state] ?? ''}</Badge>
            <Money minor={i.amountMinor - i.paidMinor} currency={base} className="font-semibold" />
          </li>
        ))}
      </ul>
      {next ? (
        <Button
          variant="secondary"
          size="md"
          icon={<CalendarIcon size={20} />}
          onClick={() => onFill(next.amountMinor - next.paidMinor)}
        >
          القسط القادم <Money minor={next.amountMinor - next.paidMinor} currency={base} />
        </Button>
      ) : null}
    </section>
  );
}

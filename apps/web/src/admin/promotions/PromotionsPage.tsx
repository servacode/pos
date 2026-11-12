import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Promotion } from '@serva/core';
import {
  AddIcon,
  AlertCircleIcon,
  Badge,
  Button,
  CalendarIcon,
  CategoriesIcon,
  ClockIcon,
  EmptyState,
  InfoIcon,
  OfferIcon,
  PageHeader,
  ProductsIcon,
  RetryIcon,
  StoreIcon,
  Sheet,
  Skeleton,
  cn,
  type BadgeTone,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { listPromotions, updatePromotion } from './api';
import { localDate, PromotionForm, WEEKDAY_NAMES } from './PromotionForm';

/** What the promotion gives, as the owner says it. */
export function promotionSummary(p: Promotion): string {
  const what =
    p.kind === 'percent' ? `خصم ${(p.percentBp ?? 0) / 100}%` : `اشترِ ${p.buyQty} وخذ ${p.getQty} مجاناً`;
  const on =
    p.scope === 'all'
      ? 'على كل المنتجات'
      : p.scope === 'categories'
        ? `على ${p.categoryIds.length} تصنيف`
        : `على ${p.productIds.length} منتج`;
  return `${what} ${on}`;
}

/**
 * One part of when a promotion runs: its first day, its last day, its weekdays or its hours. `text`
 * is the whole part («من 2026-11-01»); `value` the date, days or hours in it, after `lead`.
 */
interface WhenPart {
  kind: 'from' | 'to' | 'days' | 'hours';
  lead?: string;
  value: string;
  text: string;
}

const whenPart = (kind: WhenPart['kind'], value: string, lead?: string): WhenPart => ({
  kind,
  value,
  ...(lead ? { lead } : {}),
  text: lead ? `${lead} ${value}` : value,
});

/** When it runs, part by part, in the order promotionWhen says them. */
function promotionWhenParts(p: Promotion): WhenPart[] {
  const parts: WhenPart[] = [];
  if (p.startsAt) parts.push(whenPart('from', localDate(p.startsAt), 'من'));
  if (p.endsAt) {
    const last = new Date(p.endsAt);
    last.setUTCDate(last.getUTCDate() - 1);
    parts.push(whenPart('to', localDate(last.toISOString()), 'حتى'));
  }
  if (p.daysOfWeek.length > 0)
    parts.push(whenPart('days', p.daysOfWeek.map((d) => WEEKDAY_NAMES[d]).join('، ')));
  if (p.fromTime && p.toTime) parts.push(whenPart('hours', `${p.fromTime}–${p.toTime}`));
  return parts;
}

/** When it runs, in words. */
export function promotionWhen(p: Promotion): string {
  const parts = promotionWhenParts(p);
  return parts.length > 0 ? parts.map((each) => each.text).join(' · ') : 'دائماً';
}

type PromotionState = 'active' | 'scheduled' | 'ended' | 'stopped';

/** Where the promotion stands today: stopped by the owner, not started yet, past its last day, or on. */
function promotionState(p: Promotion, now: number): PromotionState {
  if (p.archived) return 'stopped';
  if (p.startsAt && Date.parse(p.startsAt) > now) return 'scheduled';
  if (p.endsAt && Date.parse(p.endsAt) <= now) return 'ended';
  return 'active';
}

const STATES: Record<PromotionState, { tone: BadgeTone; label: string }> = {
  active: { tone: 'success', label: 'يعمل' },
  scheduled: { tone: 'info', label: 'مجدول' },
  ended: { tone: 'neutral', label: 'انتهى' },
  stopped: { tone: 'neutral', label: 'متوقف' },
};

/** What the promotion applies to, as a picture beside its summary. */
const SCOPE_ICONS = { all: StoreIcon, categories: CategoriesIcon, products: ProductsIcon } as const;

/** A part of the schedule in a small chip; the dots between chips are read, not drawn. */
function WhenChip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-small bg-surface-muted px-2 py-1 text-xs font-semibold text-ink-muted">
      {icon}
      {children}
    </span>
  );
}

const Dot = () => <span className="sr-only"> · </span>;

/** A date or the hours, left to right inside the Arabic sentence («من 2026-11-01»). */
function WhenText({ part: { lead, value } }: { part: WhenPart }) {
  return (
    <span>
      {lead ? `${lead} ` : null}
      <bdi dir="ltr" className="num">
        {value}
      </bdi>
    </span>
  );
}

/** The schedule as chips: the dates, the weekdays and the hours, or «دائماً». */
function Schedule({ promotion }: { promotion: Promotion }) {
  const parts = promotionWhenParts(promotion);
  if (parts.length === 0) return <WhenChip>دائماً</WhenChip>;
  const from = parts.find((each) => each.kind === 'from');
  const to = parts.find((each) => each.kind === 'to');
  const days = parts.find((each) => each.kind === 'days');
  const hours = parts.find((each) => each.kind === 'hours');
  const chips: ReactNode[] = [];
  if (from || to) {
    chips.push(
      <WhenChip key="dates" icon={<CalendarIcon size={16} />}>
        {from ? <WhenText part={from} /> : null}
        {from && to ? <Dot /> : null}
        {to ? <WhenText part={to} /> : null}
      </WhenChip>,
    );
  }
  if (days) chips.push(<WhenChip key="days">{days.text}</WhenChip>);
  if (hours) {
    chips.push(
      <WhenChip key="hours" icon={<ClockIcon size={16} />}>
        <WhenText part={hours} />
      </WhenChip>,
    );
  }
  return chips.map((chip, index) => (
    <Fragment key={index}>
      {index > 0 ? <Dot /> : null}
      {chip}
    </Fragment>
  ));
}

/** The ticket stub at the start of a card: what the promotion gives, big. */
function Stub({ promotion, state }: { promotion: Promotion; state: PromotionState }) {
  const off = state === 'stopped' || state === 'ended';
  const percent = promotion.kind === 'percent';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-s-card px-2 py-4 text-center',
        off
          ? 'bg-surface-muted text-ink-subtle'
          : percent
            ? 'bg-brand-soft text-brand-ink'
            : 'bg-accent-soft text-accent-ink',
      )}
    >
      <bdi dir="ltr" className="num text-2xl leading-none font-bold tracking-tight">
        {percent ? `${(promotion.percentBp ?? 0) / 100}%` : `${promotion.buyQty}+${promotion.getQty}`}
      </bdi>
      <span className="text-xs font-semibold">{percent ? 'خصم' : 'مجاناً'}</span>
    </div>
  );
}

function PromotionCard({
  promotion,
  now,
  onEdit,
  onToggle,
}: {
  promotion: Promotion;
  now: number;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const state = promotionState(promotion, now);
  const ScopeIcon = SCOPE_ICONS[promotion.scope];
  const { tone, label } = STATES[state];
  return (
    <li
      className={cn(
        'relative flex rounded-card border border-line bg-surface shadow-e1 transition-[box-shadow,border-color,translate] duration-120 ease-standard',
        'hover:border-line-control/50 hover:shadow-e2 motion-safe:hover:-translate-y-0.5',
      )}
    >
      <Stub promotion={promotion} state={state} />
      {/* The perforation between the stub and the ticket, with a notch cut at each end. */}
      <span aria-hidden="true" className="relative w-0 border-s border-dashed border-line-control/50">
        <span className="absolute -top-px -start-2 h-2 w-4 rounded-b-small border-x border-b border-line bg-canvas" />
        <span className="absolute -start-2 -bottom-px h-2 w-4 rounded-t-small border-x border-t border-line bg-canvas" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-base font-semibold text-ink">
              {/* The whole card opens the promotion: the name's button stretches over it. */}
              <button
                type="button"
                onClick={onEdit}
                className="rounded-small text-start transition-colors duration-120 ease-standard after:absolute after:inset-0 after:rounded-card hover:text-brand-ink"
              >
                {promotion.name}
              </button>
            </h3>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <ScopeIcon size={16} className="text-ink-subtle" />
            {promotionSummary(promotion)}
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="sr-only">متى: </span>
            <Schedule promotion={promotion} />
          </p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 sm:px-5">
          <span className="text-xs text-ink-subtle">
            آخر تعديل <bdi className="num">{localDate(promotion.updatedAt)}</bdi>
          </span>
          <Button size="sm" variant="secondary" onClick={onToggle} className="relative">
            {promotion.archived ? 'شغّل' : 'أوقف'}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Cards in the shape of the real ones while the list loads. */
function CardsSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-4 lg:grid-cols-2">
      <span className="sr-only">نحمّل العروض…</span>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex h-44 overflow-hidden rounded-card border border-line bg-surface shadow-e1"
        >
          <span className="flex w-24 p-3">
            <Skeleton className="h-full w-full" />
          </span>
          <div className="flex flex-1 flex-col gap-3 p-5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * «العروض» (03 › عروض متقدمة): promotions the tills apply by themselves, online or not. The owner
 * adds, edits and stops them here; a stopped one stays listed for the receipts that carry it.
 */
export function PromotionsPage() {
  const [items, setItems] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);

  const load = useCallback(() => {
    setError(null);
    listPromotions()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function toggle(p: Promotion) {
    try {
      const { id, version, updatedAt: _u, ...rest } = p;
      await updatePromotion(id, { ...rest, version, archived: !p.archived });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const now = Date.now();
  const running = items?.filter((p) => promotionState(p, now) === 'active').length ?? 0;

  return (
    <AppShell>
      <title>العروض · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="العروض"
          description={
            items && items.length > 0 ? (
              <>
                يطبّقها الكاشير بنفسه، مع الإنترنت أو دونه. الفعّالة: <bdi className="num">{running}</bdi> من{' '}
                <bdi className="num">{items.length}</bdi>.
              </>
            ) : (
              'يطبّقها الكاشير بنفسه، مع الإنترنت أو دونه.'
            )
          }
          actions={
            <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
              عرض جديد
            </Button>
          }
        />

        {error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center shadow-e1"
          >
            <span className="grid size-12 place-items-center rounded-card bg-danger-soft text-danger-ink">
              <AlertCircleIcon size={24} />
            </span>
            <p className="max-w-md text-ink">{error}</p>
            <Button variant="secondary" size="sm" icon={<RetryIcon />} onClick={load}>
              حاول مرة أخرى
            </Button>
          </div>
        ) : null}

        {!items && !error ? <CardsSkeleton /> : null}

        {items && items.length === 0 ? (
          <EmptyState
            icon={OfferIcon}
            title="لا عروض بعد."
            description="أضف أول عرض: خصم على تصنيف، أو «اشترِ 2 والثالث مجاناً»."
            action={
              <Button variant="secondary" icon={<AddIcon />} onClick={() => setEditing('new')}>
                أضف عرضاً
              </Button>
            }
          />
        ) : null}

        {items && items.length > 0 ? (
          <ul aria-label="العروض" className="grid gap-4 lg:grid-cols-2">
            {items.map((p) => (
              <PromotionCard
                key={p.id}
                promotion={p}
                now={now}
                onEdit={() => setEditing(p)}
                onToggle={() => void toggle(p)}
              />
            ))}
          </ul>
        ) : null}

        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <InfoIcon size={16} className="mt-1 text-ink-subtle" />
          الكاشير يطبّق العرض بنفسه على كل سطر ينطبق عليه، ويختار الأفضل للزبون إن انطبق أكثر من عرض. الخصم
          الذي يكتبه الكاشير يحلّ محل العرض على ذلك السطر.
        </p>
      </div>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === null || editing === 'new' ? 'عرض جديد' : `عدّل «${editing.name}»`}
        description="خصم بنسبة أو قطع مجانية، على كل المنتجات أو بعضها، في الوقت الذي تختاره."
      >
        {editing !== null ? (
          <PromotionForm
            key={editing === 'new' ? 'new' : editing.id}
            {...(editing === 'new' ? {} : { promotion: editing })}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </AppShell>
  );
}

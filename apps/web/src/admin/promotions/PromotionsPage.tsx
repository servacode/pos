import { useCallback, useEffect, useRef, useState } from 'react';
import { promotionActive, type Promotion } from '@serva/core';
import { AddIcon, Badge, Button, CheckIcon, EmptyState, InfoIcon, OfferIcon, Sheet } from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { PageTop, Panel, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { archivePromotion, listPromotions } from './api';
import { localDate, PromotionForm, WEEKDAY_NAMES } from './PromotionForm';

/** What the promotion gives, as the owner says it. */
export function promotionSummary(p: Promotion): string {
  const what =
    p.kind === 'percent'
      ? `خصم ${(p.percentBp ?? 0) / 100}%`
      : p.kind === 'tiered'
        ? `خصم حسب الكمية: ${(p.tiers ?? []).map((t) => `من ${t.minQty} ${t.percentBp / 100}%`).join('، ')}`
        : p.kind === 'free_item'
          ? `اشترِ ${p.buyQty} وخذ ${p.freeQty} من صنف آخر مجاناً`
          : `اشترِ ${p.buyQty} وخذ ${p.getQty} مجاناً`;
  const who = [
    p.repOnly ? 'للمندوب فقط' : null,
    (p.customerKinds ?? []).length > 0 ? 'لأنواع محددة من الزبائن' : null,
    (p.priceTiers ?? []).length > 0 ? 'لقائمة سعر محددة' : null,
  ].filter(Boolean);
  const on =
    p.scope === 'all'
      ? 'على كل المنتجات'
      : p.scope === 'categories'
        ? `على ${p.categoryIds.length} تصنيف`
        : `على ${p.productIds.length} منتج`;
  return who.length > 0 ? `${what} ${on} · ${who.join('، ')}` : `${what} ${on}`;
}

/** How a date shows in a sentence: «30 تشرين الأول 2026» (never the ISO form, which reads reversed in Arabic) */
const dayWords = (iso: string) => dayText(localDate(iso));

/** When it runs, in words: dates, weekdays and hours in the order a person says them. */
export function promotionWhen(p: Promotion): string {
  const parts: string[] = [];
  if (p.startsAt) parts.push(`من ${dayWords(p.startsAt)}`);
  if (p.endsAt) {
    const last = new Date(p.endsAt);
    last.setUTCDate(last.getUTCDate() - 1);
    parts.push(`حتى ${dayWords(last.toISOString())}`);
  }
  if (p.daysOfWeek.length > 0) parts.push(p.daysOfWeek.map((d) => WEEKDAY_NAMES[d]).join('، '));
  if (p.fromTime && p.toTime) parts.push(`${p.fromTime}–${p.toTime}`);
  return parts.length > 0 ? parts.join(' · ') : 'دائماً';
}

/** `idle`: inside its dates but not on its days or hours right now */
type PromotionState = 'active' | 'idle' | 'scheduled' | 'ended' | 'stopped';

const DAY = 86_400_000;

/** Where the promotion stands today: stopped by the owner, not started yet, past its last day, or on. */
function promotionState(p: Promotion, now: number, timeZone = 'Asia/Damascus'): PromotionState {
  if (p.archived) return 'stopped';
  if (p.startsAt && Date.parse(p.startsAt) > now) return 'scheduled';
  if (p.endsAt && Date.parse(p.endsAt) <= now) return 'ended';
  const timed = p.daysOfWeek.length > 0 || Boolean(p.fromTime && p.toTime);
  return timed && !promotionActive(p, new Date(now), timeZone) ? 'idle' : 'active';
}

const isOff = (p: Promotion, now: number) => {
  const state = promotionState(p, now);
  return state === 'stopped' || state === 'ended';
};

/** «ينتهي بعد 3 أيام» in the last week of an offer, so an owner does not leave a sale on by mistake */
function endsSoon(p: Promotion, now: number): string | null {
  if (!p.endsAt) return null;
  const left = Math.ceil((Date.parse(p.endsAt) - now) / DAY);
  if (left < 1 || left > 7) return null;
  return left === 1 ? 'ينتهي اليوم' : left === 2 ? 'ينتهي غداً' : `ينتهي بعد ${left} أيام`;
}

/** Two running offers that can both hit the same piece: the customer gets the better one, the owner should know */
function overlapsWith(p: Promotion, all: readonly Promotion[], now: number): Promotion | null {
  if (promotionState(p, now) !== 'active' || p.couponCode) return null;
  return (
    all.find((q) => {
      if (q.id === p.id || q.couponCode || promotionState(q, now) !== 'active') return false;
      if (q.repOnly !== p.repOnly) return false;
      if (p.scope === 'all' || q.scope === 'all') return true;
      if (p.scope !== q.scope) return false;
      const mine = new Set(p.scope === 'categories' ? p.categoryIds : p.productIds);
      return (q.scope === 'categories' ? q.categoryIds : q.productIds).some((id) => mine.has(id));
    }) ?? null
  );
}

function StateBadge({ state }: { state: PromotionState }) {
  if (state === 'active') {
    return (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        يعمل
      </StatusPill>
    );
  }
  if (state === 'scheduled') return <StatusPill kind="open">مجدول</StatusPill>;
  if (state === 'idle') return <StatusPill kind="ok">في غير وقته</StatusPill>;
  return <StatusPill kind="ok">{state === 'ended' ? 'انتهى' : 'متوقف'}</StatusPill>;
}

/** The big figure of an offer: what it gives, in two or three characters */
function stampOf(p: Promotion): string {
  if (p.kind === 'percent') return `${(p.percentBp ?? 0) / 100}%`;
  if (p.kind === 'tiered') return `حتى ${Math.max(0, ...(p.tiers ?? []).map((t) => t.percentBp)) / 100}%`;
  return `${p.buyQty}+${p.kind === 'free_item' ? (p.freeQty ?? 0) : p.getQty}`;
}

const GROUPS = { running: 'تعمل الآن أو مجدولة', off: 'متوقفة أو منتهية' } as const;

/**
 * «العروض» (03 › عروض متقدمة): promotions the tills apply by themselves, online or not. The owner
 * adds, edits and stops them here; a stopped one stays listed for the receipts that carry it.
 */
export function PromotionsPage() {
  const [items, setItems] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  // The offers being stopped or started: their button is off until the answer, so a double click is one request
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const newest = useRef(0);
  const inflight = useRef(new Set<string>());

  const load = useCallback(() => {
    setError(null);
    const mine = ++newest.current;
    listPromotions()
      .then((r) => mine === newest.current && setItems(r.items))
      .catch((e: unknown) => mine === newest.current && setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function toggle(p: Promotion) {
    // The ref answers a second click that lands before the page has drawn the disabled button
    if (inflight.current.has(p.id)) return;
    inflight.current.add(p.id);
    setBusy((b) => new Set(b).add(p.id));
    setActionError(null);
    try {
      await archivePromotion(p.id, { version: p.version, archived: !p.archived });
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      inflight.current.delete(p.id);
      setBusy((b) => {
        const rest = new Set(b);
        rest.delete(p.id);
        return rest;
      });
    }
    load();
  }

  const now = Date.now();
  const rows = (items ?? []).slice().sort((a, b) => Number(isOff(a, now)) - Number(isOff(b, now)));
  const running = items?.filter((p) => !isOff(p, now) && promotionState(p, now) !== 'scheduled').length ?? 0;

  const columns: SxColumn<Promotion>[] = [
    {
      key: 'stamp',
      header: 'العرض',
      cell: (p) => (
        <bdi dir="ltr" className="num" style={{ fontWeight: 700, fontSize: 18 }}>
          {stampOf(p)}
        </bdi>
      ),
    },
    {
      key: 'name',
      header: 'الاسم',
      lead: true,
      cell: (p) => {
        const other = overlapsWith(p, items ?? [], now);
        return (
          <span
            style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'normal', minWidth: 0 }}
          >
            <span>
              <button
                type="button"
                onClick={() => setEditing(p)}
                style={{ font: 'inherit', fontWeight: 600, textAlign: 'start' }}
              >
                {p.name}
              </button>{' '}
              {p.couponCode ? (
                <Badge tone="brand">
                  كود <bdi dir="ltr">{p.couponCode}</bdi>
                </Badge>
              ) : null}
            </span>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{promotionSummary(p)}</span>
            {other ? (
              <span style={{ fontSize: 12, color: 'var(--warning-ink)' }}>
                يتقاطع مع «{other.name}»: يُطبَّق الأفضل للزبون.
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'when',
      header: 'متى',
      hideBelowLg: true,
      cell: (p) => {
        const soon = endsSoon(p, now);
        return (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'normal' }}>
            <span>
              <span className="sr-only">متى: </span>
              {promotionWhen(p)}
            </span>
            {soon && promotionState(p, now) === 'active' ? (
              <span style={{ fontSize: 12, color: 'var(--warning-ink)', fontWeight: 600 }}>{soon}</span>
            ) : null}
          </span>
        );
      },
    },
    { key: 'state', header: 'الحالة', cell: (p) => <StateBadge state={promotionState(p, now)} /> },
    {
      key: 'act',
      header: <span className="sr-only">إجراء</span>,
      numeric: true,
      cell: (p) => (
        <Button
          variant="secondary"
          loading={busy.has(p.id)}
          disabled={busy.has(p.id)}
          onClick={() => void toggle(p)}
        >
          {p.archived ? 'شغّل' : 'أوقف'}
        </Button>
      ),
    },
  ];

  return (
    <AppShell>
      <title>العروض · SERVA</title>
      <SalesPage>
        <PageTop
          title="العروض"
          subtitle={
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
        {actionError ? (
          <p role="alert" style={{ color: 'var(--danger-ink)', fontWeight: 600 }}>
            {actionError}
          </p>
        ) : null}
        <Panel title="كل العروض" flush>
          <SxTable
            bare
            caption="العروض"
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            loading={items === null && !error}
            {...(error ? { error } : {})}
            onRetry={load}
            groupOf={(p) => (isOff(p, now) ? 'off' : 'running')}
            groupLabel={(key, count) => (
              <>
                {GROUPS[key as keyof typeof GROUPS]} · <span className="num">{count}</span>
              </>
            )}
            empty={
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
            }
          />
        </Panel>
        <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--ink-muted)' }}>
          <InfoIcon size={16} />
          الكاشير يطبّق العرض بنفسه على كل سطر ينطبق عليه، ويختار الأفضل للزبون إن انطبق أكثر من عرض. الخصم
          الذي يكتبه الكاشير يحلّ محل العرض على ذلك السطر. العرض الذي تحفظه يظهر في المتجر الإلكتروني فوراً إن
          لم تحفظه متوقفاً.
        </p>
      </SalesPage>

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

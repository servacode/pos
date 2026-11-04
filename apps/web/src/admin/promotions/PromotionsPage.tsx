import { useCallback, useEffect, useState } from 'react';
import type { Promotion } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  OfferIcon,
  PageHeader,
  StatTile,
  type DataColumn,
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

/** When it runs, in words. */
export function promotionWhen(p: Promotion): string {
  const parts: string[] = [];
  if (p.startsAt) parts.push(`من ${localDate(p.startsAt)}`);
  if (p.endsAt) {
    const last = new Date(p.endsAt);
    last.setUTCDate(last.getUTCDate() - 1);
    parts.push(`حتى ${localDate(last.toISOString())}`);
  }
  if (p.daysOfWeek.length > 0) parts.push(p.daysOfWeek.map((d) => WEEKDAY_NAMES[d]).join('، '));
  if (p.fromTime && p.toTime) parts.push(`${p.fromTime}–${p.toTime}`);
  return parts.length > 0 ? parts.join(' · ') : 'دائماً';
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

  const columns: DataColumn<Promotion>[] = [
    {
      key: 'name',
      header: 'العرض',
      cell: (p) => (
        <button
          type="button"
          className="font-semibold text-brand-ink hover:underline"
          onClick={() => setEditing(p)}
        >
          {p.name}
        </button>
      ),
    },
    { key: 'what', header: 'ماذا يعطي', cell: promotionSummary },
    { key: 'when', header: 'متى', cell: promotionWhen },
    {
      key: 'state',
      header: 'الحالة',
      cell: (p) => (p.archived ? <Badge tone="neutral">متوقف</Badge> : <Badge tone="success">يعمل</Badge>),
    },
    {
      key: 'action',
      header: '',
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => void toggle(p)}>
          {p.archived ? 'شغّل' : 'أوقف'}
        </Button>
      ),
    },
  ];

  return (
    <AppShell>
      <title>العروض · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={OfferIcon}
          title="العروض"
          description="خصومات تطبّقها أجهزة الكاشير بنفسها، حتى دون اتصال."
          actions={
            editing === null ? (
              <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
                عرض جديد
              </Button>
            ) : null
          }
        />
        {items && items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="عروض تعمل الآن"
              icon={OfferIcon}
              value={items.filter((p) => !p.archived).length}
            />
            <StatTile
              label="عروض متوقفة"
              icon={OfferIcon}
              tone="neutral"
              value={items.filter((p) => p.archived).length}
              footnote="تبقى مسجّلة للإيصالات التي حملتها."
            />
          </div>
        ) : null}
        <Alert tone="info">
          الكاشير يطبّق العرض بنفسه على كل سطر ينطبق عليه، ويختار الأفضل للزبون إن انطبق أكثر من عرض. الخصم
          الذي يكتبه الكاشير يحلّ محل العرض على ذلك السطر.
        </Alert>
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
        <DataTable
          caption="العروض"
          columns={columns}
          rows={items ?? []}
          rowKey={(p) => p.id}
          loading={!items && !error}
          {...(error ? { error, onRetry: load } : {})}
          empty="لا عروض بعد. أضف أول عرض: خصم على تصنيف، أو «اشترِ 2 والثالث مجاناً»."
        />
      </div>
    </AppShell>
  );
}

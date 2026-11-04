import { useCallback, useEffect, useState } from 'react';
import type { Broadcast, BroadcastAudience, Category } from '@serva/core';
import { Alert, Badge, Button, Card, Select } from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { listCategories } from '../catalog/api';

const listBroadcasts = () => apiFetch<{ items: Broadcast[] }>('/v1/broadcasts', { auth: true });
const preview = (audience: BroadcastAudience) =>
  apiFetch<{ count: number }>('/v1/broadcasts/preview', { method: 'POST', body: { audience }, auth: true });
const send = (text: string, audience: BroadcastAudience) =>
  apiFetch<Broadcast>('/v1/broadcasts', { method: 'POST', body: { text, audience }, auth: true });

type Kind = BroadcastAudience['kind'];

function audienceOf(kind: Kind, categoryId: string, days: number): BroadcastAudience | null {
  if (kind === 'all') return { kind };
  if (kind === 'recent') return { kind, days };
  return categoryId ? { kind, categoryId } : null;
}

const AUDIENCE_TEXT = (a: BroadcastAudience, names: Map<string, string>) =>
  a.kind === 'all'
    ? 'كل الزبائن'
    : a.kind === 'recent'
      ? `من اشترى في آخر ${a.days} يوماً`
      : `زبائن ${names.get(a.categoryId) ?? 'قسم'}`;

/**
 * «رسائل للزبائن» (03 › الألبسة): a WhatsApp message to the store's customers with a phone (all of
 * them, those who bought from a department, or those who bought lately), sent one at a time through
 * the store's message gateway. Customers marked «لا يريد رسائل» never get one.
 */
export function BroadcastsPage() {
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [categoryId, setCategoryId] = useState('');
  const [days, setDays] = useState(90);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    listBroadcasts()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    listCategories()
      .then((r) => setCategories(r.items.filter((c) => !c.archivedAt && !c.parentId)))
      .catch(() => setCategories([]));
  }, []);

  const audience = audienceOf(kind, categoryId, days);
  useEffect(() => {
    setCount(null);
    if (!audience) return;
    let alive = true;
    preview(audience)
      .then((r) => alive && setCount(r.count))
      .catch(() => alive && setCount(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the audience is its three parts
  }, [kind, categoryId, days]);

  // While one is going out, its count moves
  const busy = items?.some((b) => b.status === 'sending') ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [busy, load]);

  async function go() {
    if (!audience) return;
    setSending(true);
    setError(null);
    try {
      await send(text, audience);
      setText('');
      load();
    } catch (e) {
      const fields = e instanceof ApiError ? Object.values(e.fields ?? {}) : [];
      setError(fields[0] ?? errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const names = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <AppShell>
      <title>رسائل للزبائن · Serva POS</title>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">رسائل للزبائن</h1>
        <Card className="flex flex-col gap-4">
          <p className="text-ink-muted">
            رسالة على واتساب لزبائنك: «وصلت التشكيلة الشتوية» أو «تنزيلات 30٪». تُرسل واحدة كل ثانيتين حتى لا
            يُعدّ رقمك مزعجاً، ومعها سطر يقول كيف يوقفها الزبون. من علّمته «لا يريد رسائل» لا تصله.
          </p>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="flex flex-col gap-1">
            <span className="font-semibold">الرسالة</span>
            <textarea
              aria-label="الرسالة"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 700))}
              rows={4}
              placeholder="وصلت التشكيلة الشتوية! مرّوا علينا، أو اطلبوا من متجرنا."
              className="rounded-control border border-line-control bg-surface p-3 text-ink"
            />
            <span className="text-xs text-ink-muted">
              <span className="num">{text.length}</span> / 700
            </span>
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            <Select label="لمن" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="all">كل الزبائن</option>
              <option value="category">من اشترى من قسم</option>
              <option value="recent">من اشترى مؤخراً</option>
            </Select>
            {kind === 'category' ? (
              <Select label="القسم" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">اختر القسم</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {kind === 'recent' ? (
              <Select label="في آخر" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                {[30, 60, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} يوماً
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <p role="status" className="font-semibold">
            {count === null
              ? '…'
              : count === 0
                ? 'لا زبائن بأرقام جوال في هذا الاختيار.'
                : `تصل إلى ${count} زبون.`}
          </p>
          <div>
            <Button
              loading={sending}
              disabled={!audience || text.trim().length < 5 || !count || busy}
              onClick={() => void go()}
            >
              أرسل
            </Button>
            {busy ? <span className="ms-3 text-sm text-ink-muted">رسالة سابقة ما زالت تُرسل.</span> : null}
          </div>
        </Card>
        <section aria-label="الرسائل السابقة" className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-ink">الرسائل السابقة</h2>
          {items && items.length === 0 ? <p className="text-ink-muted">لم تُرسل رسائل بعد.</p> : null}
          <ul className="flex flex-col gap-2">
            {(items ?? []).map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-1 rounded-control border border-line bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={b.status === 'done' ? 'success' : 'warning'}>
                    {b.status === 'done' ? 'أُرسلت' : 'تُرسل الآن'}
                  </Badge>
                  <span className="text-sm text-ink-muted">{AUDIENCE_TEXT(b.audience, names)}</span>
                  <span className="flex-1" />
                  <span className="num text-sm">
                    {b.sent} / {b.total}
                    {b.failed > 0 ? ` · لم تصل ${b.failed}` : ''}
                  </span>
                </div>
                <p className="line-clamp-2 whitespace-pre-line text-sm">{b.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

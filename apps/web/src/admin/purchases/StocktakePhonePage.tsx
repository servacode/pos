import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Category, CountSheet, StocktakeDetail } from '@serva/core';
import { uuidv7 } from '@serva/sync';
import {
  Alert,
  Badge,
  BarcodeIcon,
  Button,
  Card,
  CheckCircleIcon,
  formatQuantity,
  ListIcon,
  Money,
  PageHeader,
  Select,
  Switch,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { BarcodeCamera, canScanBarcodes } from '../../lib/BarcodeCamera';
import { listCategories } from '../catalog/api';
import { createStocktake, getCountSheet, today } from './api';
import {
  addCount,
  clearSaved,
  countedItems,
  countOf,
  editRowsOf,
  findInSheet,
  linesOf,
  loadSaved,
  newDraft,
  save,
  saveDraftOnly,
  setCount,
  stocktakeOf,
  type CountDraft,
} from './countDraft';

/** Online or not, as the browser knows it, following its two events */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * «الجرد بالهاتف» (round 38, #29): count the shelves with the phone in hand. Pick the whole store or one category,
 * download its sheet, then scan with the camera (or a scanner, or type): each scan adds the item's pieces to a
 * draft kept on the phone, so the count survives a closed tab and needs no connection. «راجع وأرسل» shows each
 * item against what the books say; it posts the existing stocktake (one document, with the draft's own id) now,
 * or by itself when the connection returns. Only what was counted is touched, unless «ما لم أعدّه صفر» is on.
 */
export function StocktakePhonePage() {
  const me = useMe();
  const digits = useDigits();
  const online = useOnline();
  const [saved] = useState(() => loadSaved());
  const [sheet, setSheet] = useState<CountSheet | null>(saved?.sheet ?? null);
  const [draft, setDraft] = useState<CountDraft | null>(saved?.draft ?? null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [camera, setCamera] = useState(false);
  const [last, setLast] = useState<{ name: string; counted: number } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<StocktakeDetail | null>(null);
  const [roomWarning, setRoomWarning] = useState(false);

  useEffect(() => {
    if (online && !sheet) {
      listCategories()
        .then((r) => setCategories(r.items))
        .catch(() => setCategories([]));
    }
  }, [online, sheet]);

  // Whatever changes the draft is kept on the phone at once
  const keep = useCallback((next: CountDraft) => {
    setDraft(next);
    saveDraftOnly(next);
  }, []);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const got = await getCountSheet(branchId || undefined, categoryId || undefined);
      const fresh = newDraft(got, uuidv7());
      setRoomWarning(!save(fresh, got));
      setSheet(got);
      setDraft(fresh);
      setDone(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function scan(raw: string) {
    if (!sheet || !draft) return;
    const hit = findInSheet(sheet, raw);
    if (!hit) {
      setNotice(
        `الباركود ${raw} ليس في قائمة الجرد هذه. إن كان صنفاً من خارج التصنيف المختار فأضفه من تصنيفه.`,
      );
      return;
    }
    setNotice(null);
    const next = addCount(draft, hit.item.variantId, hit.add);
    keep(next);
    setLast({ name: hit.item.name, counted: next.counts[hit.item.variantId]! });
  }

  const needle = typed.trim();
  const isCode = /^[0-9٠-٩]{3,}$/.test(needle);
  const matches = useMemo(() => {
    if (!sheet || !needle || isCode) return [];
    return sheet.items.filter((i) => i.name.includes(needle)).slice(0, 6);
  }, [sheet, needle, isCode]);

  const lines = useMemo(() => (sheet && draft ? linesOf(draft, sheet) : []), [sheet, draft]);

  const editRows = useMemo(() => (sheet && draft ? editRowsOf(draft, sheet) : []), [sheet, draft]);

  const send = useCallback(async () => {
    if (!sheet || !draft || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await createStocktake(stocktakeOf(draft, sheet, today()));
      clearSaved();
      setDone(result);
      setSheet(null);
      setDraft(null);
      setReviewing(false);
      setLast(null);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500 && e.status !== 0) {
        // A refusal (a closed period, no permission): it will not pass by waiting, the count stays on the phone
        setError(errorMessage(e));
      } else {
        // No answer is not a refusal: the count stays on the phone and goes again, by the same id
        keep({ ...draft, queued: true });
        setError(`${errorMessage(e)} الجرد محفوظ على هاتفك، وسيُرسل من جديد عند عودة الاتصال.`);
      }
    } finally {
      setSending(false);
    }
  }, [sheet, draft, sending, keep]);

  // A count waiting for the connection goes by itself when it returns
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (online && draft?.queued && sheet && !sending) void sendRef.current();
    // only when the connection comes back or the count is queued
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, draft?.queued]);

  const total = sheet?.items.length ?? 0;
  const counted = draft ? countedItems(draft) : 0;

  if (done) {
    return (
      <AppShell>
        <title>الجرد بالهاتف · SERFA</title>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          <PageHeader icon={<ListIcon />} title="الجرد بالهاتف" />
          <Alert tone="success" title={`سُجّل الجرد ${done.number}`}>
            الفرق في القيمة <Money minor={done.diffValueMinor} currency={done.baseCurrency} negativeTone />.
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDone(null)}>جرد جديد</Button>
            <Link to="/inventory" className="inline-flex">
              <Button variant="secondary" tabIndex={-1}>
                المخزون
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <title>الجرد بالهاتف · SERFA</title>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <PageHeader
          icon={<ListIcon />}
          title="الجرد بالهاتف"
          description="امسح القطع بكاميرا الهاتف وعدّها على الرف. يعمل بلا اتصال ويُرسل لاحقاً."
        />
        {!online ? (
          <Alert tone="warning" title="لا اتصال بالإنترنت">
            {sheet
              ? 'تابع العدّ: كل شيء محفوظ على هاتفك.'
              : 'تحميل قائمة الجرد يحتاج اتصالاً. بعدها يعمل الجرد بلا اتصال.'}
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        {!sheet || !draft ? (
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-ink-muted">
              اختر تصنيفاً لتعدّ جزءاً من المخزون (رفّاً أو قسماً)، أو اتركه لتعدّ كل شيء. ما لا تعدّه لا
              يتغيّر.
            </p>
            {me.branches.length > 1 ? (
              <Select label="الفرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">الفرع الرئيسي</option>
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select label="التصنيف" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">كل المخزون</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button size="lg" loading={loading} disabled={!online} onClick={() => void download()}>
              حمّل قائمة الجرد
            </Button>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">
                  <bdi className="num">{`${counted} من ${total}`}</bdi> صنفاً معدوداً
                </Badge>
                {draft.queued ? <Badge tone="warning">بانتظار الاتصال</Badge> : null}
              </div>
              {roomWarning ? (
                <Alert tone="warning">
                  لا يتّسع هاتفك لحفظ القائمة كلها. لا تغلق الصفحة، أو اختر تصنيفاً أصغر.
                </Alert>
              ) : null}
              {camera ? (
                <BarcodeCamera onCode={scan} onClose={() => setCamera(false)} />
              ) : (
                <Button
                  size="lg"
                  icon={<BarcodeIcon />}
                  disabled={!canScanBarcodes()}
                  onClick={() => setCamera(true)}
                  fullWidth
                >
                  {canScanBarcodes() ? 'افتح الكاميرا للمسح' : 'الكاميرا غير متاحة في هذا المتصفح'}
                </Button>
              )}
              <TextField
                label="باركود أو اسم صنف"
                hint="امسح بقارئ أو اكتب الباركود ثم Enter، أو اكتب جزءاً من الاسم"
                value={typed}
                inputMode="search"
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && needle) {
                    e.preventDefault();
                    if (isCode) scan(needle);
                    else if (matches[0]) scan(matches[0].barcodes[0]?.code ?? '');
                    setTyped('');
                  }
                }}
              />
              {matches.length > 0 ? (
                <ul className="grid gap-2" aria-label="نتائج الاسم">
                  {matches.map((m) => (
                    <li key={m.variantId}>
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => {
                          keep(addCount(draft, m.variantId, 1000));
                          setLast({ name: m.name, counted: (draft.counts[m.variantId] ?? 0) + 1000 });
                          setTyped('');
                        }}
                      >
                        {m.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {notice ? <Alert tone="warning">{notice}</Alert> : null}
              {last ? (
                <p className="rounded-card bg-brand-soft p-3 text-brand-ink" aria-live="polite">
                  <b>{last.name}</b>:{' '}
                  <bdi className="num text-lg font-bold">{formatQuantity(last.counted, digits)}</bdi>
                </p>
              ) : null}
            </Card>

            {!reviewing ? (
              <>
                <Card className="flex flex-col gap-2 p-4">
                  <h2 className="text-base font-semibold text-ink">ما عددته</h2>
                  {editRows.length === 0 ? (
                    <p className="text-ink-muted">لم تعدّ شيئاً بعد. امسح أول قطعة.</p>
                  ) : (
                    <ul className="grid gap-3">
                      {editRows.map((l) => (
                        <li key={l.item.variantId} className="flex items-end gap-3">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                            {l.item.name}
                          </span>
                          <TextField
                            label="المعدود"
                            className="w-28 shrink-0"
                            dir="ltr"
                            inputMode={l.item.allowsFraction ? 'decimal' : 'numeric'}
                            inputClassName="num"
                            defaultValue={String(l.counted / 1000)}
                            key={`${l.item.variantId}:${l.counted}`}
                            onBlur={(e) => {
                              const qty = countOf(e.target.value, l.item.allowsFraction);
                              if (qty !== null) keep(setCount(draft, l.item.variantId, qty));
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" disabled={counted === 0} onClick={() => setReviewing(true)}>
                    راجع وأرسل
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={() => {
                      clearSaved();
                      setSheet(null);
                      setDraft(null);
                      setLast(null);
                    }}
                  >
                    ألغِ هذا الجرد
                  </Button>
                </div>
              </>
            ) : (
              <Card className="flex flex-col gap-4 p-4">
                <h2 className="text-base font-semibold text-ink">مراجعة قبل الإرسال</h2>
                <Switch
                  label="ما لم أعدّه في هذه القائمة صفر"
                  description="شغّلها فقط إن عددت كل ما في القائمة. وإلا فما لم تعدّه يبقى كما هو."
                  checked={draft.restZero}
                  onCheckedChange={(on) => keep({ ...draft, restZero: on })}
                />
                <ul className="grid gap-2" aria-label="الفروق">
                  {lines.map((l) => (
                    <li
                      key={l.item.variantId}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="min-w-0 truncate text-ink">{l.item.name}</span>
                      <span className="num shrink-0 text-ink-muted">
                        {`الدفتر ${formatQuantity(l.item.qty, digits)} · المعدود ${formatQuantity(l.counted, digits)}`}
                      </span>
                      <Badge tone={l.diff === 0 ? 'neutral' : l.diff < 0 ? 'danger' : 'success'}>
                        <bdi className="num">{l.diff === 0 ? 'مطابق' : formatQuantity(l.diff, digits)}</bdi>
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-ink-muted">
                  «الدفتر» من القائمة التي حمّلتها. الفرق الذي يُسجَّل يُحسب على مخزون لحظة الإرسال.
                </p>
                <div className="flex flex-wrap gap-3">
                  {online ? (
                    <Button
                      size="lg"
                      icon={<CheckCircleIcon />}
                      loading={sending}
                      onClick={() => void send()}
                    >
                      أرسل الجرد
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={() => {
                        keep({ ...draft, queued: true });
                        setReviewing(false);
                      }}
                    >
                      أرسل عند عودة الاتصال
                    </Button>
                  )}
                  <Button size="lg" variant="ghost" onClick={() => setReviewing(false)}>
                    ارجع للعدّ
                  </Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

import { useEffect, useState } from 'react';
import type { TransferFull, TransferReceiveInput, TransferRow } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckCircleIcon,
  formatQuantity,
  Skeleton,
  TextField,
  TransferIcon,
  useDigits,
} from '@serva/ui';
import { apiFetch, ApiError, errorMessage } from '../../lib/api';
import { qtyOf } from './api';

/**
 * «استلام تحويل بالطريق» (round 37, decision 16): the receiving branch confirms what arrived. Every line starts at
 * what was sent, so a full delivery is one press. A line that arrived short shows its shortage at once; the
 * reason is asked for, and the shortage is written off through the stocktake (the server does it).
 */
export function TransferReceive({
  row,
  onDone,
  onCancel,
}: {
  row: TransferRow;
  onDone: (done: TransferFull) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  const [transfer, setTransfer] = useState<TransferFull | null>(null);
  const [got, setGot] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    apiFetch<TransferFull>(`/v1/transfers/${row.id}`, { auth: true })
      .then((t) => {
        if (!live) return;
        setTransfer(t);
        setGot(Object.fromEntries(t.lines.map((l) => [l.variantId, String(l.qty / 1000)])));
        setSerials(Object.fromEntries(t.lines.map((l) => [l.variantId, (l.serials ?? []).join('\n')])));
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [row.id]);

  if (!transfer) {
    return (
      <Card>
        {error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-24 w-full" />}
        <div className="mt-4">
          <Button variant="ghost" onClick={onCancel}>
            إغلاق
          </Button>
        </div>
      </Card>
    );
  }

  const parsed = transfer.lines.map((l) => qtyOf(got[l.variantId] ?? ''));
  const valid = parsed.every((q, i) => q !== null && q >= 0 && q <= transfer.lines[i]!.qty);
  const short = transfer.lines.map((l, i) => (parsed[i] === null ? 0 : Math.max(0, l.qty - parsed[i]!)));
  const anyShort = short.some((q) => q > 0);
  const ready = valid && (!anyShort || reason.trim().length >= 2);

  async function confirm() {
    if (!ready || !transfer) return;
    setSaving(true);
    setError(null);
    setFields({});
    const body: TransferReceiveInput = {
      lines: transfer.lines.map((l, i) => {
        const list = (serials[l.variantId] ?? '')
          .split(/[\n,،]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        return {
          variantId: l.variantId,
          receivedQty: parsed[i]!,
          ...(l.serials && l.serials.length > 0 ? { serials: list } : {}),
        };
      }),
      ...(anyShort ? { reason: reason.trim() } : {}),
    };
    try {
      onDone(
        await apiFetch<TransferFull>(`/v1/transfers/${transfer.id}/receive`, {
          method: 'POST',
          body,
          auth: true,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card aria-label={`استلام التحويل ${transfer.number}`}>
      <CardHeader
        icon={<TransferIcon />}
        title={
          <>
            استلام التحويل{' '}
            <bdi dir="ltr" className="num">
              {transfer.number}
            </bdi>
          </>
        }
        description={`من ${transfer.fromBranch} إلى ${transfer.toBranch}. اكتب ما وصل فعلاً من كل صنف.`}
      />
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
          {transfer.lines.map((l, i) => (
            <li key={l.variantId} className="flex flex-col gap-2 px-4 py-3">
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                <span className="min-w-0 truncate font-semibold text-ink">{l.name}</span>
                <span className="text-sm text-ink-muted">
                  أُرسل: <span className="num font-semibold text-ink">{formatQuantity(l.qty, digits)}</span>
                </span>
                <TextField
                  label={`وصل من ${l.name}`}
                  inputMode="decimal"
                  value={got[l.variantId] ?? ''}
                  onChange={(e) => setGot((g) => ({ ...g, [l.variantId]: e.target.value }))}
                  error={
                    parsed[i] === null ? 'اكتب رقماً' : parsed[i]! > l.qty ? 'أكثر مما أُرسل' : undefined
                  }
                />
              </div>
              {short[i]! > 0 ? (
                <Badge tone="warning">
                  نقص <span className="num">{formatQuantity(short[i]!, digits)}</span>
                </Badge>
              ) : null}
              {l.serials && l.serials.length > 0 ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-ink-subtle">
                    الأرقام التسلسلية التي وصلت (واحد في كل سطر؛ احذف ما لم يصل)
                  </span>
                  <textarea
                    aria-label={`أرقام ${l.name}`}
                    dir="ltr"
                    rows={Math.min(5, Math.max(2, l.serials.length))}
                    value={serials[l.variantId] ?? ''}
                    onChange={(e) => setSerials((s) => ({ ...s, [l.variantId]: e.target.value }))}
                    className="num rounded-control border border-line-control bg-surface px-3 py-2 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-120 ease-standard hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden"
                  />
                  {fields[`lines.${i}.serials`] ? (
                    <span className="text-sm text-danger-ink">{fields[`lines.${i}.serials`]}</span>
                  ) : null}
                </label>
              ) : null}
            </li>
          ))}
        </ul>
        {anyShort ? (
          <div className="flex flex-col gap-2">
            <Alert tone="warning">
              ما نقص يُسجَّل خسارة مخزون بقيد جرد في فرع الاستلام، وتبقى كمياته ظاهرة في سجل هذا التحويل.
            </Alert>
            <TextField
              label="سبب النقص"
              placeholder="مثلاً: ضاعت قطعة في الطريق، أو وصلت تالفة"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              error={fields.reason}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <Button variant="ghost" onClick={onCancel}>
            ليس الآن
          </Button>
          <Button
            icon={<CheckCircleIcon />}
            disabled={!ready}
            loading={saving}
            onClick={() => void confirm()}
          >
            {anyShort ? 'أكّد الاستلام مع النقص' : 'أكّد الاستلام'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

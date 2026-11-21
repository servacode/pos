import { useMemo, useState } from 'react';
import { wasteReasonsOf } from '@serva/core/contracts/purchases';
import type { Approval } from '@serva/core/contracts/documents';
import { uuidv7 } from '@serva/sync';
import { Alert, Button, CloseIcon, DeleteIcon, Select, TextField, displayNumber, useDigits } from '@serva/ui';
import { searchCatalog, type Catalog, type CatalogItem } from '../catalog';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import { SalePanel } from './SalePanel';
import { postWaste, wasteQtyOf } from './waste';

interface Picked {
  item: CatalogItem;
  qty: string;
}

/**
 * «تالف / هدر» (round 38, #41): what spoiled, broke or went as a sample leaves the stock in a few taps. Scan or
 * type the item, write how much, pick the reason; it posts through the store's ordinary stock count. Whoever holds
 * inventory.adjust does it on their own; anyone else asks for a manager's code first. It needs the server.
 */
export function WastePanel({
  catalog,
  reasons,
  staff,
  canAdjust,
  userId,
  onDone,
  onClose,
}: {
  catalog: Catalog;
  reasons: readonly string[] | undefined;
  staff: readonly StaffMember[];
  /** The signed-in user holds inventory.adjust */
  canAdjust: boolean;
  userId: string;
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const choices = useMemo(() => wasteReasonsOf(reasons), [reasons]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [reason, setReason] = useState(choices[0] ?? '');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per write-off: a send that lost its answer is sent again with it and posts nothing twice
  const [requestId] = useState(() => uuidv7());

  const found = query.trim() ? searchCatalog(catalog, query, { limit: 6 }) : [];
  const lines = picked.map((p) => ({
    ...p,
    qtyThousandths: wasteQtyOf(p.qty, p.item.unit?.allowsFraction ?? false),
  }));
  const ready = lines.length > 0 && lines.every((l) => l.qtyThousandths !== null) && reason !== '';

  function pick(item: CatalogItem) {
    setQuery('');
    setError(null);
    setPicked((list) =>
      list.some((p) => p.item.variantId === item.variantId) ? list : [...list, { item, qty: '1' }],
    );
  }

  async function send(actorId: string) {
    const token = pos.device.token;
    if (!pos.online() || !token) {
      setError('تسجيل التالف يحتاج اتصالاً بالخادم. جرّب بعد عودة الاتصال.');
      setAsking(false);
      return;
    }
    setSaving(true);
    setError(null);
    const answer = await postWaste(
      {
        id: requestId,
        actorId,
        reason,
        lines: lines.map((l) => ({ variantId: l.item.variantId, qty: l.qtyThousandths! })),
      },
      token,
      pos.fetch,
    );
    setSaving(false);
    setAsking(false);
    if (answer.kind === 'ok') {
      onDone(`سُجّل التالف (${reason}) بالرقم ${answer.body.number}.`);
      return;
    }
    setError(
      answer.kind === 'refused'
        ? answer.message
        : 'لم يصل الجواب من الخادم. اضغط «سجّل» مرة أخرى: لن يُسجَّل التالف مرتين.',
    );
  }

  function start() {
    if (!ready) return;
    if (canAdjust) void send(userId);
    else setAsking(true);
  }

  if (asking) {
    return (
      <ManagerCode
        staff={staff}
        permission="inventory.adjust"
        reason="تسجيل التالف يحتاج رمز مدير."
        onApproved={(_approval: Approval, approver: StaffMember) => void send(approver.id)}
        onCancel={() => setAsking(false)}
      />
    );
  }

  return (
    <SalePanel
      label="تالف / هدر"
      title="تالف / هدر"
      subtitle="ما خرب أو انكسر أو انتهت صلاحيته يخرج من المخزون بكلفته."
      icon={<DeleteIcon size={20} />}
      actions={
        <Button
          variant="secondary"
          size="md"
          icon={<CloseIcon size={20} />}
          aria-keyshortcuts="Escape"
          onClick={onClose}
          disabled={saving}
        >
          أغلق
        </Button>
      }
      footer={
        <Button size="lg" icon={<DeleteIcon size={20} />} loading={saving} disabled={!ready} onClick={start}>
          {canAdjust ? 'سجّل التالف' : 'سجّل التالف برمز مدير'}
        </Button>
      }
    >
      <TextField
        label="الصنف"
        hint="امسح الباركود أو اكتب الاسم ثم اضغط Enter"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && found[0]) {
            e.preventDefault();
            pick(found[0]);
          }
        }}
        autoFocus
      />
      {found.length > 0 ? (
        <ul className="grid gap-2" aria-label="نتائج البحث">
          {found.map((item) => (
            <li key={item.variantId}>
              <Button variant="secondary" fullWidth onClick={() => pick(item)}>
                {item.name}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {lines.length > 0 ? (
        <ul className="grid gap-3" aria-label="ما سيخرج">
          {lines.map((l) => (
            <li key={l.item.variantId} className="flex items-end gap-3">
              <p className="flex min-w-0 flex-1 flex-col text-sm font-semibold text-ink">
                <span className="truncate">{l.item.name}</span>
                {typeof l.item.stockQty === 'number' ? (
                  <span className="num text-xs font-normal text-ink-muted">
                    {`على الرف ${displayNumber(String(l.item.stockQty / 1000), digits)}`}
                  </span>
                ) : null}
              </p>
              <TextField
                label="الكمية"
                className="w-28 shrink-0"
                dir="ltr"
                inputMode={l.item.unit?.allowsFraction ? 'decimal' : 'numeric'}
                inputClassName="num"
                value={l.qty}
                error={l.qtyThousandths === null ? 'اكتب كمية' : undefined}
                onChange={(e) =>
                  setPicked((list) =>
                    list.map((p) =>
                      p.item.variantId === l.item.variantId ? { ...p, qty: e.target.value.slice(0, 10) } : p,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="md"
                icon={<CloseIcon size={20} />}
                aria-label={`احذف ${l.item.name}`}
                onClick={() => setPicked((list) => list.filter((p) => p.item.variantId !== l.item.variantId))}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <Select label="السبب" value={reason} onChange={(e) => setReason(e.target.value)}>
        {choices.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </SalePanel>
  );
}

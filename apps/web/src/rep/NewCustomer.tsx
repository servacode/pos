import { useState } from 'react';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { normalizePhone } from '@serva/core/phone';
import { businessDateOf } from '@serva/core/sale';
import { Alert, Button, ChoiceCard, Dialog, TextField } from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { usePos } from '../pos/services';
import { validated } from '../pos/validate';
import { ScreenHead } from './parts';
import { useRepRequired, type RepState } from './state';

/**
 * «زبون جديد» in the market: the rep adds a shop he found. It is saved as the ordinary `customer`
 * document, so it works offline. Where the store asks for the supervisor's approval, he is sold to
 * for cash only until it comes.
 */
export function NewCustomer({
  catalog,
  createdBy,
  onCreated,
  onBack,
}: {
  catalog: Catalog;
  createdBy: string;
  onCreated: (customer: { id: string; name: string }) => void;
  onBack: () => void;
}) {
  const pos = usePos();
  const rep = useRepRequired();
  const settings = catalog.settings!;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const approval = rep.sheet?.settings.requireCustomerApproval ?? true;

  async function save() {
    const phoneValue = phone.trim() ? normalizePhone(phone) : null;
    if (name.trim().length < 2) return setError('اكتب اسم الزبون.');
    if (phone.trim() && !phoneValue) return setError('رقم الجوال غير صحيح. مثال: 0912345678');
    setSaving(true);
    setError(null);
    try {
      const entry = await validated(pos.save)({
        type: 'customer',
        payload: { name: name.trim(), phone: phoneValue, createdBy },
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      onCreated({ id: entry.doc.id, name: name.trim() });
    } catch {
      setError('لم يُحفظ الزبون. حاول مرة أخرى.');
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="زبون جديد" onBack={onBack} />
      {approval ? (
        <Alert tone="info">يبقى بانتظار موافقة المشرف، ويُباع له نقداً فقط حتى توافق الإدارة عليه.</Alert>
      ) : null}
      <TextField label="اسم الزبون" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} />
      <TextField
        label="الجوال (اختياري)"
        inputMode="tel"
        dir="ltr"
        value={phone}
        onChange={(e) => setPhone(e.target.value.slice(0, 20))}
        inputClassName="num"
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button size="lg" loading={saving} onClick={() => void save()}>
        احفظ وافتح الزبون
      </Button>
    </div>
  );
}

/** «لا بيع»: why the visit ended without a sale, from the store's own list of reasons */
export function NoSaleDialog({
  rep,
  customerId,
  onClose,
  onDone,
}: {
  rep: RepState;
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="sm"
      title="لماذا لا بيع؟"
      description="اختر السبب ليظهر في تقرير الزيارات."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={!reason}
            onClick={() => {
              if (!reason) return;
              rep.noSale(customerId, reason, note.trim() || null);
              onDone();
            }}
          >
            سجّل
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {rep.reasons.length === 0 ? (
          <p className="text-sm text-ink-muted">لا أسباب على هذا الجهاز بعد. تصل مع أول اتصال بالإنترنت.</p>
        ) : null}
        {rep.reasons
          .toSorted((a, b) => a.sortOrder - b.sortOrder)
          .map((r) => (
            <ChoiceCard
              key={r.id}
              name="no-sale-reason"
              title={r.name}
              checked={reason === r.id}
              onChange={() => setReason(r.id)}
            />
          ))}
        <TextField
          label="ملاحظة (اختياري)"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
        />
      </div>
    </Dialog>
  );
}

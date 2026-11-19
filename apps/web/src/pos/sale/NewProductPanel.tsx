import { useState } from 'react';
import type { CurrencyCode } from '@serva/core';
import type { Approval } from '@serva/core/contracts/documents';
import { Alert, Button, CloseIcon, AddIcon, Select, TextField } from '@serva/ui';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import { postNewProduct } from './newProduct';
import { SalePanel } from './SalePanel';

/**
 * «أضف صنف جديد» (decision 15): the barcode the till does not know, with a name, a price and a category.
 * Whoever holds catalog.manage adds it on their own; anyone else asks for a manager's code first (the till's
 * ordinary manager-code layer). It needs the server: a product is not a document the till can queue. The
 * product starts «بانتظار المراجعة»: it sells here at once, the owner reviews it later.
 */
export function NewProductPanel({
  barcode,
  currency,
  categories,
  staff,
  canManage,
  userId,
  onDone,
  onClose,
}: {
  barcode: string;
  currency: CurrencyCode;
  categories: readonly { id: string; label: string }[];
  staff: readonly StaffMember[];
  /** The signed-in user holds catalog.manage */
  canManage: boolean;
  userId: string;
  onDone: (added: { name: string }) => void;
  onClose: () => void;
}) {
  const pos = usePos();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceMinor = price.trim() ? parseAmount(price, currency) : null;
  const priceBad = price.trim() !== '' && (priceMinor === null || priceMinor < 1);
  const ready = name.trim().length > 0 && priceMinor !== null && priceMinor >= 1;

  async function add(actorId: string) {
    const token = pos.device.token;
    if (!pos.online() || !token) {
      setError('إضافة صنف تحتاج اتصالاً بالخادم. جرّب بعد عودة الاتصال، أو ابحث عن الصنف باسمه.');
      setAsking(false);
      return;
    }
    setSaving(true);
    setError(null);
    const answer = await postNewProduct(
      {
        actorId,
        nameAr: name.trim(),
        priceMinor: priceMinor!,
        categoryId: categoryId || null,
        barcode,
      },
      token,
      pos.fetch,
    );
    setSaving(false);
    if (answer.kind === 'ok') {
      onDone({ name: answer.body.nameAr });
      return;
    }
    setAsking(false);
    setError(
      answer.kind === 'refused' ? answer.message : 'لم يصل الطلب إلى الخادم. لم يُضف الصنف، أعد المحاولة.',
    );
  }

  function start() {
    if (!ready) return;
    if (canManage) void add(userId);
    else setAsking(true);
  }

  if (asking) {
    return (
      <ManagerCode
        staff={staff}
        permission="catalog.manage"
        reason={`إضافة صنف جديد «${name.trim()}» تحتاج رمز مدير.`}
        onApproved={(_approval: Approval, approver: StaffMember) => void add(approver.id)}
        onCancel={() => setAsking(false)}
      />
    );
  }

  return (
    <SalePanel
      label="أضف صنف جديد"
      title="أضف صنف جديد"
      subtitle="يُباع على هذا الكاشير فوراً، ويراجعه المالك لاحقاً."
      icon={<AddIcon size={20} />}
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
        <Button size="lg" icon={<AddIcon size={20} />} loading={saving} disabled={!ready} onClick={start}>
          {canManage ? 'أضف الصنف' : 'أضف الصنف برمز مدير'}
        </Button>
      }
    >
      <p className="text-ink-muted">
        الباركود <bdi className="num font-semibold text-ink">{barcode}</bdi> غير معروف في المتجر.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="اسم الصنف"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 120))}
          autoFocus
        />
        <TextField
          label="السعر"
          dir="ltr"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value.slice(0, 14))}
          error={priceBad ? 'اكتب سعراً صحيحاً أكبر من صفر' : undefined}
          inputClassName="num"
        />
        <Select label="التصنيف" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">بدون تصنيف</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </SalePanel>
  );
}

import { Link } from 'react-router';
import { useState } from 'react';
import { contactPhoneSchema, type SupplierRow } from '@serva/core';
import { Alert, Button, Dialog, NumberField, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { createSupplier, newDocumentId, openSupplierBalance } from './api';
import { findSupplierDuplicate } from './supplierRules';
import {
  OpeningBalanceFields,
  emptyOpening,
  openingInput,
  openingRateOk,
  type OpeningState,
} from './OpeningBalanceFields';
import { useSaving } from './PurchasesShared';

/** The payment days typed (Arabic digits too): a whole number up to 365, or null when empty or wrong */
export function termsDaysOf(text: string): number | null {
  const clean = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  if (clean === '' || clean.length > 3) return null;
  const n = Number(clean);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

/** «مورد جديد»: the window to add a supplier (shared with «الموردون») */
export function SupplierForm({
  suppliers,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const s = useSaving();
  const duplicate = findSupplierDuplicate(suppliers, name, phone);
  // Round 47: «رصيد افتتاحي», posted once the supplier is saved; its own id keeps a retry from posting it twice
  const [opening, setOpening] = useState<OpeningState>(emptyOpening);
  const [openingId] = useState(newDocumentId);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const openingWanted = opening.amount.trim() !== '';
  const openingReady =
    !openingWanted || (openingInput(opening, openingId) !== null && openingRateOk(opening));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="مورد جديد"
      description="من تشتري منه البضاعة. يظهر هنا ما له عليك بعد كل فاتورة ودفعة."
    >
      <form
        aria-label="مورد جديد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (duplicate && !confirmed) {
            setConfirmed(true);
            return;
          }
          // A phone that cannot be right is told here, before anything is sent
          const wrong = contactPhoneSchema.safeParse(phone);
          if (!wrong.success) {
            s.setFields({ phone: wrong.error.issues[0]?.message ?? 'رقم الهاتف غير صحيح' });
            return;
          }
          if (!openingReady) return;
          void s
            .run(async () => {
              // The supplier is saved once; when the balance then fails, only the balance is tried again
              const days = termsDaysOf(terms);
              const id =
                createdId ??
                (await createSupplier({ name, phone, ...(days !== null ? { termsDays: days } : {}) })).id;
              setCreatedId(id);
              const input = openingInput(opening, openingId);
              if (input) await openSupplierBalance(id, input);
              return id;
            })
            .then((r) => r && onSaved());
        }}
      >
        {s.error && !Object.keys(s.fields).length ? <Alert tone="error">{s.error}</Alert> : null}
        {duplicate ? (
          <Alert tone="warning">
            {duplicate.by === 'phone'
              ? `هذا الرقم مسجّل للمورد «${duplicate.supplier.name}».`
              : `يوجد مورد بالاسم نفسه «${duplicate.supplier.name}».`}{' '}
            <Link className="font-semibold underline" to={`/suppliers/${duplicate.supplier.id}/statement`}>
              افتح المورد
            </Link>
            {confirmed ? ' اضغط «أضِفه رغم ذلك» لتأكيد أنه مورد آخر.' : ''}
          </Alert>
        ) : null}
        <TextField
          label="اسم المورد"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={s.fields.name}
        />
        <TextField
          label="الجوال"
          hint="اختياري"
          dir="ltr"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (s.fields.phone) s.setFields({});
          }}
          error={s.fields.phone}
        />
        <NumberField
          label="أيام السداد"
          hint="اختياري: كم يوماً يمهلك هذا المورد. تبدأ منها مواعيد استحقاق فواتيره"
          decimals={0}
          value={terms}
          onValueChange={setTerms}
          error={s.fields.termsDays}
        />
        <OpeningBalanceFields
          value={opening}
          onChange={setOpening}
          base={me.settings.baseCurrency}
          errors={s.fields}
        />
        {createdId ? (
          <Alert tone="info">
            حُفظ المورد. اضغط «احفظ» لتسجيل رصيده الافتتاحي، أو «إلغاء» لتركه بلا رصيد.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={s.saving} disabled={!openingReady}>
            {duplicate && confirmed ? 'أضِفه رغم ذلك' : 'احفظ'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

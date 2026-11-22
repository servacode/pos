import { useState } from 'react';
import type { Prescription } from '@serva/core/contracts/documents';
import {
  missingPrescription,
  PRESCRIPTION_FIELD_LABELS,
  type PrescriptionField,
  type PrescriptionNeed,
} from '@serva/core/pharmacy';
import { Alert, Button, CheckIcon, ShieldCheckIcon, TextField } from '@serva/ui';
import { SalePanel } from './SalePanel';

const EMPTY: Prescription = { ref: null, doctor: null, patientName: null, patientId: null };

/**
 * «الوصفة» (03 › الصيدليات): the prescription number and doctor of a prescription medicine, and
 * for a controlled one also the patient's name and ID number, asked beside the cart before
 * payment. A field the store requires cannot stay empty; when none is required the cashier may skip.
 */
export function PrescriptionPanel({
  need,
  initial,
  controlled,
  onSave,
  onCancel,
}: {
  need: PrescriptionNeed;
  initial: Prescription | undefined;
  /** A controlled drug is in the sale: its details are the law's, never skipped */
  controlled: boolean;
  onSave: (prescription: Prescription) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Prescription>(initial ?? EMPTY);
  const [tried, setTried] = useState(false);
  const missing = missingPrescription(need, values);

  function save() {
    setTried(true);
    if (missing.length > 0) return;
    const clean = (v: string | null) => v?.trim() || null;
    onSave({
      ref: clean(values.ref),
      doctor: clean(values.doctor),
      patientName: clean(values.patientName),
      patientId: clean(values.patientId),
    });
  }

  const field = (key: PrescriptionField, extra: { dir?: 'ltr'; inputMode?: 'numeric' } = {}) => (
    <TextField
      key={key}
      label={PRESCRIPTION_FIELD_LABELS[key]}
      hint={need.required.includes(key) ? undefined : 'اختياري'}
      value={values[key] ?? ''}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value.slice(0, 120) }))}
      error={tried && missing.includes(key) ? 'اكتب ' + PRESCRIPTION_FIELD_LABELS[key] : undefined}
      autoFocus={key === need.shown[0]}
      {...extra}
    />
  );

  return (
    <SalePanel
      label={controlled ? 'دواء مراقَب' : 'وصفة طبية'}
      title="بيانات الوصفة"
      icon={<ShieldCheckIcon size={20} />}
    >
      {controlled ? (
        <Alert tone="warning">
          فاتورة فيها دواء مراقَب: تُسجَّل هذه البيانات في سجل الأدوية المراقبة ولا تُباع بدونها.
        </Alert>
      ) : null}
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {need.shown.map((key) => field(key, key === 'ref' || key === 'patientId' ? { dir: 'ltr' } : {}))}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" icon={<CheckIcon size={20} />}>
            تابع إلى الدفع
          </Button>
          {need.required.length === 0 ? (
            <Button variant="secondary" onClick={() => onSave(EMPTY)}>
              تخطَّ
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            رجوع
          </Button>
        </div>
      </form>
    </SalePanel>
  );
}

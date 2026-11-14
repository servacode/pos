import { useEffect, useState } from 'react';
import type { Approval } from '@serva/core/contracts/documents';
import { serialLabel } from '@serva/core/contracts/warranty';
import { Alert, Button, CheckIcon, SerialIcon, TextField } from '@serva/ui';
import type { OutboxEntry } from '@serva/sync';
import type { Catalog } from '../catalog';
import { usePos } from '../services';
import { deviceDocuments } from '../shift/shift';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import type { CartLine } from './cart';
import { SalePanel } from './SalePanel';
import { checkSerial, serialKey } from './serialCheck';

/**
 * «الرقم التسلسلي» (03 › الإلكترونيات): the number of the piece sold, scanned from its box or
 * typed, beside the cart. The sale cannot be paid until each such piece has its number, and the
 * number must be in the branch's stock for that product: one already sold or another product's is
 * refused (offline too: the pulled stock plus this till's own sales since). A number the store
 * never received (or did not enter) passes only with a manager's code, which the sale records.
 */
export function SerialPanel({
  line,
  taken,
  catalog,
  staff,
  onSave,
  onCancel,
}: {
  line: CartLine;
  /** Numbers already on other lines of this sale */
  taken: ReadonlySet<string>;
  catalog: Catalog;
  staff: readonly StaffMember[];
  onSave: (serials: string[], override?: { approval: Approval }) => void;
  onCancel: () => void;
}) {
  const pos = usePos();
  const label = serialLabel(catalog.settings?.sectors);
  const [value, setValue] = useState(line.serials?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  /** A number the store never received: a manager may let it through */
  const [offer, setOffer] = useState<string | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  // This till's own sales not yet pulled back: a number it sold a minute ago is sold
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [pos.store]);

  function save() {
    setUnknown(null);
    setOffer(null);
    const serial = serialKey(value);
    if (serial.length < 3) {
      setError('امسح الرقم من العلبة أو اكتبه.');
      return;
    }
    if (line.barcode && serial === serialKey(line.barcode)) {
      setError('هذا باركود الصنف لا الرقم التسلسلي للجهاز. امسح الرقم المطبوع على الجهاز نفسه.');
      return;
    }
    if (taken.has(serial)) {
      setError('هذا الرقم على سطر آخر في الفاتورة: كل جهاز له رقمه.');
      return;
    }
    const verdict = checkSerial(serial, line.variantId, catalog.serials, entries);
    if (verdict.kind === 'sold') {
      setError(
        verdict.saleNumber ? `هذا الرقم مباع في الفاتورة ${verdict.saleNumber}.` : 'هذا الرقم مباع من قبل.',
      );
      return;
    }
    if (verdict.kind === 'rented') {
      setError('هذا الجهاز مؤجَّر عند زبون: لا يُباع قبل أن يرجع.');
      return;
    }
    if (verdict.kind === 'other_product') {
      setError('هذا الرقم لصنف آخر في المحل. تأكد من الجهاز.');
      return;
    }
    if (verdict.kind === 'unknown') {
      setError('هذا الرقم غير موجود في مخزون هذا الفرع.');
      setOffer(serial);
      return;
    }
    onSave([serial]);
  }

  if (unknown) {
    return (
      <SalePanel label="الرقم التسلسلي" title={line.name} icon={<SerialIcon size={20} />}>
        <ManagerCode
          staff={staff}
          permission="inventory.adjust"
          reason={`الرقم ${unknown} غير مستلم في المحل. يسمح به المدير فقط، وتُسجَّل الموافقة على الفاتورة.`}
          onApproved={(approval) => onSave([unknown], { approval })}
          onCancel={() => setUnknown(null)}
        />
      </SalePanel>
    );
  }

  return (
    <SalePanel label="الرقم التسلسلي" title={line.name} icon={<SerialIcon size={20} />}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label={`${label} للجهاز`}
          dir="ltr"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputClassName="num"
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" icon={<CheckIcon size={20} />}>
            احفظ الرقم
          </Button>
          {offer ? (
            <Button variant="secondary" onClick={() => setUnknown(offer)}>
              اسمح به بمدير
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onCancel}>
            لاحقاً
          </Button>
        </div>
      </form>
    </SalePanel>
  );
}

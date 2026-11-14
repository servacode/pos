import { useEffect, useMemo, useState } from 'react';
import type { Approval, SalePayload } from '@serva/core/contracts/documents';
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

  // The numbers in stock for this product, to pick from instead of typing: not sold on this till since,
  // not on another line of this sale
  const available = useMemo(() => {
    const soldHere = new Set<string>();
    for (const entry of entries) {
      if (entry.doc.type !== 'sale') continue;
      for (const l of (entry.doc.payload as unknown as SalePayload).lines ?? [])
        for (const s of l.serials ?? []) soldHere.add(serialKey(s));
    }
    return catalog.serials
      .filter(
        (r) =>
          r.variantId === line.variantId &&
          r.status === 'in_stock' &&
          !soldHere.has(r.serial) &&
          !taken.has(r.serial),
      )
      .map((r) => r.serial)
      .sort();
  }, [catalog.serials, entries, line.variantId, taken]);
  const MAX_LISTED = 12;
  // Typing narrows the list
  const typed = serialKey(value);
  const narrowed = typed ? available.filter((serial) => serial.includes(typed)) : available;
  // A typed number that matches none (an unknown one) leaves the whole list showing, to pick from
  const listed = narrowed.length > 0 ? narrowed : available;

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
        {listed.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink-muted">
              الأرقام المتوفرة ({listed.length}) — اضغط رقماً ليُحفظ
            </p>
            <ul aria-label="الأرقام المتوفرة" className="flex flex-wrap gap-2">
              {listed.slice(0, MAX_LISTED).map((serial) => (
                <li key={serial}>
                  <button
                    type="button"
                    aria-pressed={serialKey(value) === serial}
                    onClick={() => {
                      // One tap: the number is in this branch's stock and on no other line, so it is saved
                      setValue(serial);
                      setError(null);
                      setOffer(null);
                      onSave([serial]);
                    }}
                    className={
                      serialKey(value) === serial
                        ? 'num min-h-11 rounded-control border border-brand bg-brand-soft px-3 text-sm font-semibold text-ink'
                        : 'num min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted'
                    }
                  >
                    <bdi dir="ltr">{serial}</bdi>
                  </button>
                </li>
              ))}
            </ul>
            {listed.length > MAX_LISTED ? (
              <p className="text-xs text-ink-subtle">
                والباقي ({listed.length - MAX_LISTED}): اكتب بداية الرقم أو امسحه.
              </p>
            ) : null}
          </div>
        ) : null}
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

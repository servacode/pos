import { useEffect, useState } from 'react';
import { Alert, Checkbox } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { stockSerialsOf } from './api';

/**
 * A count or a waste of a product that tracks serial numbers (round 60): which numbers left the shelf. One box per
 * number in stock in that branch; the person ticks as many as pieces are missing, so the serial list and the count
 * agree. `pieces` is the shortage in whole pieces.
 */
export function SerialPick({
  name,
  variantId,
  branchId,
  pieces,
  picked,
  onChange,
}: {
  name: string;
  variantId: string;
  branchId: string;
  pieces: number;
  picked: readonly string[];
  onChange: (serials: string[]) => void;
}) {
  const [list, setList] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    stockSerialsOf(variantId, branchId)
      .then((r) => live && setList(r.items))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [variantId, branchId]);
  const full = picked.length >= pieces;
  return (
    <fieldset className="ix-serials">
      <legend>
        {name}: اختر <bdi className="sx-n">{pieces}</bdi> رقماً تسلسلياً للقطع الناقصة (اخترت{' '}
        <bdi className="sx-n">{picked.length}</bdi>)
      </legend>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {list === null && !error ? <p className="sx-wait">…</p> : null}
      {list?.length === 0 ? (
        <p className="sx-wait">
          لا أرقام تسلسلية في مخزون هذا الفرع لهذا الصنف. أضفها من صفحة الأرقام التسلسلية.
        </p>
      ) : null}
      <div className="ix-serial-list">
        {(list ?? []).map((serial) => {
          const on = picked.includes(serial);
          return (
            <Checkbox
              key={serial}
              label={<bdi dir="ltr">{serial}</bdi>}
              checked={on}
              disabled={!on && full}
              onChange={() => onChange(on ? picked.filter((p) => p !== serial) : [...picked, serial])}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

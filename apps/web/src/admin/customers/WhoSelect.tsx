import { useState } from 'react';
import { CUSTOMER_KIND_LABELS, CUSTOMER_KINDS } from '@serva/core';
import { Select } from '@serva/ui';
import { CustomerPicker } from './CustomerPicker';

const ONE = '__one__';

/**
 * «لمن»: a type of customer («k:hospital») or ONE customer («c:<id>»), as one value. The customer is
 * found by a search on the server (CustomerPicker), not from a list loaded up front, so a store with
 * thousands of customers can pick the 501st. `customerName` shows the name of a value that came from
 * a saved row.
 */
export function WhoSelect({
  label,
  value,
  onChange,
  emptyLabel = 'اختر',
  hideLabel,
  customerName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  hideLabel?: boolean;
  customerName?: string | null | undefined;
}) {
  const [picking, setPicking] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const isOne = picking || value.startsWith('c:');
  const id = value.startsWith('c:') ? value.slice(2) : null;
  const picked = id ? { id, name: names[id] ?? customerName ?? '', phone: null } : null;
  return (
    <div className="flex flex-col gap-2">
      <Select
        label={label}
        {...(hideLabel ? { hideLabel: true } : {})}
        value={isOne ? ONE : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ONE) {
            setPicking(true);
            if (!id) onChange('');
          } else {
            setPicking(false);
            onChange(next);
          }
        }}
      >
        <option value="">{emptyLabel}</option>
        <optgroup label="نوع زبائن">
          {CUSTOMER_KINDS.map((k) => (
            <option key={k} value={`k:${k}`}>
              كل زبائن النوع: {CUSTOMER_KIND_LABELS[k]}
            </option>
          ))}
        </optgroup>
        <option value={ONE}>زبون واحد بالاسم…</option>
      </Select>
      {isOne ? (
        <CustomerPicker
          value={picked}
          onChange={(c) => {
            if (c) setNames((n) => ({ ...n, [c.id]: c.name }));
            onChange(c ? `c:${c.id}` : '');
          }}
        />
      ) : null}
    </div>
  );
}

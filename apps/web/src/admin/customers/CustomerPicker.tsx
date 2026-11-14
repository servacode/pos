import { useEffect, useState } from 'react';
import { Alert, AddIcon, Button, SearchField, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { createCustomer, listCustomers } from './api';

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Chooses a customer RECORD (a contract is tied to one, never to a typed name): a search over the
 * store's customers, and a quick form to add a new one without leaving the page.
 */
export function CustomerPicker({
  label = 'الزبون',
  value,
  onChange,
  error,
  disabled,
}: {
  label?: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PickedCustomer[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      listCustomers(q.trim())
        .then((r) => alive && setHits(r.items.filter((c) => !c.archived).slice(0, 6)))
        .catch(() => alive && setHits([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  async function add() {
    setSaving(true);
    setAddError(null);
    try {
      const made = await createCustomer({ name: name.trim(), phone: phone.trim() || null });
      onChange({ id: made.id, name: made.name, phone: made.phone });
      setAdding(false);
      setName('');
      setPhone('');
    } catch (e) {
      setAddError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line-control bg-surface px-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink">{value.name}</span>
            {value.phone ? (
              <bdi dir="ltr" className="num text-xs text-ink-muted">
                {value.phone}
              </bdi>
            ) : null}
          </span>
          {disabled ? null : (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              غيّر الزبون
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchField
          label={`${label}: ابحث بالاسم أو الجوال`}
          value={q}
          onValueChange={setQ}
          disabled={disabled}
        />
        {error ? <p className="mt-1 text-sm text-danger-ink">{error}</p> : null}
        {hits.length > 0 ? (
          <ul
            aria-label="الزبائن"
            className="absolute inset-x-0 z-10 mt-1 flex flex-col rounded-card border border-line bg-surface p-1.5 shadow-e2"
          >
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: c.id, name: c.name, phone: c.phone });
                    setQ('');
                    setHits([]);
                  }}
                  className="w-full rounded-small px-2.5 py-2 text-start font-semibold text-ink hover:bg-surface-muted"
                >
                  {c.name}
                  {c.phone ? (
                    <bdi dir="ltr" className="num ms-2 text-xs font-normal text-ink-muted">
                      {c.phone}
                    </bdi>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {adding ? (
        <div className="flex flex-col gap-3 rounded-card border border-line p-3">
          {addError ? <Alert tone="error">{addError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="اسم الزبون الجديد" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="الجوال (اختياري)"
              dir="ltr"
              inputClassName="num"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={name.trim().length < 2}
              onClick={() => void add()}
            >
              أضف الزبون
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              تراجع
            </Button>
          </div>
        </div>
      ) : disabled ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={<AddIcon size={16} />}
          className="self-start"
          onClick={() => setAdding(true)}
        >
          زبون جديد
        </Button>
      )}
    </div>
  );
}

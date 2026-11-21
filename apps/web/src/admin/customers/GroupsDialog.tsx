import { useEffect, useState } from 'react';
import { toLatinDigits, type CustomerGroup } from '@serva/core';
import { Alert, Button, Dialog, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { StatusPill } from '../sales/ui';
import { createGroup, listGroups, updateGroup } from './api';

/** «5» or «٧٫٥» as hundredths of a percent; null when it is not a number from 0 to 100 */
export function percentToBps(text: string): number | null {
  const clean = toLatinDigits(text).trim().replace(',', '.');
  if (clean === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bps = Math.round(Number(clean) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

/**
 * «مجموعات الزبائن»: a name and the discount its customers get (جملة كبار، موظفون…). The owner puts a
 * customer in a group from his page; the list filters by group and shows the discount.
 */
export function GroupsDialog({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<CustomerGroup[] | null>(null);
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = () =>
    listGroups()
      .then(setGroups)
      .catch((e: unknown) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    const discountBps = percentToBps(percent);
    if (discountBps === null) {
      setFieldError({ discountBps: 'اكتب نسبة من 0 إلى 100' });
      return;
    }
    setSaving(true);
    setError(null);
    setFieldError({});
    try {
      await createGroup({ name, discountBps });
      setName('');
      setPercent('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldError(e.fields);
      else setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(g: CustomerGroup) {
    setError(null);
    try {
      await updateGroup(g.id, { name: g.name, discountBps: g.discountBps, archived: !g.archived });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="مجموعات الزبائن"
      description="كل مجموعة باسم ونسبة خصم. تضع الزبون في مجموعة من صفحته، وتصفّي القائمة بها."
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {groups === null ? (
          <p className="sx-wait">نحمّل المجموعات…</p>
        ) : groups.length === 0 ? (
          <p className="sx-wait">لا مجموعات بعد.</p>
        ) : (
          <ul className="cx-groups" aria-label="المجموعات">
            {groups.map((g) => (
              <li key={g.id}>
                <span className="nm">{g.name}</span>
                <span className="sx-n sx-mute">
                  خصم <bdi>{g.discountBps / 100}</bdi>%
                </span>
                <span className="sx-n sx-mute">
                  <bdi>{g.customers}</bdi> زبون
                </span>
                {g.archived ? <StatusPill kind="open">مخفية</StatusPill> : null}
                {canManage ? (
                  <Button variant="ghost" size="sm" onClick={() => void toggle(g)}>
                    {g.archived ? 'أظهرها' : 'أخفها'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <form
            aria-label="مجموعة جديدة"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="cx-grid2">
              <TextField
                label="اسم المجموعة"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={fieldError.name}
                maxLength={60}
              />
              <TextField
                label="الخصم %"
                inputMode="decimal"
                dir="ltr"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                error={fieldError.discountBps}
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>
                إغلاق
              </Button>
              <Button type="submit" loading={saving} disabled={name.trim().length < 2}>
                أضف المجموعة
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

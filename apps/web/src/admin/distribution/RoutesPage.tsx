import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  COUNT_NOUNS,
  countNoun,
  WEEKDAY_LABELS,
  type RegionRow,
  type RepRow,
  type RouteRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  Switch,
  TextField,
  ToggleChip,
  TruckIcon,
  type DataColumn,
} from '@serva/ui';
import { Link } from 'react-router';
import { createRoute, listRegions, listReps, listRoutes, updateRoute } from './api';
import { FormFooter, saveFailure, useLoad } from './parts';

/** «السبت والاثنين»: the days a route is visited, from the week's start */
export function weekdaysText(days: readonly number[]): string {
  if (days.length === 0) return 'بلا أيام';
  if (days.length === 7) return 'كل يوم';
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d])
    .join('، ');
}

export function RouteDialog({
  route,
  regions,
  reps,
  onSaved,
  onCancel,
}: {
  route: RouteRow | null;
  regions: readonly RegionRow[];
  reps: readonly RepRow[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(route?.name ?? '');
  const [regionId, setRegionId] = useState(route?.regionId ?? '');
  const [repId, setRepId] = useState(route?.repId ?? '');
  const [days, setDays] = useState<number[]>(route?.weekdays ?? []);
  const [active, setActive] = useState(route?.isActive ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    const input = {
      name,
      regionId: regionId || null,
      repId: repId || null,
      weekdays: days,
      isActive: active,
    };
    try {
      const saved = route
        ? await updateRoute(route.id, { ...input, version: route.version })
        : await createRoute(input);
      onSaved(saved.id);
    } catch (e) {
      const failed = saveFailure(e);
      setFields(failed.fields);
      setError(failed.message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={route ? `تعديل ${route.name}` : 'خط سير جديد'}
      description="الخط هو الزبائن الذين يزورهم مندوب في أيام محددة، بترتيب الزيارة."
    >
      <form
        aria-label={route ? 'تعديل الخط' : 'خط سير جديد'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم الخط"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="المنطقة"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            error={fields.regionId}
          >
            <option value="">بلا منطقة</option>
            {regions
              .filter((r) => r.isActive || r.id === route?.regionId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
          <Select
            label="المندوب"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            error={fields.repId}
          >
            <option value="">بلا مندوب</option>
            {reps
              .filter((r) => r.isActive || r.id === route?.repId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.userName}
                </option>
              ))}
          </Select>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">أيام الزيارة</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <ToggleChip
                key={day}
                label={label}
                checked={days.includes(day)}
                onChange={(e) =>
                  setDays((current) =>
                    e.target.checked
                      ? [...current, day].sort((a, b) => a - b)
                      : current.filter((d) => d !== day),
                  )
                }
              />
            ))}
          </div>
          {fields.weekdays ? <p className="text-sm text-danger-ink">{fields.weekdays}</p> : null}
        </fieldset>
        {route ? <Switch label="فعّال" checked={active} onCheckedChange={setActive} /> : null}
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «خطوط السير»: which rep visits which customers on which days */
export function RoutesPage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(listRoutes);
  const regions = useLoad(listRegions);
  const reps = useLoad(listReps);
  const [editing, setEditing] = useState<RouteRow | 'new' | null>(null);

  const columns: DataColumn<RouteRow>[] = [
    {
      key: 'name',
      header: 'الخط',
      cell: (r) => (
        <div className="flex flex-col gap-0.5 py-2">
          <Link
            to={`/distribution/routes/${r.id}`}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {r.name}
          </Link>
          <span className="text-xs text-ink-muted">{weekdaysText(r.weekdays)}</span>
        </div>
      ),
    },
    { key: 'region', header: 'المنطقة', className: 'hidden sm:table-cell', cell: (r) => r.regionName ?? '—' },
    {
      key: 'rep',
      header: 'المندوب',
      cell: (r) => r.repName ?? <span className="text-ink-muted">بلا مندوب</span>,
    },
    {
      key: 'customers',
      header: 'الزبائن',
      className: 'hidden sm:table-cell',
      cell: (r) => countNoun(r.customerCount, COUNT_NOUNS.customer),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (r.isActive ? <Badge tone="success">فعّال</Badge> : <Badge>موقوف</Badge>),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
            عدّل
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="خطوط السير"
        description="رتّب زبائن كل مندوب في خط، وحدّد أيام زيارته."
        icon={<TruckIcon />}
        actions={
          <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
            خط جديد
          </Button>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="خطوط السير"
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={!data && !error}
        empty={
          <EmptyState icon={TruckIcon} title="لا خطوط بعد." description="أنشئ خطاً ثم أضف إليه زبائنه." />
        }
      />
      {editing ? (
        <RouteDialog
          route={editing === 'new' ? null : editing}
          regions={regions.data ?? []}
          reps={reps.data ?? []}
          onCancel={() => setEditing(null)}
          onSaved={(id) => {
            const fresh = editing === 'new';
            setEditing(null);
            reload();
            // A new route opens to add its customers
            if (fresh) void navigate(`/distribution/routes/${id}`);
          }}
        />
      ) : null}
    </>
  );
}

import { useState } from 'react';
import { COUNT_NOUNS, countNoun, type RegionRow } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EditIcon,
  EmptyState,
  PageHeader,
  Select,
  StoreIcon,
  Switch,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { createRegion, listRegions, updateRegion } from './api';
import { FormFooter, saveFailure, useLoad } from './parts';

/** The regions in reading order: each under its parent, with how deep it sits */
function inOrder(rows: readonly RegionRow[]): { row: RegionRow; depth: number }[] {
  const byParent = new Map<string | null, RegionRow[]>();
  const known = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    const key = row.parentId && known.has(row.parentId) ? row.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }
  const out: { row: RegionRow; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function RegionDialog({
  region,
  regions,
  onSaved,
  onCancel,
}: {
  region: RegionRow | null;
  regions: readonly RegionRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(region?.name ?? '');
  const [parentId, setParentId] = useState(region?.parentId ?? '');
  const [active, setActive] = useState(region?.isActive ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    const input = { name, parentId: parentId || null, isActive: active };
    try {
      if (region) await updateRegion(region.id, { ...input, version: region.version });
      else await createRegion(input);
      onSaved();
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
      title={region ? `تعديل ${region.name}` : 'منطقة جديدة'}
      description="المنطقة تجمع زبائن حي أو مدينة، وتُرتَّب بها خطوط السير والتقارير."
    >
      <form
        aria-label={region ? 'تعديل المنطقة' : 'منطقة جديدة'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم المنطقة"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <Select
          label="تتبع منطقة"
          hint="اختياري: مدينة تحت محافظة مثلاً"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          error={fields.parentId}
        >
          <option value="">منطقة رئيسية</option>
          {regions
            .filter((r) => r.id !== region?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
        {region ? <Switch label="فعّالة" checked={active} onCheckedChange={setActive} /> : null}
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

/** «المناطق»: where the customers are, for the routes and the reports */
export function RegionsPage() {
  const { data, error, reload } = useLoad(listRegions);
  const [editing, setEditing] = useState<RegionRow | 'new' | null>(null);
  const rows = data ? inOrder(data) : [];

  const columns: DataColumn<{ row: RegionRow; depth: number }>[] = [
    {
      key: 'name',
      header: 'المنطقة',
      cell: ({ row, depth }) => (
        <span className="font-semibold" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
          {row.name}
        </span>
      ),
    },
    {
      key: 'customers',
      header: 'الزبائن',
      cell: ({ row }) => countNoun(row.customerCount, COUNT_NOUNS.customer),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: ({ row }) => (row.isActive ? <Badge tone="success">فعّالة</Badge> : <Badge>موقوفة</Badge>),
    },
    {
      key: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(row)}>
            عدّل
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="المناطق"
        description="قسّم زبائنك إلى مناطق، ثم اربط كل خط سير بمنطقته."
        icon={<StoreIcon />}
        actions={
          <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
            منطقة جديدة
          </Button>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="المناطق"
        columns={columns}
        rows={rows}
        rowKey={({ row }) => row.id}
        loading={!data && !error}
        empty={<EmptyState icon={StoreIcon} title="لا مناطق بعد." description="أضف أول منطقة لزبائنك." />}
      />
      {editing ? (
        <RegionDialog
          region={editing === 'new' ? null : editing}
          regions={data ?? []}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

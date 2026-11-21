import { useState } from 'react';
import type { VanRow } from '@serva/core';
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
  TextField,
  TruckIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { createVan, listVans, setVanActive, updateVan } from './api';
import { FormFooter, saveFailure, useLoad } from './parts';

function VanDialog({
  van,
  onSaved,
  onCancel,
}: {
  van: VanRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const [name, setName] = useState(van?.name ?? '');
  const [home, setHome] = useState(van?.parentBranchId ?? me.branches[0]?.id ?? '');
  const [plate, setPlate] = useState(van?.vehiclePlate ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    const input = { name, parentBranchId: home, vehiclePlate: plate };
    try {
      if (van) await updateVan(van.id, input);
      else await createVan(input);
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
      title={van ? `تعديل ${van.name}` : 'سيارة جديدة'}
      description="للسيارة مخزونها الخاص، وتُحمَّل من فرعها بتحويل وتُجرَد آخر اليوم."
    >
      <form
        aria-label={van ? 'تعديل السيارة' : 'سيارة جديدة'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم السيارة"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <Select
          label="تُحمَّل من فرع"
          value={home}
          onChange={(e) => setHome(e.target.value)}
          error={fields.parentBranchId}
        >
          {me.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <TextField
          label="رقم اللوحة"
          hint="اختياري"
          dir="ltr"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          error={fields.vehiclePlate}
        />
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

/** «السيارات»: each is a branch of its own with its stock; a rep's phone is paired to it from «الأجهزة» */
export function VansPage() {
  const { data, error, reload } = useLoad(listVans);
  const [editing, setEditing] = useState<VanRow | 'new' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(van: VanRow) {
    setProblem(null);
    try {
      await setVanActive(van.id, !van.isActive);
      reload();
    } catch (e) {
      setProblem(errorMessage(e));
    }
  }

  const columns: DataColumn<VanRow>[] = [
    {
      key: 'name',
      header: 'السيارة',
      cell: (v) => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="font-semibold">{v.name}</span>
          <span className="text-xs text-ink-muted">
            <bdi className="num">{v.code}</bdi>
            {v.vehiclePlate ? ' · ' : ''}
            {v.vehiclePlate ? (
              <bdi dir="ltr" className="num">
                {v.vehiclePlate}
              </bdi>
            ) : null}
          </span>
        </div>
      ),
    },
    { key: 'home', header: 'تُحمَّل من', className: 'hidden sm:table-cell', cell: (v) => v.parentBranchName },
    {
      key: 'rep',
      header: 'المندوب',
      cell: (v) => v.repName ?? <span className="text-ink-muted">بلا مندوب</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (v) => (v.isActive ? <Badge tone="success">فعّالة</Badge> : <Badge>موقوفة</Badge>),
    },
    {
      key: 'actions',
      header: '',
      cell: (v) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(v)}>
            عدّل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggle(v)}>
            {v.isActive ? 'أوقف' : 'أعد التشغيل'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="السيارات"
        description="سيارات التوزيع. حمّل كل سيارة من «التحويل بين الفروع»، وتجد مخزونها هناك."
        icon={<TruckIcon />}
        actions={
          <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
            سيارة جديدة
          </Button>
        }
      />
      {error || problem ? <Alert tone="error">{error ?? problem}</Alert> : null}
      <DataTable
        caption="السيارات"
        columns={columns}
        rows={data ?? []}
        rowKey={(v) => v.id}
        loading={!data && !error}
        empty={
          <EmptyState icon={TruckIcon} title="لا سيارات بعد." description="أضف سيارة لكل مندوب يبيع منها." />
        }
      />
      {editing ? (
        <VanDialog
          van={editing === 'new' ? null : editing}
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

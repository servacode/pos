import { useCallback, useEffect, useState } from 'react';
import { COUNT_NOUNS, countNoun, type BranchAdminRow } from '@serva/core';
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
  StoreIcon,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { useAuth } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { createBranch, listBranches, setBranchActive, updateBranch } from './api';

/** Adds a branch or renames one: name, address and phone. */
function BranchDialog({
  branch,
  onSaved,
  onCancel,
}: {
  branch: BranchAdminRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone?.replace(/^\+963/, '0') ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    const input = { name, address, phone };
    try {
      if (branch) await updateBranch(branch.id, input);
      else await createBranch(input);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={branch ? `تعديل ${branch.name}` : 'فرع جديد'}
      description="الأجهزة والموظفون يُربطون بالفرع من صفحتيهما."
    >
      <form
        aria-label={branch ? 'تعديل الفرع' : 'فرع جديد'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم الفرع"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <TextField
          label="العنوان"
          hint="اختياري"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          error={fields.address}
        />
        <TextField
          label="هاتف الفرع"
          hint="اختياري: جوال أو هاتف أرضي"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fields.phone}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * «الفروع»: add a branch (within the plan), rename it, stop and restart it. A branch with cashier
 * devices is emptied first; the last active one stays. Stock moves between branches from «التحويل بين الفروع».
 */
export function BranchesPage() {
  const { refreshMe } = useAuth();
  const [rows, setRows] = useState<BranchAdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BranchAdminRow | 'new' | null>(null);

  const load = useCallback(() => {
    listBranches()
      .then(setRows)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function toggle(branch: BranchAdminRow) {
    setError(null);
    try {
      await setBranchActive(branch.id, !branch.isActive);
      await refreshMe();
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const columns: DataColumn<BranchAdminRow>[] = [
    {
      key: 'name',
      header: 'الفرع',
      cell: (b) => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="font-semibold">{b.name}</span>
          <span className="text-xs text-ink-muted">
            <bdi className="num">{b.code}</bdi>
            {b.address ? ` · ${b.address}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'devices',
      header: 'الأجهزة',
      className: 'hidden sm:table-cell',
      cell: (b) => countNoun(b.deviceCount, COUNT_NOUNS.device),
    },
    {
      key: 'staff',
      header: 'موظفون خاصون به',
      className: 'hidden sm:table-cell',
      cell: (b) => countNoun(b.staffCount, COUNT_NOUNS.user),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (b) => (b.isActive ? <Badge tone="success">فعّال</Badge> : <Badge>موقوف</Badge>),
    },
    {
      key: 'actions',
      header: '',
      cell: (b) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(b)}>
            عدّل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggle(b)}>
            {b.isActive ? 'أوقف' : 'أعد التشغيل'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <title>الفروع · SERFA</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          title="الفروع"
          description="فروع المحل، ولكل فرع أجهزته ومخزونه. التحويل بين الفروع يعمل حين يكون عندك فرعان فعّالان."
          icon={<StoreIcon />}
          actions={
            <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
              فرع جديد
            </Button>
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <DataTable
          caption="الفروع"
          columns={columns}
          rows={rows ?? []}
          rowKey={(b) => b.id}
          empty={<EmptyState icon={StoreIcon} title="لا فروع بعد." />}
        />
        {editing ? (
          <BranchDialog
            branch={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void refreshMe();
              load();
            }}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

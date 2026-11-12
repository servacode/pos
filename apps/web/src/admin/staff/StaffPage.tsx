import { useCallback, useEffect, useState } from 'react';
import type { StaffListResponse, StaffMember } from '@serva/core';
import {
  AddIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  EditIcon,
  EmptyState,
  IconButton,
  KeyIcon,
  LockIcon,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  PageHeader,
  Sheet,
  TextField,
  Tooltip,
  UserIcon,
  Dialog,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { listStaff, resetStaffPin, setStaffActive } from './api';
import { pinDigits } from './pin';
import { StaffForm } from './StaffForm';

const ROLE_TONE: Record<string, BadgeTone> = { owner: 'brand', manager: 'info' };

type Editing = 'new' | StaffMember | null;

/** The row's «⋯»: edit, a new till code, stop or bring back. The owner has none (theirs is «رمز الدخول» of the account). */
function RowMenu({
  member,
  onEdit,
  onPin,
  onToggle,
}: {
  member: StaffMember;
  onEdit: () => void;
  onPin: () => void;
  onToggle: () => void;
}) {
  const label = `خيارات ${member.fullName}`;
  return (
    <Menu
      label={label}
      align="end"
      trigger={
        <Tooltip content="خيارات">
          <IconButton label={label} icon={<MoreIcon />} size="sm" />
        </Tooltip>
      }
    >
      <MenuItem icon={<EditIcon />} onSelect={onEdit}>
        عدّل
      </MenuItem>
      <MenuItem icon={<KeyIcon />} onSelect={onPin}>
        رمز دخول جديد
      </MenuItem>
      <MenuSeparator />
      {member.status === 'active' ? (
        <MenuItem icon={<LockIcon />} tone="danger" onSelect={onToggle}>
          أوقف الموظف
        </MenuItem>
      ) : (
        <MenuItem icon={<UserIcon />} onSelect={onToggle}>
          أعد تفعيله
        </MenuItem>
      )}
    </Menu>
  );
}

/** A new till code for one person: typed once, shown as digits, refused with the server's words. */
function PinDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!member) return;
    setBusy(true);
    setProblem(null);
    try {
      await resetStaffPin(member.id, pinDigits(pin));
      setDone(true);
    } catch (e) {
      setProblem(e instanceof ApiError && e.fields?.pin ? e.fields.pin : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={member ? `رمز دخول جديد لـ«${member.fullName}»` : ''}
      description="الرمز القديم يتوقف عن العمل فوراً، وتتعلّم الأجهزة الرمز الجديد عند اتصالها."
      actions={
        done ? (
          <Button variant="secondary" onClick={onClose}>
            تم
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              تراجع
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              احفظ الرمز
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success">تم تغيير رمز الدخول. أخبر الموظف به.</Alert>
      ) : (
        <TextField
          label="رمز الدخول الجديد"
          hint={
            member?.pinLength === 6 || member?.roleKey === 'manager' ? '6 أرقام لهذا الدور.' : '4 أو 6 أرقام.'
          }
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          {...(problem ? { error: problem } : {})}
        />
      )}
    </Dialog>
  );
}

/**
 * «الموظفون»: the people who work in the store, with their role, their branches and whether they
 * can sign in now. The owner adds a cashier or a manager here and gives them a code to type on
 * the till; new people reach the tills the next time a device connects.
 */
export function StaffPage() {
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [pinFor, setPinFor] = useState<StaffMember | null>(null);
  const [toggling, setToggling] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listStaff()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const branchName = (id: string) => data?.branches.find((b) => b.id === id)?.name ?? '—';
  const branchesText = (m: StaffMember) =>
    m.branchIds === null ? 'كل الفروع' : m.branchIds.map(branchName).join('، ');

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    setActionError(null);
    try {
      await setStaffActive(toggling.id, toggling.status !== 'active');
      setToggling(null);
      load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<StaffMember>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-3 py-2">
          <Avatar name={m.fullName} size="sm" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-ink">{m.fullName}</span>
            {m.phone ? (
              <span className="text-xs text-ink-muted">
                <bdi dir="ltr" className="num">
                  {m.phone}
                </bdi>
              </span>
            ) : null}
            {/* On a phone the role column is hidden, so the role sits under the name. */}
            <span className="sm:hidden">
              <Badge tone={ROLE_TONE[m.roleKey] ?? 'neutral'}>{m.roleName || '—'}</Badge>
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'الدور',
      className: 'hidden sm:table-cell',
      cell: (m) => <Badge tone={ROLE_TONE[m.roleKey] ?? 'neutral'}>{m.roleName || '—'}</Badge>,
    },
    {
      key: 'branches',
      header: 'الفروع',
      className: 'hidden md:table-cell',
      cell: (m) => <span className="text-ink-muted">{branchesText(m)}</span>,
    },
    {
      key: 'access',
      header: 'الدخول',
      className: 'hidden lg:table-cell',
      cell: (m) => (
        <span className="text-sm text-ink-muted">
          {m.hasPin ? 'الكاشير' : 'بلا رمز'}
          {m.hasLogin ? ' + لوحة الإدارة' : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (m) =>
        m.status === 'active' ? <Badge tone="success">يعمل</Badge> : <Badge tone="danger">موقوف</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">خيارات</span>,
      className: 'relative w-px',
      cell: (m) =>
        m.isOwner ? null : (
          <RowMenu
            member={m}
            onEdit={() => setEditing(m)}
            onPin={() => setPinFor(m)}
            onToggle={() => {
              setActionError(null);
              setToggling(m);
            }}
          />
        ),
    },
  ];

  return (
    <AppShell>
      <title>الموظفون · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="الموظفون"
          description="من يعمل في متجرك، ودور كل واحد وفروعه ورمز دخوله على الكاشير."
          actions={
            data ? (
              <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
                موظف جديد
              </Button>
            ) : null
          }
        />
        <DataTable
          caption="الموظفون"
          columns={columns}
          rows={data?.staff ?? []}
          rowKey={(m) => m.id}
          loading={!data && !error}
          {...(error ? { error, onRetry: load } : {})}
          empty={<EmptyState icon={UserIcon} title="لا موظفين بعد." description="أضف أول موظف." />}
        />
      </div>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' || editing === null ? 'موظف جديد' : `عدّل «${editing.fullName}»`}
        description="الدور يحدد ما يقدر عليه، والفروع تحدد أين يعمل."
      >
        {editing !== null && data ? (
          <StaffForm
            key={editing === 'new' ? 'new' : editing.id}
            {...(editing === 'new' ? {} : { member: editing })}
            options={data}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>

      <PinDialog key={pinFor?.id ?? 'none'} member={pinFor} onClose={() => setPinFor(null)} />

      <Dialog
        open={toggling !== null}
        onOpenChange={(open) => !open && setToggling(null)}
        size="sm"
        title={
          toggling
            ? toggling.status === 'active'
              ? `أوقف «${toggling.fullName}»؟`
              : `أعد تفعيل «${toggling.fullName}»؟`
            : ''
        }
        description={
          toggling?.status === 'active'
            ? 'يخرج من لوحة الإدارة فوراً، ولا يستطيع الدخول على الكاشير. تبقى فواتيره وسجلاته كما هي، ويمكنك إعادته لاحقاً.'
            : 'يعود بدوره ورمز دخوله كما كانا.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setToggling(null)}>
              تراجع
            </Button>
            <Button
              variant={toggling?.status === 'active' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void confirmToggle()}
            >
              {toggling?.status === 'active' ? 'أوقفه' : 'أعد تفعيله'}
            </Button>
          </>
        }
      >
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      </Dialog>
    </AppShell>
  );
}

import { useEffect, useState } from 'react';
import type { StaffListResponse, StaffMember, StaffUpdateInput } from '@serva/core';
import { Alert, Button, Checkbox, PasswordField, Select, Switch, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useMe } from '../../auth/useAuth';
import { HALL_SECTORS, storeSells } from '../../lib/sectors';
import { checkPin, createStaff, updateStaff } from './api';
import { pinDigits } from './pin';

/** +963933111222 shown as 0933111222, the way it is typed */
const localPhone = (phone: string | null) => phone?.replace(/^\+963/, '0') ?? '';

/** 250 basis points shown as «2.5» */
const percentText = (bp: number | null | undefined) =>
  bp === null || bp === undefined ? '' : String(bp / 100);

/** «2.5» or «٢٫٥» as 250 basis points; null for blank, NaN for what is not a percent */
function basisPoints(text: string): number | null {
  const typed = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.')
    .trim();
  if (typed === '') return null;
  const n = Number(typed);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : Number.NaN;
}

/**
 * Adds a staff member or edits one: name, role, branches, the till code and, optionally, a
 * phone and password for the admin panel. On edit only what changed is sent; a blank code or
 * password stays as it is.
 */
export function StaffForm({
  member,
  options,
  onSaved,
  onCancel,
}: {
  member?: StaffMember;
  options: StaffListResponse;
  onSaved: (saved: StaffMember) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  // A role of one business type is offered only to a store that has it: the waiter to a restaurant
  // or café, the pharmacist to a pharmacy. A person who already holds one keeps it in the list.
  const roles = options.roles.filter(
    (r) =>
      r.key === member?.roleKey ||
      (r.assignable &&
        (r.key !== 'waiter' || storeSells(me.tenant.sectors, HALL_SECTORS)) &&
        (r.key !== 'pharmacist' || storeSells(me.tenant.sectors, ['pharmacy']))),
  );
  const [fullName, setFullName] = useState(member?.fullName ?? '');
  const [roleKey, setRoleKey] = useState(
    member?.roleKey ?? roles.find((r) => r.key === 'cashier')?.key ?? '',
  );
  const [allBranches, setAllBranches] = useState(member ? member.branchIds === null : true);
  const [branchIds, setBranchIds] = useState<string[]>(member?.branchIds ?? []);
  const [pin, setPin] = useState('');
  const [login, setLogin] = useState(member?.hasLogin ?? false);
  const [phone, setPhone] = useState(localPhone(member?.phone ?? null));
  const [password, setPassword] = useState('');
  // «نسبة العمولة ٪»: what the sales report pays a seller on the net sales (a report only)
  const [commission, setCommission] = useState(percentText(member?.commissionBp));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const role = options.roles.find((r) => r.key === roleKey);
  // The till code opens the cashier screen: a role that does not sell has no use for it unless it covers a shift
  const sellsAtTill = roleKey !== 'accountant' && roleKey !== 'storekeeper';
  const sameName = options.staff.filter(
    (m) => m.id !== member?.id && m.fullName.trim() !== '' && m.fullName.trim() === fullName.trim(),
  );
  const digits = role?.pinLength ?? 4;

  // Two people on one till code is allowed, but the owner is told who else has it
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  useEffect(() => {
    const code = pinDigits(pin);
    if (!/^\d{4,6}$/.test(code) || code.length !== digits) {
      setSharedWith([]);
      return;
    }
    let alive = true;
    checkPin(code, member?.id)
      .then((r) => alive && setSharedWith(r.sharedWith))
      .catch(() => alive && setSharedWith([]));
    return () => {
      alive = false;
    };
  }, [pin, digits, member?.id]);

  function toggleBranch(id: string, on: boolean) {
    setBranchIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  async function save() {
    const bp = basisPoints(commission);
    if (Number.isNaN(bp)) {
      setFields({ commissionBp: 'اكتب نسبة من 0 إلى 100' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const branches = allBranches ? null : branchIds;
    const code = pinDigits(pin);
    try {
      if (!member) {
        const created = await createStaff({
          fullName,
          roleKey,
          branchIds: branches,
          pin: code,
          ...(bp !== null ? { commissionBp: bp } : {}),
          ...(login ? { phone, password } : phone ? { phone } : {}),
        });
        onSaved(created);
        return;
      }
      const sameBranches =
        (member.branchIds === null && branches === null) ||
        (member.branchIds !== null &&
          branches !== null &&
          member.branchIds.length === branches.length &&
          member.branchIds.every((id) => branches.includes(id)));
      const patch: StaffUpdateInput = {
        ...(fullName !== member.fullName ? { fullName } : {}),
        ...(roleKey !== member.roleKey ? { roleKey } : {}),
        ...(sameBranches ? {} : { branchIds: branches }),
        ...(phone !== localPhone(member.phone) ? { phone: phone.trim() === '' ? null : phone } : {}),
        ...(code ? { pin: code } : {}),
        ...(bp !== (member.commissionBp ?? null) ? { commissionBp: bp } : {}),
        ...(login && password ? { password } : {}),
      };
      if (Object.keys(patch).length === 0) {
        onCancel();
        return;
      }
      onSaved(await updateStaff(member.id, patch));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={member ? 'عدّل الموظف' : 'موظف جديد'}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <TextField
        label="اسم الموظف"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        error={fields.fullName}
      />
      {sameName.length > 0 ? (
        <Alert tone="warning">
          يوجد موظف بهذا الاسم أصلاً. أضف حرفاً يميّزهما (اسم الأب أو الفرع) ليُعرف من باع.
        </Alert>
      ) : null}
      <Select
        label="الدور"
        value={roleKey}
        onChange={(e) => setRoleKey(e.target.value)}
        error={fields.roleKey}
        hint={role ? `رمز الدخول ${digits} أرقام لهذا الدور.` : undefined}
      >
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </Select>

      {member?.isOwner ? null : (
        <TextField
          label="نسبة العمولة ٪ (اختياري)"
          hint="تُحسب على مبيعه بعد المرتجع في «تقرير المبيعات». لا تُسجَّل في الحسابات."
          inputMode="decimal"
          dir="ltr"
          value={commission}
          onChange={(e) => setCommission(e.target.value.slice(0, 6))}
          error={fields.commissionBp}
          className="sm:max-w-48"
        />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">الفروع</legend>
        <Switch label="كل الفروع" checked={allBranches} onCheckedChange={setAllBranches} />
        {allBranches
          ? null
          : options.branches.map((b) => (
              <Checkbox
                key={b.id}
                label={b.name}
                checked={branchIds.includes(b.id)}
                onChange={(e) => toggleBranch(b.id, e.target.checked)}
              />
            ))}
        {fields.branchIds ? (
          <p role="alert" className="text-sm text-danger-ink">
            {fields.branchIds}
          </p>
        ) : null}
      </fieldset>

      <TextField
        label={member ? 'رمز دخول جديد' : 'رمز الدخول للكاشير'}
        hint={
          !sellsAtTill
            ? `اختياري: هذا الدور لا يبيع على الكاشير، والرمز ${digits} أرقام لا يُستعمل إلا إن فتح شاشة الكاشير.`
            : member
              ? `اتركه فارغاً ليبقى رمزه كما هو. ${digits} أرقام.`
              : `${digits} أرقام يكتبها على شاشة الكاشير. تجنّب 1234 و0000.`
        }
        inputMode="numeric"
        dir="ltr"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        error={fields.pin}
      />
      {sharedWith.length > 0 ? (
        <Alert tone="warning">
          هذا الرمز يستعمله أيضاً: {sharedWith.join('، ')}. يمكنك المتابعة، لكن الأفضل رمز لكل شخص ليُعرف من
          باع.
        </Alert>
      ) : null}

      <Switch
        label="يدخل لوحة الإدارة"
        description="برقم جواله وكلمة سر. بدونها يعمل على الكاشير فقط."
        checked={login}
        onCheckedChange={setLogin}
        disabled={member?.hasLogin === true}
      />
      {login || phone ? (
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <TextField
            label="الجوال"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={fields.phone}
          />
          {login ? (
            <PasswordField
              label={member?.hasLogin ? 'كلمة سر جديدة' : 'كلمة السر'}
              hint={member?.hasLogin ? 'اتركها فارغة لتبقى كما هي.' : '8 أحرف على الأقل.'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fields.password}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <Button variant="secondary" onClick={onCancel}>
          تراجع
        </Button>
        <Button type="submit" loading={saving}>
          احفظ
        </Button>
      </div>
    </form>
  );
}

import { useState, type FormEvent } from 'react';
import { deviceNameSchema } from '@serva/core';
import {
  Alert,
  Avatar,
  BackIcon,
  Badge,
  Button,
  ChoiceCard,
  DeviceIcon,
  LinkIcon,
  SendIcon,
  StoreIcon,
  TextField,
} from '@serva/ui';
import { DEVICE_KIND_LABELS, DEVICE_PLATFORM_LABELS, formatPairingCode } from '../../lib/devices';
import { APP_VERSION } from '../../offline/sync';
import type { LinkCredentials } from './MethodStep';

export interface NamedDevice {
  name: string;
  /** Only when the owner signed in here: the branch he picked */
  branchId: string | null;
}

interface NameStepProps {
  credentials: LinkCredentials;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (named: NamedDevice) => void;
}

const SUGGESTIONS = ['كاشير 1', 'كاشير 2', 'كاشير 3'];

/** Step 2: name the device; the owner signed in here also picks the branch. */
export function NameStep({ credentials, submitting, error, onBack, onSubmit }: NameStepProps) {
  const owner = credentials.method === 'owner' ? credentials.owner : null;
  const branches = owner?.me.branches ?? [];
  const [branchId, setBranchId] = useState<string | null>(branches[0]?.id ?? null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const parsed = deviceNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }
    onSubmit({ name: parsed.data, branchId: owner ? branchId : null });
  }

  return (
    <form noValidate onSubmit={submit} className="flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl/tight font-bold text-ink">
            {owner ? 'أين يعمل هذا الجهاز؟' : 'سمِّ هذا الجهاز'}
          </h1>
          <p className="text-ink-muted">
            {owner ? 'اختر الفرع وسمِّ الجهاز باسم يعرفه الكاشير.' : 'سمِّه باسم يعرفه الكاشير.'} الاسم يظهر
            في التقارير وعلى جوال المالك.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface py-2.5 ps-3 pe-4">
          {owner ? (
            <>
              <Avatar name={owner.me.tenant.name} />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-ink">{owner.me.tenant.name}</span>
                <span className="text-xs text-ink-muted">المالك: {owner.me.user.fullName}</span>
              </div>
              <Badge tone="success">دخل المالك</Badge>
            </>
          ) : (
            <>
              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand-ink">
                <LinkIcon />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-ink">
                  {credentials.method === 'code' ? 'رمز الربط' : 'رمز QR'}
                </span>
                {credentials.method === 'code' ? (
                  <span className="text-xs text-ink-muted">
                    <bdi className="num font-bold">{formatPairingCode(credentials.manualCode)}</bdi> · رمز
                    المتجر <bdi className="num">{credentials.storeCode}</bdi>
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted">قُرئ الرمز</span>
                )}
              </div>
              <Badge tone="success">جاهز</Badge>
            </>
          )}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {owner ? (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm font-semibold text-ink">الفرع</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((branch) => (
              <ChoiceCard
                key={branch.id}
                name="branch"
                value={branch.id}
                checked={branchId === branch.id}
                onChange={() => setBranchId(branch.id)}
                title={branch.name}
                description={`رمزه ${branch.code}`}
                leading={<StoreIcon />}
                className="min-h-20 p-4"
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_27.5rem]">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 shadow-e1">
          <TextField
            name="name"
            label="اسم الجهاز"
            autoComplete="off"
            placeholder="مثل: كاشير 1"
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(undefined);
            }}
            error={nameError}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="أسماء مقترحة">
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="secondary"
                size="md"
                aria-pressed={name === suggestion}
                onClick={() => {
                  setName(suggestion);
                  setNameError(undefined);
                }}
                className="rounded-full"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-6 shadow-e1">
          <div className="flex items-center gap-3.5">
            <span className="grid size-13 place-items-center rounded-control bg-brand-soft text-brand-ink">
              <DeviceIcon size={24} />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-ink-muted">نوع الجهاز</span>
              <span className="text-lg font-semibold text-ink">
                {DEVICE_KIND_LABELS.cashier} · {DEVICE_PLATFORM_LABELS.browser}
              </span>
            </div>
          </div>
          <hr className="border-line" />
          <p className="flex justify-between gap-3 text-sm">
            <span className="text-ink-muted">الفرع</span>
            <span className="font-semibold text-ink">
              {owner
                ? (branches.find((b) => b.id === branchId)?.name ?? '')
                : 'الذي اختاره المالك حين أنشأ الرمز'}
            </span>
          </p>
          <p className="flex justify-between gap-3 text-sm">
            <span className="text-ink-muted">النسخة</span>
            <bdi className="num font-semibold text-ink">{APP_VERSION}</bdi>
          </p>
          <p className="flex justify-between gap-3 text-sm">
            <span className="text-ink-muted">رمزه في الترقيم</span>
            <span className="font-semibold text-ink">يُعطى عند الموافقة</span>
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="lg" icon={<BackIcon />} onClick={onBack}>
          رجوع
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {owner ? null : <span className="text-sm text-ink-muted">يصل الطلب إلى جوال المالك فوراً.</span>}
          <Button type="submit" size="lg" loading={submitting} icon={owner ? <LinkIcon /> : <SendIcon />}>
            {owner ? 'اربط الجهاز' : 'اطلب موافقة المالك'}
          </Button>
        </div>
      </div>
    </form>
  );
}

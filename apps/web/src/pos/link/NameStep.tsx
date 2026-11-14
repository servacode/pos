import { useState, type FormEvent } from 'react';
import { deviceNameSchema, type DeviceKind } from '@serva/core';
import {
  Alert,
  Avatar,
  BackIcon,
  Badge,
  Button,
  ChoiceCard,
  DeviceIcon,
  IconChip,
  LinkIcon,
  SendIcon,
  StoreIcon,
  TextField,
} from '@serva/ui';
import { DEVICE_KIND_LABELS, DEVICE_PLATFORM_LABELS, formatPairingCode } from '../../lib/devices';
import { APP_VERSION } from '../../offline/sync';
import { SummaryRow } from '../FlowParts';
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
  /** What the device is for; a till unless the kitchen or waiter screen is linking */
  kind?: DeviceKind;
}

const SUGGESTIONS = ['كاشير 1', 'كاشير 2', 'كاشير 3'];

/** Step 2: name the device; the owner signed in here also picks the branch. */
export function NameStep({
  credentials,
  submitting,
  error,
  onBack,
  onSubmit,
  kind = 'cashier',
}: NameStepProps) {
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
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl/tight font-bold text-ink">
            {owner ? 'أين يعمل هذا الجهاز؟' : 'سمِّ هذا الجهاز'}
          </h1>
          <p className="text-lg text-ink-muted">
            {owner ? 'اختر الفرع وسمِّ الجهاز باسم يعرفه الكاشير.' : 'سمِّه باسم يعرفه الكاشير.'} الاسم يظهر
            في التقارير وعلى جوال المالك.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface py-2.5 ps-3 pe-4 shadow-e1">
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
              <IconChip>
                <LinkIcon />
              </IconChip>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-ink">
                  {credentials.method === 'code' ? 'رمز الربط' : 'رمز QR'}
                </span>
                {credentials.method === 'code' ? (
                  <span className="text-xs text-ink-muted">
                    <bdi className="num font-bold text-ink">{formatPairingCode(credentials.manualCode)}</bdi>{' '}
                    · رمز المتجر <bdi className="num">{credentials.storeCode}</bdi>
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
          <legend className="mb-2.5 text-sm font-semibold text-ink-muted">الفرع</legend>
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
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)]">
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-e1">
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
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-subtle">أو اختر اسماً جاهزاً:</span>
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
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 shadow-e1">
          <div className="flex items-center gap-3.5">
            <IconChip size="lg">
              <DeviceIcon size={24} />
            </IconChip>
            <div className="flex flex-col">
              <span className="text-sm text-ink-muted">نوع الجهاز</span>
              <span className="text-lg font-semibold text-ink">
                {DEVICE_KIND_LABELS[kind]} · {DEVICE_PLATFORM_LABELS.browser}
              </span>
            </div>
          </div>
          <dl className="flex flex-col border-t border-line">
            <SummaryRow label="الفرع">
              {owner
                ? (branches.find((b) => b.id === branchId)?.name ?? '')
                : 'الذي اختاره المالك حين أنشأ الرمز'}
            </SummaryRow>
            <SummaryRow label="النسخة">
              <bdi className="num">{APP_VERSION}</bdi>
            </SummaryRow>
            <SummaryRow label="رمزه في الترقيم">يُعطى عند الموافقة</SummaryRow>
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <Button variant="secondary" size="lg" icon={<BackIcon />} onClick={onBack}>
          رجوع
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          {owner ? null : <span className="text-sm text-ink-muted">يصل الطلب إلى جوال المالك فوراً.</span>}
          <Button type="submit" size="lg" loading={submitting} icon={owner ? <LinkIcon /> : <SendIcon />}>
            {owner ? 'اربط الجهاز' : 'اطلب موافقة المالك'}
          </Button>
        </div>
      </div>
    </form>
  );
}

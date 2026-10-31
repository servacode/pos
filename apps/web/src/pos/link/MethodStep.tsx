import { useState, type FormEvent, type ReactNode } from 'react';
import {
  loginInput,
  manualPairingCodeSchema,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_SECONDS,
  parsePairingQr,
  storeCodeSchema,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CameraIcon,
  ClockIcon,
  cn,
  DeviceIcon,
  InfoIcon,
  KeyIcon,
  NextIcon,
  PasswordField,
  QrCodeIcon,
  TextField,
  UserIcon,
} from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { formatPairingCode, formatStoreCode } from '../../lib/devices';
import { signInOwner, type OwnerSignIn } from './api';
import { canScanQr, QrScanner } from './QrScanner';

export type LinkMethod = 'qr' | 'code' | 'owner';

export type LinkCredentials =
  | { method: 'qr'; qrToken: string }
  | { method: 'code'; storeCode: string; manualCode: string }
  | { method: 'owner'; owner: OwnerSignIn };

interface MethodStepProps {
  method: LinkMethod;
  onMethodChange: (method: LinkMethod) => void;
  onNext: (credentials: LinkCredentials) => void;
  /** Filled again after «رجوع» from step 2 */
  initialCode?: { storeCode: string; manualCode: string };
}

const TTL_MINUTES = PAIRING_TTL_SECONDS / 60;

/** Step 1 «هل هذا جهاز كاشير؟»: three ways in, the chosen one's form beside them. */
export function MethodStep({ method, onMethodChange, onNext, initialCode }: MethodStepProps) {
  const scan = canScanQr();
  const options: {
    key: LinkMethod;
    title: string;
    description: string;
    icon: ReactNode;
    fastest?: boolean;
  }[] = [
    {
      key: 'qr',
      title: scan ? 'امسح رمز QR من الإدارة' : 'الصق رابط الربط',
      description: 'من الإدارة أو جوال المالك: الأجهزة ← «اربط جهازاً جديداً».',
      icon: <QrCodeIcon size={24} />,
      fastest: scan,
    },
    {
      key: 'code',
      title: 'اكتب رمز الربط مع رمز المتجر',
      description: 'رمز من 8 خانات يظهر تحت رمز QR نفسه.',
      icon: <KeyIcon size={24} />,
    },
    {
      key: 'owner',
      title: 'ادخل بحساب المالك',
      description: 'برقم جوال المالك وكلمة السر، فلا يحتاج موافقة من جواله.',
      icon: <UserIcon size={24} />,
    },
  ];

  return (
    <div className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,32.5rem)_minmax(0,1fr)] lg:gap-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <Badge tone="info" className="gap-1.5 self-start py-1 text-sm">
            <DeviceIcon size={16} />
            جهاز جديد · متصفح
          </Badge>
          <h1 className="text-3xl/tight font-bold text-ink">هل هذا جهاز كاشير؟</h1>
          <p className="text-lg text-ink-muted">
            اربطه بمتجرك مرة واحدة. بعدها يبيع ويطبع ويحفظ الفواتير حتى دون إنترنت.
          </p>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">طريقة الربط</legend>
          {options.map((option) => {
            const checked = option.key === method;
            return (
              <label
                key={option.key}
                className={cn(
                  'flex min-h-20 cursor-pointer items-center gap-4 rounded-card border bg-surface px-5 py-4 shadow-e1 transition-[border-color,box-shadow] duration-120',
                  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                  checked ? 'border-2 border-brand bg-brand-soft' : 'border-line hover:border-line-control',
                )}
              >
                <span
                  className={cn(
                    'grid size-13 shrink-0 place-items-center rounded-control',
                    checked ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-ink',
                  )}
                >
                  {option.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-ink">{option.title}</span>
                    {option.fastest ? <Badge tone="success">الأسرع</Badge> : null}
                  </span>
                  <span className="text-sm text-ink-muted">{option.description}</span>
                </span>
                <input
                  type="radio"
                  name="link-method"
                  value={option.key}
                  checked={checked}
                  onChange={() => onMethodChange(option.key)}
                  className="size-5 shrink-0 accent-brand"
                />
              </label>
            );
          })}
        </fieldset>
        <p className="flex items-center gap-2.5 text-sm text-ink-muted">
          <InfoIcon />
          الربط وحده يحتاج إنترنت، مرة واحدة لكل جهاز.
        </p>
      </div>

      <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 shadow-e2 sm:p-8">
        {method === 'code' ? <CodeForm onNext={onNext} initial={initialCode} /> : null}
        {method === 'qr' ? <QrForm scan={scan} onNext={onNext} /> : null}
        {method === 'owner' ? <OwnerForm onNext={onNext} /> : null}
      </section>
    </div>
  );
}

function CodeForm({
  onNext,
  initial,
}: {
  onNext: MethodStepProps['onNext'];
  initial?: { storeCode: string; manualCode: string };
}) {
  const [storeCode, setStoreCode] = useState(initial?.storeCode ?? '');
  const [manualCode, setManualCode] = useState(initial ? formatPairingCode(initial.manualCode) : '');
  const [errors, setErrors] = useState<{ storeCode?: string; manualCode?: string }>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const store = storeCodeSchema.safeParse(storeCode);
    const code = manualPairingCodeSchema.safeParse(manualCode);
    if (!store.success || !code.success) {
      setErrors({
        storeCode: store.success ? undefined : store.error.issues[0]?.message,
        manualCode: code.success ? undefined : code.error.issues[0]?.message,
      });
      return;
    }
    onNext({ method: 'code', storeCode: store.data, manualCode: code.data });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">رمز الربط</h2>
        <Badge tone="warning" className="gap-1.5 py-1 text-sm">
          <ClockIcon size={16} />
          صالح <span className="num">{TTL_MINUTES}</span> دقائق ·{' '}
          <span className="num">{PAIRING_MAX_ATTEMPTS}</span> محاولات
        </Badge>
      </div>
      <TextField
        name="storeCode"
        label="رمز المتجر"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="000000"
        value={storeCode}
        onChange={(e) => {
          setStoreCode(formatStoreCode(e.target.value));
          setErrors((current) => ({ ...current, storeCode: undefined }));
        }}
        hint="6 أرقام، تجدها في الإدارة تحت رمز QR، أو اسأل المالك."
        error={errors.storeCode}
        inputClassName="num text-2xl font-bold tracking-[0.15em]"
      />
      <TextField
        name="manualCode"
        label="رمز الربط (8 خانات)"
        dir="ltr"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        value={manualCode}
        onChange={(e) => {
          setManualCode(formatPairingCode(e.target.value));
          setErrors((current) => ({ ...current, manualCode: undefined }));
        }}
        hint="حروف لاتينية وأرقام، ولا فرق بين الحرف الكبير والصغير."
        error={errors.manualCode}
        inputClassName="num h-16 text-[1.625rem] font-bold tracking-[0.2em]"
      />
      <Button type="submit" size="lg" fullWidth icon={<NextIcon />}>
        التالي: سمِّ الجهاز
      </Button>
    </form>
  );
}

const NOT_A_LINK = 'هذا ليس رابط ربط من سيرفا. انسخه كما هو من الإدارة.';

function QrForm({ scan, onNext }: { scan: boolean; onNext: MethodStepProps['onNext'] }) {
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const token = parsePairingQr(link);
    if (!token) {
      setError(NOT_A_LINK);
      return;
    }
    onNext({ method: 'qr', qrToken: token });
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold text-ink">{scan ? 'رمز QR' : 'رابط الربط'}</h2>
      {scan ? (
        scanning ? (
          <QrScanner
            onToken={(qrToken) => onNext({ method: 'qr', qrToken })}
            onClose={() => setScanning(false)}
          />
        ) : (
          <Button size="lg" fullWidth icon={<CameraIcon />} onClick={() => setScanning(true)}>
            افتح الكاميرا وامسح الرمز
          </Button>
        )
      ) : (
        <p className="text-ink-muted">
          هذا المتصفح لا يقرأ رمز QR من الكاميرا. افتح الرابط من جوال المالك وانسخه هنا، أو اكتب رمز الربط.
        </p>
      )}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          name="qrLink"
          label={scan ? 'أو الصق رابط الربط' : 'رابط الربط'}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://…/link#spq_…"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
        <Button
          type="submit"
          size="lg"
          variant={scan ? 'secondary' : 'primary'}
          fullWidth
          icon={<NextIcon />}
        >
          التالي: سمِّ الجهاز
        </Button>
      </form>
    </div>
  );
}

function OwnerForm({ onNext }: { onNext: MethodStepProps['onNext'] }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const parsed = loginInput.safeParse({ phone, password });
    if (!parsed.success) {
      const next: { phone?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'phone' || key === 'password') next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setSubmitting(true);
    try {
      const owner = await signInOwner(parsed.data);
      if (!owner.me.user.roles.some((role) => role.key === 'owner')) {
        setFormError('هذا الحساب ليس حساب المالك. اطلب من المالك أن يدخل، أو استعمل رمز الربط.');
        return;
      }
      if (owner.me.branches.length === 0) {
        setFormError('لا فرع في هذا المتجر بعد. أضف فرعاً من الإدارة ثم اربط الجهاز.');
        return;
      }
      onNext({ method: 'owner', owner });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold text-ink">حساب المالك</h2>
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        name="phone"
        label="رقم جوال المالك"
        type="tel"
        dir="ltr"
        inputMode="tel"
        autoComplete="off"
        placeholder="09xxxxxxxx"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setErrors((current) => ({ ...current, phone: undefined }));
        }}
        error={errors.phone}
      />
      <PasswordField
        name="password"
        label="كلمة السر"
        autoComplete="off"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setErrors((current) => ({ ...current, password: undefined }));
        }}
        error={errors.password}
      />
      <p className="text-sm text-ink-muted">لا يبقى حساب المالك مفتوحاً على هذا الجهاز بعد الربط.</p>
      <Button type="submit" size="lg" fullWidth loading={submitting}>
        دخول
      </Button>
    </form>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { legalInput, type LegalDetails } from '@serva/core';
import {
  Alert,
  BookIcon,
  Button,
  Card,
  CardHeader,
  ClockIcon,
  DeviceIcon,
  PhoneIcon,
  Skeleton,
  SkeletonText,
  StoreIcon,
  Switch,
  TextField,
  TextLink,
} from '@serva/ui';
import { errorMessage } from '../lib/api';
import { BLANK_LABELS, OPTIONAL_KEYS, type LegalKey } from '../legal/config';
import { DateField } from '../lib/DateField';

/** The part of the panel's call the form needs (PlatformApp's usePlatform) */
type Call = <T = unknown>(path: string, options?: { method?: 'PUT'; body?: unknown }) => Promise<T>;

type TextKey = Exclude<keyof LegalDetails, 'reviewedByLawyer' | 'updatedAt'>;

interface FieldSpec {
  key: TextKey;
  hint?: string;
  /** Latin text (an email, a number): typed left to right */
  ltr?: boolean;
  wide?: boolean;
}

/** The form, in groups: the company, how to reach it, retention, and the providers named in the privacy policy. */
const GROUPS: readonly {
  title: string;
  description: string;
  icon: ReactNode;
  fields: readonly FieldSpec[];
}[] = [
  {
    title: 'الشركة',
    icon: <StoreIcon />,
    description: 'الاسم الذي تُسمّى به المنصة في شروط الاستخدام، ومن يمثّلها.',
    fields: [
      { key: 'companyName' },
      { key: 'ownerName', hint: 'يظهر في شروط الاستخدام: «وصاحب المشروع …»' },
      { key: 'commercialRegister', hint: 'إن تُرك فارغاً لا تذكره الشروط' },
      { key: 'address', wide: true },
    ],
  },
  {
    title: 'التواصل',
    icon: <PhoneIcon />,
    description: 'ما يراه المتجر حين يريد أن يسأل عن بياناته أو يطلب الدعم.',
    fields: [
      { key: 'email', ltr: true },
      { key: 'supportWhatsapp', ltr: true, hint: 'بصيغة الجوال السوري أو الدولية' },
      { key: 'phone', ltr: true, hint: 'إن اختلف عن واتساب الدعم' },
      { key: 'governingCity' },
    ],
  },
  {
    title: 'الحفظ والدفع',
    icon: <ClockIcon />,
    description: 'مدد وأرقام تذكرها الشروط وسياسة الخصوصية.',
    fields: [{ key: 'financialRetention' }, { key: 'paymentTolerance', ltr: true }],
  },
  {
    title: 'المزوّدون',
    icon: <DeviceIcon />,
    description: 'الجهات التي تعالج بيانات المتاجر، وتُسمّى في سياسة الخصوصية.',
    fields: [
      { key: 'hostingProvider' },
      { key: 'hostingCountry' },
      { key: 'backupProvider' },
      { key: 'smsProvider' },
      { key: 'aiProvider', wide: true },
    ],
  },
];

/** Each field's own message, from the same rules the server applies (legalInput) */
function fieldErrors(form: LegalDetails): Record<string, string> {
  const result = legalInput.safeParse(form);
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);
const isOptional = (key: string) => (OPTIONAL_KEYS as readonly string[]).includes(key);

/** «بيانات الشركة والصفحات القانونية»: edits what /terms, /privacy and the contact details read. */
export function PlatformLegal({ call }: { call: Call }) {
  const [form, setForm] = useState<LegalDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Messages show per field once a save was tried; until then typing is left alone
  const [tried, setTried] = useState(false);
  const load = useCallback(() => {
    setError(null);
    call<LegalDetails>('/v1/platform/legal')
      .then(setForm)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [call]);
  useEffect(load, [load]);

  if (!form) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <div aria-hidden="true" className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="flex flex-col gap-6">
            <Skeleton className="h-6 w-40" />
            <SkeletonText lines={2} />
          </Card>
        ))}
      </div>
    );
  }

  const set = (patch: Partial<LegalDetails>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const problems = fieldErrors(form);
  const shown = (key: string) => (tried ? problems[key] : undefined);
  const blanks = (Object.keys(BLANK_LABELS) as LegalKey[]).filter(
    (key) => !isOptional(key) && String(form[key as TextKey] ?? '').trim() === '',
  );

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        setError(null);
        setTried(true);
        if (Object.keys(problems).length > 0) {
          setError('تحقّق من الحقول المظلّلة قبل الحفظ.');
          return;
        }
        call('/v1/platform/legal', { method: 'PUT', body: form })
          .then(() => {
            setSaved(true);
            load();
          })
          .catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      <Card>
        <CardHeader
          icon={<BookIcon />}
          title="الصفحات القانونية"
          description="تقرأ الصفحتان العامتان هذه البيانات مباشرة، فأي تعديل يظهر فيهما عند الحفظ."
        />
        <div className="mb-4 flex flex-wrap items-center gap-x-4 text-sm">
          <TextLink
            href="/terms"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center"
          >
            شروط الاستخدام
          </TextLink>
          <TextLink
            href="/privacy"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center"
          >
            سياسة الخصوصية
          </TextLink>
        </div>
        {blanks.length > 0 ? (
          <Alert tone="warning" title={`بقيت ${blanks.length} خانات فارغة`}>
            {blanks.map((key) => BLANK_LABELS[key]).join('، ')}
          </Alert>
        ) : (
          <Alert tone="success">كل الخانات الإلزامية معبّأة.</Alert>
        )}
      </Card>

      <p className="px-1 text-sm text-ink-muted">
        الحقول التي عليها <span aria-hidden="true">*</span> مطلوبة قبل اعتماد النصين، ويمكن حفظ المسودة
        بدونها.
      </p>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader icon={group.icon} title={group.title} description={group.description} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            {group.fields.map((field) => (
              <TextField
                key={field.key}
                label={
                  (BLANK_LABELS[field.key as LegalKey] ?? field.key) +
                  (isOptional(field.key) ? ' (اختياري)' : ' *')
                }
                aria-required={isOptional(field.key) ? undefined : true}
                error={shown(field.key)}
                hint={field.hint}
                dir={field.ltr ? 'ltr' : undefined}
                value={form[field.key]}
                onChange={(e) => set({ [field.key]: e.target.value })}
                className={field.wide ? 'md:col-span-2' : undefined}
              />
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <CardHeader
          icon={<BookIcon />}
          title="مراجعة المحامي"
          description="لا تُعدّ الصفحتان نهائيتين قبل أن يراجعهما محامٍ وتُعبّأ كل الخانات."
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Switch
            label="راجع المحامي النصين"
            checked={form.reviewedByLawyer}
            onCheckedChange={(reviewedByLawyer) => set({ reviewedByLawyer })}
          />
          <DateField
            label="تاريخ آخر تحديث للنصوص"
            value={form.updatedAt}
            onChange={(day) => set({ updatedAt: day })}
            error={shown('updatedAt')}
            endExtra={
              <Button type="button" variant="ghost" size="sm" onClick={() => set({ updatedAt: today() })}>
                اليوم
              </Button>
            }
          />
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 mt-2 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface/90 p-3 shadow-e2 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {saved ? <Alert tone="success">حُفظت بيانات الشركة.</Alert> : null}
          {!error && !saved ? (
            <p className="px-1 text-sm text-ink-muted">
              تظهر هذه البيانات في الصفحات العامة، فراجعها قبل الحفظ.
            </p>
          ) : null}
        </div>
        <Button type="submit">احفظ</Button>
      </div>
    </form>
  );
}

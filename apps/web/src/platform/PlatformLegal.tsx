import { useCallback, useEffect, useState } from 'react';
import { type LegalDetails } from '@serva/core';
import {
  Alert,
  BookIcon,
  Button,
  Card,
  CardHeader,
  Skeleton,
  SkeletonText,
  StoreIcon,
  Switch,
  TextField,
  TextLink,
} from '@serva/ui';
import { errorMessage } from '../lib/api';
import { BLANK_LABELS, OPTIONAL_KEYS, type LegalKey } from '../legal/config';

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
const GROUPS: readonly { title: string; description: string; fields: readonly FieldSpec[] }[] = [
  {
    title: 'الشركة',
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
    description: 'مدد وأرقام تذكرها الشروط وسياسة الخصوصية.',
    fields: [{ key: 'financialRetention' }, { key: 'paymentTolerance', ltr: true }],
  },
  {
    title: 'المزوّدون',
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

const today = () => new Date().toISOString().slice(0, 10);
const isOptional = (key: string) => (OPTIONAL_KEYS as readonly string[]).includes(key);

/** «بيانات الشركة والصفحات القانونية»: edits what /terms, /privacy and the contact details read. */
export function PlatformLegal({ call }: { call: Call }) {
  const [form, setForm] = useState<LegalDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
  const blanks = (Object.keys(BLANK_LABELS) as LegalKey[]).filter(
    (key) => !isOptional(key) && String(form[key as TextKey] ?? '').trim() === '',
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        setError(null);
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
          action={
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <TextLink href="/terms" target="_blank" rel="noopener">
                شروط الاستخدام
              </TextLink>
              <TextLink href="/privacy" target="_blank" rel="noopener">
                سياسة الخصوصية
              </TextLink>
            </div>
          }
        />
        {blanks.length > 0 ? (
          <Alert tone="warning" title={`بقيت ${blanks.length} خانات فارغة`}>
            {blanks.map((key) => BLANK_LABELS[key]).join('، ')}
          </Alert>
        ) : (
          <Alert tone="success">كل الخانات الإلزامية معبّأة.</Alert>
        )}
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader icon={<StoreIcon />} title={group.title} description={group.description} />
          <div className="grid gap-4 md:grid-cols-2">
            {group.fields.map((field) => (
              <TextField
                key={field.key}
                label={
                  (BLANK_LABELS[field.key as LegalKey] ?? field.key) +
                  (isOptional(field.key) ? ' (اختياري)' : '')
                }
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
        <div className="grid gap-4 md:grid-cols-2">
          <Switch
            label="راجع المحامي النصين"
            checked={form.reviewedByLawyer}
            onCheckedChange={(reviewedByLawyer) => set({ reviewedByLawyer })}
          />
          <TextField
            label="تاريخ آخر تحديث للنصوص"
            type="date"
            dir="ltr"
            value={form.updatedAt}
            onChange={(e) => set({ updatedAt: e.target.value })}
            endAdornment={
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

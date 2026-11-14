import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { TAX_KINDS, type TaxKind, type TaxRate } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  PercentIcon,
  Select,
  Switch,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { ApiError, errorMessage } from '../../lib/api';
import { createRate, listRates, setDefaultRate, updateRate } from './api';

/** What each kind is for, in the owner's words (it picks the account the tax is posted to) */
const KIND_TEXT: Record<TaxKind, string> = {
  consumption: 'رسم إنفاق استهلاكي',
  stamp: 'رسم طابع',
  sales: 'ضريبة مبيعات',
};

/** «7.5» or «10» percent to basis points; null while unusable */
export function bpOf(text: string): number | null {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.')
    .replace('%', '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp > 0 && bp <= 10_000 ? bp : null;
}

/** 1500 basis points as «15» and 750 as «7.5» */
const percentText = (bp: number): string => String(bp / 100);

function RateDialog({
  rate,
  onClose,
  onSaved,
}: {
  /** The rate being edited; null makes a new one */
  rate: TaxRate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rate?.name ?? '');
  const [percent, setPercent] = useState(rate ? percentText(rate.rateBp) : '');
  const [kind, setKind] = useState<TaxKind>(rate?.kind ?? 'sales');
  const [onReceipt, setOnReceipt] = useState(rate?.showOnReceipt ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setError(null);
    const bp = rate ? rate.rateBp : bpOf(percent);
    if (bp === null) {
      setErrors({ percent: 'اكتب نسبة بين 0.01 و100، مثل 5 أو 7.5' });
      return;
    }
    setSaving(true);
    try {
      if (rate) await updateRate(rate.id, { version: rate.version, name, showOnReceipt: onReceipt });
      else await createRate({ name, rateBp: bp, kind, showOnReceipt: onReceipt });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={rate ? 'تعديل الضريبة' : 'ضريبة جديدة'}
      description={
        rate
          ? 'تتغير التسمية وظهورها على الإيصال فقط. النسبة ثابتة بعد إنشائها.'
          : 'النسبة لا تتغير بعد الحفظ.'
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" form="tax-rate-form" loading={saving}>
            {rate ? 'احفظ' : 'أضف الضريبة'}
          </Button>
        </>
      }
    >
      <form id="tax-rate-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {error && Object.keys(errors).length === 0 ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم الضريبة"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        {rate ? (
          <p className="text-sm text-ink-muted">
            النسبة: <span className="num font-semibold text-ink">{percentText(rate.rateBp)}%</span> ·{' '}
            {KIND_TEXT[rate.kind]}
          </p>
        ) : (
          <>
            <TextField
              label="النسبة بالمئة"
              inputMode="decimal"
              dir="ltr"
              inputClassName="num"
              placeholder="مثل 5 أو 7.5"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              error={errors.percent ?? errors.rateBp}
            />
            <Select
              label="نوع الضريبة"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaxKind)}
              hint="يحدد الحساب الذي تُقيَّد فيه الضريبة المحصَّلة."
            >
              {TAX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </Select>
          </>
        )}
        <Switch label="تظهر على الإيصال" checked={onReceipt} onCheckedChange={setOnReceipt} />
      </form>
    </Dialog>
  );
}

/**
 * «الضرائب»: the store's tax rates. The owner adds a rate (its percentage is fixed once made),
 * renames or hides it, archives it, and chooses the one a new product starts with; each product
 * picks its own on its card. Whether shelf prices include tax stays in «العملة وسعر الصرف».
 */
export function TaxRatesPage() {
  const me = useMe();
  const canEdit = me.user.permissions.includes('settings.manage');
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [defaultBp, setDefaultBp] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ rate: TaxRate | null } | null>(null);

  const load = useCallback(() => {
    setError(null);
    listRates()
      .then((r) => {
        setRates(r.items);
        setDefaultBp(r.defaultRateBp ?? 0);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const live = (rates ?? []).filter((r) => !r.archivedAt);
  // The default is a percentage: the first live rate with it stands for it
  const defaultRate = defaultBp > 0 ? live.find((r) => r.rateBp === defaultBp) : undefined;

  async function chooseDefault(taxRateId: string) {
    setError(null);
    try {
      const r = await setDefaultRate({ taxRateId: taxRateId || null });
      setRates(r.items);
      setDefaultBp(r.defaultRateBp);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function archive(rate: TaxRate, archived: boolean) {
    setError(null);
    try {
      await updateRate(rate.id, { version: rate.version, archived });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const columns: DataColumn<TaxRate>[] = [
    {
      key: 'name',
      header: 'الضريبة',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
          {r.name}
          {defaultRate?.id === r.id ? <Badge tone="brand">الافتراضية</Badge> : null}
          {r.archivedAt ? <Badge>مؤرشفة</Badge> : null}
        </span>
      ),
    },
    {
      key: 'rate',
      header: 'النسبة',
      numeric: true,
      cell: (r) => <span className="num">{percentText(r.rateBp)}%</span>,
    },
    { key: 'kind', header: 'النوع', cell: (r) => KIND_TEXT[r.kind] },
    { key: 'receipt', header: 'على الإيصال', cell: (r) => (r.showOnReceipt ? 'تظهر' : 'مخفية') },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">إجراءات</span>,
            cell: (r: TaxRate) => (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDialog({ rate: r })}>
                  عدّل
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void archive(r, !r.archivedAt)}>
                  {r.archivedAt ? 'أعدها' : 'أرشف'}
                </Button>
              </span>
            ),
          } satisfies DataColumn<TaxRate>,
        ]
      : []),
  ];

  return (
    <ReportScreen me={me} access={['settings.manage', 'catalog.manage']} title="الضرائب">
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الضرائب"
          description="نسب الضريبة التي تختار منها لكل منتج. الحساب والقيد كما هما: هذه الصفحة تسمّي النسب فقط."
          icon={<PercentIcon />}
          actions={
            canEdit ? (
              <Button icon={<AddIcon />} onClick={() => setDialog({ rate: null })}>
                ضريبة جديدة
              </Button>
            ) : undefined
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!canEdit ? <Alert tone="info">النسب يضيفها المالك ويعدّلها.</Alert> : null}
        <Alert tone="info">
          {me.settings.taxInclusive
            ? 'أسعار الرفوف عندك تشمل الضريبة: الضريبة جزء من السعر ولا تُضاف فوقه.'
            : 'أسعار الرفوف عندك لا تشمل الضريبة: تُضاف الضريبة فوق السعر.'}{' '}
          <Link to="/settings#store-currency" className="font-semibold underline underline-offset-4">
            غيّر ذلك من إعدادات المتجر
          </Link>
          .
        </Alert>
        {canEdit && live.length > 0 ? (
          <Select
            label="الضريبة الافتراضية للمنتج الجديد"
            value={defaultRate?.id ?? ''}
            onChange={(e) => void chooseDefault(e.target.value)}
            className="sm:w-80"
            hint="يبدأ بها كل منتج جديد، وتغيّرها على بطاقة المنتج."
          >
            <option value="">بلا ضريبة</option>
            {live.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({percentText(r.rateBp)}%)
              </option>
            ))}
          </Select>
        ) : null}
        <DataTable
          caption="نسب الضريبة"
          columns={columns}
          rows={rates ?? []}
          rowKey={(r) => r.id}
          loading={rates === null && !error}
          empty={
            <EmptyState
              icon={PercentIcon}
              title="لا ضرائب بعد"
              description={
                canEdit
                  ? 'أضف نسبة، مثل «ضريبة مبيعات 5%»، لتظهر في بطاقة المنتج.'
                  : 'لم يضف المالك نسب ضريبة بعد.'
              }
            />
          }
        />
      </div>
      {dialog ? (
        <RateDialog
          rate={dialog.rate}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      ) : null}
    </ReportScreen>
  );
}

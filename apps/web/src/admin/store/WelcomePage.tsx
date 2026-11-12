import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ONBOARDING_STEPS, type SectorKey, type StoreResponse } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  CheckIcon,
  cn,
  DeviceIcon,
  ExpandIcon,
  IconChip,
  KeyIcon,
  ProductsIcon,
  Skeleton,
  SkeletonText,
  type Icon,
} from '@serva/ui';
import { useAuth } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getStore, saveOnboarding, saveProfile } from './api';
import { CardBar } from './parts';
import { CurrencyForm, ProfileForm, SectorPicker } from './StoreForms';

const TITLES = ['شو بتشتغل؟', 'معلومات محلّك', 'العملة والأسعار', 'جاهز تبدأ'];

/** Each step's short name in the step list, and the line under its title. */
const STEPS: readonly { label: string; description: string }[] = [
  { label: 'النشاط', description: 'نجهّز لك البرنامج على قدّ نشاطك. تغيّره متى شئت من الإعدادات.' },
  { label: 'المحل', description: 'كما يُطبع في رأس الفاتورة. تراه في المعاينة وأنت تكتب.' },
  {
    label: 'العملة',
    description: 'الليرة أساس الحسابات والتقارير، والدولار إن كنت تبيع به أو تقبضه.',
  },
  { label: 'البداية', description: 'محلّك جاهز. هذا ما تحتاجه لأول بيع:' },
];

/**
 * Where the owner is in the wizard (kit cashier/DeviceLink › الخطوات): a numbered circle per step
 * joined by a line, ticked once done, the current one ringed in the brand colour. On a phone only
 * the current step keeps its name on screen.
 */
function WizardSteps({ current }: { current: number }) {
  return (
    <ol aria-label="خطوات الإعداد" className="flex items-center gap-3">
      {STEPS.map((item, index) => {
        const done = index < current;
        const now = index === current;
        return (
          <li
            key={item.label}
            aria-current={now ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-center gap-3 last:flex-none"
          >
            <span
              className={cn(
                'num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors duration-200 ease-standard',
                done && 'bg-brand text-on-brand',
                now && 'bg-brand-soft text-brand-ink ring-2 ring-brand',
                !done && !now && 'bg-surface text-ink-muted ring-1 ring-line-control/50',
              )}
            >
              {done ? <CheckIcon size={16} strokeWidth={3} /> : index + 1}
            </span>
            <span
              className={cn(
                'text-sm font-semibold whitespace-nowrap',
                now ? 'text-ink' : done ? 'text-brand-ink' : 'text-ink-muted',
                !now && 'max-sm:sr-only',
              )}
            >
              {item.label}
              {done ? <span className="sr-only"> (تمّت)</span> : null}
            </span>
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn('h-0.5 min-w-4 flex-1 rounded-full', done ? 'bg-brand' : 'bg-line')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The wizard's frame while the store loads: the step list and a card of grey lines. */
function WizardLoading() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <span className="sr-only">نجهّز معالج البداية…</span>
      <Skeleton className="h-8 w-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Card>
        <SkeletonText lines={5} />
      </Card>
    </div>
  );
}

/**
 * The start wizard (04 › معالج البداية): four steps right after the account is opened, each one
 * skippable, resumed where the owner left it, and never shown again once finished. Everything in
 * it is changed later from «إعدادات المتجر».
 */
export function WelcomePage() {
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState<SectorKey[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getStore()
      .then((s) => {
        if (!alive) return;
        setStore(s);
        setSectors(s.sectors);
        setStep(Math.min(s.onboarding.step, ONBOARDING_STEPS - 1));
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  async function go(next: number) {
    setError(null);
    try {
      setStore(await saveOnboarding({ step: next }));
      setStep(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await saveOnboarding({ step: ONBOARDING_STEPS, done: true });
      await refreshMe();
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function saveSectors() {
    if (!store) return;
    if (sectors.length === 0) {
      setError('اختر نشاطاً واحداً على الأقل، أو اضغط «تخطَّ».');
      return;
    }
    setBusy(true);
    try {
      setStore(await saveProfile({ name: store.name, sectors }));
      await go(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!store) {
    return (
      <AppShell>
        <title>أهلاً بك · SERFA</title>
        {error ? (
          <div className="mx-auto w-full max-w-4xl">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : (
          <WizardLoading />
        )}
      </AppShell>
    );
  }

  const skip = (next: number) => (
    <Button variant="ghost" onClick={() => void go(next)}>
      تخطَّ هذه الخطوة
    </Button>
  );

  return (
    <AppShell>
      <title>أهلاً بك · SERFA</title>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-8">
          <WizardSteps current={step} />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-brand-ink">
              الخطوة <span className="num">{step + 1}</span> من{' '}
              <span className="num">{ONBOARDING_STEPS}</span>
            </p>
            <h1 className="text-3xl font-bold text-ink">{TITLES[step]}</h1>
            <p className="text-ink-muted">{STEPS[step]?.description}</p>
          </div>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 0 ? (
          <Card>
            <SectorPicker variant="cards" value={sectors} onChange={setSectors} />
            <CardBar>
              <p className="me-auto text-sm text-ink-muted max-sm:w-full">
                اختر كل ما ينطبق على محلّك، ولو كان أكثر من نشاط.
              </p>
              <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col-reverse max-sm:*:w-full">
                <Button variant="ghost" onClick={() => void go(1)}>
                  تخطَّ
                </Button>
                <Button onClick={() => void saveSectors()} loading={busy}>
                  التالي
                </Button>
              </div>
            </CardBar>
          </Card>
        ) : null}

        {step === 1 ? (
          <ProfileForm
            store={store}
            showSectors={false}
            submitLabel="احفظ وتابع"
            secondaryAction={skip(2)}
            onSaved={(s) => {
              setStore(s);
              void go(2);
            }}
          />
        ) : null}

        {step === 2 ? (
          <CurrencyForm
            store={store}
            submitLabel="احفظ وتابع"
            secondaryAction={skip(3)}
            onSaved={(s) => {
              setStore(s);
              void go(3);
            }}
          />
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-6">
            <ul className="grid gap-4 md:grid-cols-3">
              <NextStep
                icon={ProductsIcon}
                to="/products"
                title="أضف أصنافك"
                text="بالاسم والسعر والباركود"
              />
              <NextStep icon={KeyIcon} to="/me/pin" title="اختر رمز الدخول للكاشير" text="4 أو 6 أرقام" />
              <NextStep
                icon={DeviceIcon}
                to="/devices"
                title="اربط جهاز الكاشير"
                text="جوال أو تابلت أو كمبيوتر على نفس الشبكة"
              />
            </ul>
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <IconChip tone="success">
                  <CheckIcon />
                </IconChip>
                <p className="text-ink">تقدر تبدأ البيع الآن، وترجع لهذه الخطوات متى شئت.</p>
              </div>
              <Button size="lg" onClick={() => void finish()} loading={busy} className="max-sm:w-full">
                ابدأ العمل
              </Button>
            </Card>
          </div>
        ) : null}

        {step < 3 ? (
          <Button variant="ghost" size="sm" className="self-center" onClick={() => void finish()}>
            لاحقاً، خذني إلى الرئيسية
          </Button>
        ) : null}
      </div>
    </AppShell>
  );
}

/** One thing to do before the first sale: a card that leads to its page. */
function NextStep({
  icon: StepIcon,
  to,
  title,
  text,
}: {
  icon: Icon;
  to: string;
  title: string;
  text: string;
}) {
  return (
    <li className="flex">
      <Link
        to={to}
        className="group/next flex w-full flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1 transition-[box-shadow,border-color,translate] duration-120 ease-standard hover:border-line-control/50 hover:shadow-e2 motion-safe:hover:-translate-y-0.5 sm:p-6"
      >
        <span className="flex items-center justify-between gap-3">
          <IconChip size="lg">
            <StepIcon size={24} />
          </IconChip>
          {/* A chevron toward the reading end: down, turned a quarter toward it. */}
          <ExpandIcon className="-rotate-90 text-ink-subtle transition-colors duration-120 ease-standard group-hover/next:text-brand-ink rtl:rotate-90" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="font-semibold text-ink">{title}</span>
          <span className="text-sm text-ink-muted">{text}</span>
        </span>
      </Link>
    </li>
  );
}

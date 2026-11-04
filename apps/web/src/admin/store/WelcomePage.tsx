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
  FullScreenLoader,
  KeyIcon,
  ProductsIcon,
  ProgressBar,
  SparklesIcon,
  type Icon,
} from '@serva/ui';
import { useAuth } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getStore, saveOnboarding, saveProfile } from './api';
import { CurrencyForm, ProfileForm, SectorPicker } from './StoreForms';

const TITLES = ['شو بتشتغل؟', 'معلومات محلّك', 'العملة والأسعار', 'جاهز تبدأ'];

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
    return error ? (
      <AppShell>
        <Alert tone="error">{error}</Alert>
      </AppShell>
    ) : (
      <FullScreenLoader />
    );
  }

  return (
    <AppShell>
      <title>أهلاً بك · Serva POS</title>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
              <SparklesIcon />
            </span>
            <p className="text-sm font-semibold text-ink-muted">
              الخطوة <span className="num">{step + 1}</span> من{' '}
              <span className="num">{ONBOARDING_STEPS}</span>
            </p>
          </div>
          <ol aria-hidden="true" className="grid grid-cols-4 gap-2">
            {TITLES.map((title, i) => (
              <li key={title} className="flex flex-col items-center gap-1.5 text-center">
                <span
                  className={cn(
                    'grid size-8 place-items-center rounded-full text-sm font-bold',
                    i < step && 'bg-brand text-on-brand',
                    i === step && 'bg-brand-soft text-brand-ink ring-2 ring-brand',
                    i > step && 'bg-surface-muted text-ink-muted',
                  )}
                >
                  {i < step ? <CheckIcon size={16} /> : <span className="num">{i + 1}</span>}
                </span>
                <span
                  className={cn(
                    'hidden text-xs sm:block',
                    i === step ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {title}
                </span>
              </li>
            ))}
          </ol>
          <ProgressBar
            label="تقدّم الإعداد"
            value={step + 1}
            max={ONBOARDING_STEPS}
            valueText={`الخطوة ${step + 1} من ${ONBOARDING_STEPS}`}
          />
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{TITLES[step]}</h1>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 0 ? (
          <Card className="flex flex-col gap-5">
            <SectorPicker value={sectors} onChange={setSectors} />
            <p className="text-sm text-ink-muted">
              نجهّز لك البرنامج على قدّ نشاطك. تغيّره متى شئت من الإعدادات.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => void saveSectors()} loading={busy}>
                التالي
              </Button>
              <Button size="lg" variant="ghost" onClick={() => void go(1)}>
                تخطَّ
              </Button>
            </div>
          </Card>
        ) : null}

        {step === 1 ? (
          <>
            <ProfileForm
              store={store}
              showSectors={false}
              submitLabel="احفظ وتابع"
              onSaved={(s) => {
                setStore(s);
                void go(2);
              }}
            />
            <Button variant="ghost" onClick={() => void go(2)}>
              تخطَّ هذه الخطوة
            </Button>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <CurrencyForm
              store={store}
              submitLabel="احفظ وتابع"
              onSaved={(s) => {
                setStore(s);
                void go(3);
              }}
            />
            <Button variant="ghost" onClick={() => void go(3)}>
              تخطَّ هذه الخطوة
            </Button>
          </>
        ) : null}

        {step === 3 ? (
          <Card className="flex flex-col gap-4">
            <p className="text-ink">محلّك جاهز. هذا ما تحتاجه لأول بيع:</p>
            <ul className="flex flex-col gap-3">
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
            <Button size="lg" onClick={() => void finish()} loading={busy}>
              ابدأ العمل
            </Button>
          </Card>
        ) : null}

        {step < 3 ? (
          <button
            type="button"
            className="self-center text-sm text-ink-muted underline underline-offset-4"
            onClick={() => void finish()}
          >
            لاحقاً، خذني إلى الرئيسية
          </button>
        ) : null}
      </div>
    </AppShell>
  );
}

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
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-e1 transition-[border-color,box-shadow] hover:border-line-control hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
          <StepIcon />
        </span>
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{title}</span>
          <span className="text-sm text-ink-muted">{text}</span>
        </span>
      </Link>
    </li>
  );
}

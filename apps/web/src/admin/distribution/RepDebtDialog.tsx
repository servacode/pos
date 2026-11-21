import { useEffect, useState } from 'react';
import { getCurrency, REP_DEBT_KIND_LABELS, type RepDebt } from '@serva/core';
import { Alert, Badge, Button, Dialog, Money, Skeleton, TextField, type BadgeTone } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { forgiveRepDebt, getRepDebt, payRepDebt } from './api';
import { FormFooter } from './parts';

const KIND_TONE: Record<string, BadgeTone> = { shortage: 'danger', payment: 'success', forgiven: 'warning' };

/** «1,250.50» → minor units of the base currency; null when it is not an amount above zero */
function minorOf(text: string, decimals: number): number | null {
  const clean = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '')
    .replace('٫', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 10 ** decimals);
  return minor > 0 ? minor : null;
}

/**
 * «ذمة المندوب» (round 35, D6): what a rep owes the shop after a cash shortage at his evening settlement, how
 * it came about, and the two ways it ends: he pays it into the safe, or the owner forgives it (it goes back
 * to being the shop's loss).
 */
export function RepDebtDialog({
  repId,
  repName,
  onClose,
  onChanged,
}: {
  repId: string;
  repName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const decimals = getCurrency(base).decimals;
  const canForgive = me.user.permissions.includes('accounting.post');
  const [debt, setDebt] = useState<RepDebt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [way, setWay] = useState<'pay' | 'forgive' | null>(null);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRepDebt(repId)
      .then(setDebt)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [repId]);

  async function save() {
    if (!debt || !way) return;
    const minor = minorOf(amount, decimals);
    if (minor === null) {
      setError('اكتب مبلغاً أكبر من صفر.');
      return;
    }
    if (minor > debt.balanceMinor) {
      setError('المبلغ أكبر من ذمة المندوب.');
      return;
    }
    if (way === 'forgive' && text.trim().length < 2) {
      setError('اكتب سبب الإعفاء.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next =
        way === 'pay'
          ? await payRepDebt(repId, { amountMinor: minor, note: text.trim() || null })
          : await forgiveRepDebt(repId, { amountMinor: minor, reason: text.trim() });
      setDebt(next);
      setWay(null);
      setAmount('');
      setText('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      size="md"
      title={`ذمة ${repName}`}
      description="ما عليه للمحل من عجز في الصندوق عند تسويته."
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!debt && !error ? <Skeleton className="h-24 w-full" /> : null}
        {debt ? (
          <>
            <div className="flex items-baseline justify-between gap-3 rounded-control bg-surface-muted p-4">
              <span className="text-sm text-ink-muted">عليه الآن</span>
              <span className="text-xl font-bold text-ink">
                <Money minor={debt.balanceMinor} currency={base} />
              </span>
            </div>
            {debt.entries.length === 0 ? (
              <p className="text-sm text-ink-muted">لا حركة على ذمته بعد.</p>
            ) : (
              <ul aria-label="حركة الذمة" className="flex flex-col divide-y divide-line">
                {debt.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                    <Badge tone={KIND_TONE[e.kind] ?? 'neutral'}>{REP_DEBT_KIND_LABELS[e.kind]}</Badge>
                    <span className="flex min-w-0 flex-1 flex-col text-ink-muted">
                      <bdi className="num">{e.date}</bdi>
                      <bdi className="num text-xs">{e.number}</bdi>
                    </span>
                    <Money minor={e.amountMinor} currency={base} />
                  </li>
                ))}
              </ul>
            )}
            {debt.balanceMinor > 0 && !way ? (
              <FormFooter>
                {canForgive ? (
                  <Button variant="ghost" onClick={() => setWay('forgive')}>
                    أعفِه
                  </Button>
                ) : null}
                <Button onClick={() => setWay('pay')}>سدّد المندوب</Button>
              </FormFooter>
            ) : null}
            {way ? (
              <form
                aria-label={way === 'pay' ? 'سداد الذمة' : 'إعفاء من الذمة'}
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <TextField
                  label="المبلغ"
                  inputMode="decimal"
                  dir="ltr"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  hint={`حتى ${debt.balanceMinor / 10 ** decimals}`}
                />
                <TextField
                  label={way === 'pay' ? 'ملاحظة' : 'سبب الإعفاء'}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 200))}
                />
                <p className="text-xs text-ink-muted">
                  {way === 'pay'
                    ? 'يدخل المبلغ نقداً إلى الخزنة وينزل من ذمته.'
                    : 'يصير المبلغ خسارة على المحل ولا يُسترجع من المندوب.'}
                </p>
                <FormFooter>
                  <Button variant="secondary" onClick={() => setWay(null)} disabled={saving}>
                    تراجع
                  </Button>
                  <Button type="submit" loading={saving} variant={way === 'forgive' ? 'danger' : 'primary'}>
                    {way === 'pay' ? 'سجّل السداد' : 'أعفِه'}
                  </Button>
                </FormFooter>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

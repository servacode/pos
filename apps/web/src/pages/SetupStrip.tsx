import { Link } from 'react-router';
import type { MeResponse } from '@serva/core';
import { CheckIcon, cn, NextIcon } from '@serva/ui';
import { listDevices } from '../admin/devices/api';
import { listStaff } from '../admin/staff/api';
import { useReport } from '../admin/reports/useReport';
import { formatNumber } from '../lib/format';
import type { HomeSummary } from './homeSummary';

/**
 * «أكمل الإعداد 1 من 4» (round 48): the wizard's four first tasks stay on the home page of a store
 * that has not sold yet, so pressing «ابدأ العمل» does not lose them. Each task is read from what
 * exists (goods, the signed-in person's till code, an approved device, a first invoice); a task that
 * cannot be read counts as not done. It is for the one who may change the settings, and it goes away
 * by itself when the four are done.
 */
export function SetupStrip({ me, summary }: { me: MeResponse; summary: HomeSummary }) {
  const owner = me.user.permissions.includes('settings.manage');
  const open = owner && !summary.hasEverSold;
  const pin = useReport(open ? 'setup:pin' : null, async () =>
    (await listStaff()).staff.some((member) => member.id === me.user.id && member.hasPin),
  );
  const device = useReport(open ? 'setup:device' : null, async () =>
    (await listDevices()).devices.some((d) => d.status === 'active'),
  );
  if (!open) return null;

  const tasks = [
    { to: '/products', label: 'أضف أصنافك', done: (summary.photos?.goodsCount ?? 0) > 0 },
    { to: '/me/pin', label: 'اختر رمز الكاشير', done: pin.data === true },
    { to: '/devices', label: 'اربط جهاز الكاشير', done: device.data === true },
    { to: '/pos', label: 'أول عملية بيع', done: false },
  ];
  const doneCount = tasks.filter((task) => task.done).length;
  const digits = me.settings.numberFormat;
  // «بقيت 4 خطوات», not «0 من 4»: a store that just finished the wizard is not at zero
  const remaining = tasks.length - doneCount;
  const left =
    remaining === 1 ? (
      'بقيت خطوة واحدة'
    ) : remaining === 2 ? (
      'بقيت خطوتان'
    ) : (
      <>
        بقيت <span className="num">{formatNumber(remaining, digits)}</span> خطوات
      </>
    );

  return (
    <section
      aria-label="أكمل الإعداد"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-brand/20 bg-brand-soft px-4 py-3 text-brand-ink"
    >
      {/* On a phone the four tasks are one line that opens the wizard, not a third of the first screen */}
      <Link
        to="/welcome"
        className="flex min-h-9 flex-1 items-center justify-between gap-2 font-semibold sm:hidden"
      >
        <span>أكمل الإعداد: {left}</span>
        <NextIcon size={16} />
      </Link>
      <p className="font-semibold max-sm:hidden">أكمل الإعداد: {left}</p>
      <ul className="flex flex-1 flex-wrap gap-2 max-sm:hidden">
        {tasks.map((task) => (
          <li key={task.to}>
            <Link
              to={task.to}
              reloadDocument={task.to === '/pos'}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface/80 px-3 text-sm font-semibold hover:bg-surface pointer-coarse:min-h-12',
                task.done && 'opacity-70',
              )}
            >
              {task.done ? <CheckIcon size={16} /> : null}
              {task.label}
              {task.done ? <span className="sr-only"> (تم)</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

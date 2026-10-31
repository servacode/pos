import { useState } from 'react';
import { cn, EmptyState, initialsOf, UserIcon } from '@serva/ui';
import { usePos } from '../services';
import { PinScreen, type PinStatus } from '../PinScreen';
import { checkCode, type CodeCheck, type StaffMember, type StaffSession } from './staff';

export const NEVER_ONLINE_TEXT =
  'لم تدخل على هذا الجهاز من قبل. أول دخول يحتاج الإنترنت، وبعده يفتح دون إنترنت.';
export const REFUSED_TEXT = 'هذا الاسم لا يدخل على هذا الجهاز. اطلب من المدير مراجعة دورك في الفرع.';

/** What the pad shows after a code was checked. */
export function statusOf(result: Exclude<CodeCheck, { ok: true }>): PinStatus {
  switch (result.reason) {
    case 'wrong':
      return result.lockedUntil > 0
        ? { kind: 'locked', until: result.lockedUntil }
        : { kind: 'wrong', failures: result.failures };
    case 'locked':
      return { kind: 'locked', until: result.lockedUntil };
    case 'never_online':
      return { kind: 'message', text: NEVER_ONLINE_TEXT };
    case 'refused':
      return { kind: 'message', text: REFUSED_TEXT };
  }
}

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  return hour >= 4 && hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

/**
 * «من يعمل الآن؟» (kit cashier/Login): the branch's staff as cards, then the code pad of the one
 * picked. The first sign-in of a person on a device is online; after it the device checks the code
 * itself (contract Q1).
 */
export function StaffSignIn({
  staff,
  onSignedIn,
}: {
  staff: readonly StaffMember[];
  onSignedIn: (session: StaffSession) => void;
}) {
  const pos = usePos();
  const [picked, setPicked] = useState<StaffMember | null>(staff.length === 1 ? staff[0]! : null);
  const [status, setStatus] = useState<PinStatus>({ kind: 'idle' });

  if (staff.length === 0) {
    return (
      <EmptyState
        icon={UserIcon}
        title="لا أسماء موظفين على هذا الجهاز بعد"
        description="تصل أسماء الموظفين ورموز دخولهم مع أول اتصال بالإنترنت. إن طال الانتظار، اطلب من المالك أن يضع رمز دخول لكل موظف."
      />
    );
  }

  async function submit(pin: string) {
    if (!picked) return;
    setStatus({ kind: 'checking' });
    const result = await checkCode(
      {
        local: pos.local,
        token: pos.device.token,
        online: pos.online(),
        now: pos.now,
        fetch: pos.fetch,
      },
      picked,
      pin,
    );
    if (result.ok) {
      setStatus({ kind: 'idle' });
      onSignedIn(result.session);
    } else {
      setStatus(statusOf(result));
    }
  }

  return (
    <div className="grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)] items-center gap-8 xl:gap-14">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-brand-ink">{greeting(pos.now())}</span>
          <h1 className="text-3xl/[44px] font-bold text-ink">من يعمل الآن؟</h1>
          <p className="text-ink-muted">اختر اسمك ثم اكتب رمز الدخول.</p>
        </div>
        <ul aria-label="الموظفون" className="grid grid-cols-3 gap-3.5">
          {staff.map((member) => {
            const selected = picked?.id === member.id;
            return (
              <li key={member.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setPicked(member);
                    setStatus({ kind: 'idle' });
                  }}
                  className={cn(
                    'flex w-full flex-col items-center gap-2 rounded-card border bg-surface px-3 py-4 text-center shadow-e1 transition-colors duration-120',
                    selected
                      ? 'border-2 border-brand bg-brand-soft'
                      : 'border-line hover:border-line-control',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-16 place-items-center rounded-full bg-brand text-2xl font-bold text-on-brand"
                  >
                    {initialsOf(member.fullName)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-lg font-semibold text-ink">{member.fullName}</span>
                    <span className="text-xs text-ink-muted">{member.roleNames.join('، ')}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {picked ? (
        <PinScreen
          key={picked.id}
          avatar={
            <span
              aria-hidden="true"
              className="grid size-16 place-items-center rounded-full bg-brand text-2xl font-bold text-on-brand"
            >
              {initialsOf(picked.fullName)}
            </span>
          }
          heading={`أهلاً ${picked.fullName}`}
          subheading={`اكتب رمز الدخول من ${picked.pinLength} أرقام`}
          length={picked.pinLength}
          onComplete={submit}
          status={status}
        />
      ) : (
        <div className="grid min-h-80 place-items-center rounded-[1.75rem] border border-dashed border-line-control p-8 text-center text-ink-muted">
          اختر اسمك من القائمة لتكتب رمز الدخول.
        </div>
      )}
    </div>
  );
}

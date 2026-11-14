import { useState } from 'react';
import {
  Badge,
  CheckIcon,
  cn,
  EmptyState,
  initialsOf,
  LockIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@serva/ui';
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

const MORNING = 'صباح الخير';

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  return hour >= 4 && hour < 12 ? MORNING : 'مساء الخير';
}

/** A person's initials in a 64 circle: soft, then the brand once picked (هوية 4 › Avatar). */
function StaffAvatar({ name, picked }: { name: string; picked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-16 shrink-0 place-items-center rounded-full text-2xl font-bold transition-colors duration-120 ease-standard',
        picked ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-ink',
      )}
    >
      {initialsOf(name)}
    </span>
  );
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
        className="w-full max-w-xl"
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

  const hello = greeting(pos.now());

  return (
    <div className="grid w-full max-w-6xl grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)] xl:gap-14">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col items-start gap-3">
          <Badge tone="brand">
            {hello === MORNING ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            {hello}
          </Badge>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl/tight font-bold text-ink">من يعمل الآن؟</h1>
            <p className="text-lg text-ink-muted">اختر اسمك ثم اكتب رمز الدخول.</p>
          </div>
        </div>
        <ul aria-label="الموظفون" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
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
                    'relative flex w-full flex-col items-center gap-3 rounded-card border bg-surface px-4 pt-6 pb-5 text-center shadow-e1 select-none touch-manipulation',
                    'transition-[border-color,background-color,box-shadow,scale] duration-120 ease-standard motion-safe:active:scale-[0.98]',
                    selected
                      ? 'border-brand bg-brand-soft/40 ring-4 ring-brand/10'
                      : 'border-line hover:border-line-control hover:shadow-e2',
                  )}
                >
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute end-3 top-3 grid size-6 place-items-center rounded-full bg-brand text-on-brand"
                    >
                      <CheckIcon size={16} strokeWidth={3} />
                    </span>
                  ) : null}
                  <StaffAvatar name={member.fullName} picked={selected} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-lg font-semibold text-ink">{member.fullName}</span>
                    <span className="truncate text-sm text-ink-muted">{member.roleNames.join('، ')}</span>
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
          avatar={<StaffAvatar name={picked.fullName} picked />}
          heading={`أهلاً ${picked.fullName}`}
          subheading={`اكتب رمز الدخول من ${picked.pinLength} أرقام`}
          length={picked.pinLength}
          onComplete={submit}
          status={status}
        />
      ) : (
        <EmptyState
          icon={LockIcon}
          title="اختر اسمك من القائمة لتكتب رمز الدخول."
          description="يفتح من هذا الجهاز نفسه، حتى دون إنترنت."
          className="min-h-96 justify-center lg:min-h-150"
        />
      )}
    </div>
  );
}

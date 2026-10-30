// Words the tab-14 glossary bans from anything the user sees («نقول ولا نقول»), with what we say.
// Accounting screens may still name the «ذمم العملاء» account; none exist in the web app yet.
export const BANNED_WORDS: Readonly<Record<string, string>> = {
  عميل: 'زبون',
  عملاء: 'الزبائن',
  مستهلك: 'زبون',
  PIN: 'رمز الدخول',
  مزامنة: 'بانتظار الإرسال / أُرسل',
  متزامن: 'كل شيء أُرسل',
  Sync: 'أُرسل',
  جلسة: 'وردية / انتهى دخولك',
  جلست: 'انتهى دخولك',
  Offline: 'دون إنترنت',
  'كلمة المرور': 'كلمة السر',
  Password: 'كلمة السر',
  'تعذّر الاتصال بالخادم': 'لا يوجد إنترنت الآن',
};

/** Visible text plus the accessible names a screen reader announces. */
export function userFacingText(root: HTMLElement): string {
  const labels = [...root.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? ''),
  );
  return [root.textContent ?? '', ...labels].join('\n');
}

export function bannedWordsIn(text: string): string[] {
  return Object.keys(BANNED_WORDS).filter((word) => text.includes(word));
}

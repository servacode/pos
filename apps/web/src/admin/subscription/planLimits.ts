import type { PlanRow } from '@serva/core';
import { COUNT_NOUNS, countNoun, type CountForms } from '@serva/core';

/** What a plan allows, in the platform's limit keys, as the plan card lists them. */
const LIMITS: readonly { key: string; forms: CountForms; unlimited: string }[] = [
  { key: 'branches', forms: COUNT_NOUNS.branch, unlimited: 'فروع بلا حد' },
  {
    key: 'registers',
    forms: { one: 'جهاز كاشير واحد', two: 'جهازان للكاشير', few: 'أجهزة كاشير', many: 'جهازاً للكاشير' },
    unlimited: 'أجهزة كاشير بلا حد',
  },
  {
    key: 'hallDevices',
    forms: {
      one: 'جهاز واحد للنُدُل والمطبخ',
      two: 'جهازان للنُدُل والمطبخ',
      few: 'أجهزة للنُدُل والمطبخ',
      many: 'جهازاً للنُدُل والمطبخ',
    },
    unlimited: 'أجهزة النُدُل والمطبخ بلا حد',
  },
  { key: 'users', forms: COUNT_NOUNS.user, unlimited: 'مستخدمون بلا حد' },
  { key: 'products', forms: COUNT_NOUNS.item, unlimited: 'أصناف بلا حد' },
];

const count = new Intl.NumberFormat('ar-u-nu-latn');

export function limitLines(plan: PlanRow): string[] {
  return LIMITS.flatMap((limit) => {
    if (!(limit.key in plan.limits)) return [];
    const value = plan.limits[limit.key];
    if (value === null || value === undefined) return [limit.unlimited];
    return [
      value === 1 ? limit.forms.one : `حتى ${countNoun(value, limit.forms, count.format(value), true)}`,
    ];
  });
}

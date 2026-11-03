import type { LocalStore } from '../../offline/local';

const ORDER_NO_KEY = 'orderNo';

/**
 * The next «رقم الطلب» of this till's business day (03 › المقاهي: رقم الطلب والنداء): 1, 2, 3…,
 * back to 1 the next day. Kept on the device, so it counts offline too.
 */
export async function nextOrderNo(local: LocalStore, businessDate: string): Promise<number> {
  const last = await local.get<{ date: string; n: number }>(ORDER_NO_KEY);
  const n = last && last.date === businessDate ? last.n + 1 : 1;
  await local.set(ORDER_NO_KEY, { date: businessDate, n: n > 9999 ? 1 : n });
  return n > 9999 ? 1 : n;
}

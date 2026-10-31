import { toLatinDigits, type DeviceKind, type DevicePlatform } from '@serva/core';

/** What the owner calls each kind of device (12 › الأجهزة). */
export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  cashier: 'جهاز كاشير',
  android_pos: 'كاشير أندرويد بطابعة',
  rep_phone: 'جوال مندوب',
  price_checker: 'اعرف السعر',
  kitchen_screen: 'شاشة المطبخ',
  waiter: 'جوال النادل',
  call_screen: 'شاشة النداء',
};

export const DEVICE_PLATFORM_LABELS: Record<DevicePlatform, string> = {
  browser: 'متصفح',
  windows: 'ويندوز',
  android: 'أندرويد',
  ios: 'آيفون',
};

export function deviceTypeLabel(kind: DeviceKind, platform: DevicePlatform): string {
  return `${DEVICE_KIND_LABELS[kind]} · ${DEVICE_PLATFORM_LABELS[platform]}`;
}

/**
 * The 8-character pairing code as it is typed: Arabic digits become Latin, letters upper case,
 * anything else dropped, and a dash after the fourth character (XXXX-XXXX).
 */
export function formatPairingCode(input: string): string {
  const clean = toLatinDigits(input)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/** The 6-digit store code as it is typed: Latin digits only. */
export function formatStoreCode(input: string): string {
  return toLatinDigits(input).replace(/\D/g, '').slice(0, 6);
}

/** Minutes and seconds left, e.g. «9:05»; «0:00» once past. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const relative = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });
const dayMonth = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' });

/** «الآن», «قبل 5 دقائق», «قبل 3 ساعات», then the date. */
export function formatSince(iso: string, now: number): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'الآن';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return dayMonth.format(new Date(iso));
}

const plural = new Intl.PluralRules('ar');

/** «مستند واحد», «مستندان», «3 مستندات», «11 مستنداً». */
export function documentsCount(count: number): string {
  switch (plural.select(count)) {
    case 'one':
      return 'مستند واحد';
    case 'two':
      return 'مستندان';
    case 'few':
      return `${count} مستندات`;
    case 'many':
      return `${count} مستنداً`;
    default:
      return `${count} مستند`;
  }
}

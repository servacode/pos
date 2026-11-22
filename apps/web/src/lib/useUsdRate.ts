import { useEffect, useState } from 'react';
import { convert, type CurrencyCode } from '@serva/core';
import { getStore } from '../admin/store/api';

/** The dollar's rate today (ل.س for one $), read once per session; null while unknown or when the store has no dollar */
let known: { rate: string | null } | null = null;
let pending: Promise<void> | null = null;

export function useUsdRate(): string | null {
  const [rate, setRate] = useState<string | null>(known?.rate ?? null);
  useEffect(() => {
    if (known) return;
    let alive = true;
    pending ??= getStore().then(
      (s) => {
        known = { rate: s.usdRate };
      },
      () => {
        pending = null;
      },
    );
    void pending.then(() => {
      if (alive && known) setRate(known.rate);
    });
    return () => {
      alive = false;
    };
  }, []);
  return rate;
}

/** A dollar amount in pounds (minor units of ل.س), or null when the rate is unknown */
export function usdToBase(minor: number, base: CurrencyCode, rate: string | null): number | null {
  if (!rate || base === 'USD') return null;
  try {
    return convert(minor, 'USD', base, { unit: 'USD', quote: base, rate });
  } catch {
    return null;
  }
}

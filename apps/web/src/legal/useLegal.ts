import { useEffect, useState } from 'react';
import { legalInput, type PublicLegal } from '@serva/core';
import { apiFetch } from '../lib/api';
import { LEGAL, mergeLegal, type LegalValues } from './config';

export interface LoadedLegal {
  /** loading: the request is out; ready: the platform's details are in; failed: the defaults are shown */
  status: 'loading' | 'ready' | 'failed';
  values: LegalValues;
  /** The details as the platform saved them (null until they load) */
  saved: PublicLegal | null;
}

/**
 * The platform's company and contact details from the public GET /v1/legal. Never throws: while it
 * loads, or when the server cannot be reached or answers something unexpected, the values are the
 * defaults of config.ts, so the page still shows its texts with the placeholders.
 */
export function useLegal(): LoadedLegal {
  const [state, setState] = useState<LoadedLegal>({ status: 'loading', values: LEGAL, saved: null });
  useEffect(() => {
    let live = true;
    apiFetch<unknown>('/v1/legal')
      .then((body) => {
        const parsed = legalInput.safeParse(body);
        if (!parsed.success) throw new Error('unexpected legal details');
        const saved: PublicLegal = { ...parsed.data, version: LEGAL.version };
        if (live) setState({ status: 'ready', values: mergeLegal(saved), saved });
      })
      .catch(() => {
        if (live) setState({ status: 'failed', values: LEGAL, saved: null });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

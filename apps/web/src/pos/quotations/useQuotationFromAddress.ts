import { useEffect } from 'react';
import type { Quotation } from '@serva/core/contracts/quotations';
import { quotationById } from './api';
import type { PosServices } from '../services';

/**
 * «حوّل إلى فاتورة» from the admin opens the till at `/pos?quotation=<id>`: once the till is ready
 * the quotation is fetched and handed to `open`, and the address is cleaned so a refresh does not
 * open it twice. Does nothing without the server.
 */
export function useQuotationFromAddress(
  ready: boolean,
  pos: Pick<PosServices, 'device' | 'online' | 'fetch'>,
  open: (q: Quotation) => void,
): void {
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(window.location.search).get('quotation');
    if (!id) return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete('quotation');
    window.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    if (!pos.device.token || !pos.online()) return;
    let alive = true;
    void quotationById(id, pos.device.token, pos.fetch).then((answer) => {
      if (alive && answer.kind === 'ok') open(answer.body);
    });
    return () => {
      alive = false;
    };
    // Once the till is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

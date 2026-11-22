import { Link } from 'react-router';
import type { MeResponse } from '@serva/core';
import { seesSerialAttention } from '../../pages/SerialAttention';
import { useReport } from '../reports/useReport';
import { getSerialDrift } from './api';

/** One line on the stock page: «N أصناف أرقامها لا تطابق المخزون» linking to the serial page (round 64) */
export function SerialDriftChip({ me }: { me: MeResponse }) {
  const drift = useReport(seesSerialAttention(me) ? 'stock:serial-drift' : null, getSerialDrift);
  const n = drift.data?.items.length ?? 0;
  if (n === 0) return null;
  const more = drift.data?.truncated ? '+' : '';
  return (
    <p className="note" data-testid="stock-serial-drift">
      <bdi className="sx-n">
        {n.toLocaleString('en-US')}
        {more}
      </bdi>{' '}
      {n === 1 ? 'صنف أرقامه التسلسلية لا تطابق المخزون.' : 'أصناف أرقامها التسلسلية لا تطابق المخزون.'}{' '}
      <Link to="/serials" className="sx-linkbtn">
        راجعها
      </Link>
    </p>
  );
}

import { Link } from 'react-router';
import type { InventoryResponse, MeResponse, ProfitReport } from '@serva/core';
import { AlertCircleIcon, formatQuantity, type Digits } from '@serva/ui';
import { Amt } from '../sales/ui';
import { soldOutLabel, soldOutSentence, StockDefinitions } from '../stockWords';
import { negativeNote } from '../../lib/stockCounts';
import { InventoryProfit } from './InventoryProfit';
import { SerialDriftChip } from './SerialDriftChip';
import type { StockFilter } from './inventoryShared';

/** The figures card of the stock page (value, pieces, sold out, valuation note) and the two notes under it. */
export function InventoryHero({
  me,
  stock,
  profit,
  base,
  digits,
  clothing,
  kinds,
  netPieces,
  soldOut,
  soldOutProducts,
  belowZero,
  reorderKinds,
  noCostKinds,
  deadPieces,
  onShowList,
}: {
  me: MeResponse;
  stock: InventoryResponse | null;
  profit: ProfitReport | null;
  base: InventoryResponse['baseCurrency'];
  digits: Digits;
  clothing: boolean;
  kinds: number;
  netPieces: number;
  soldOut: number;
  soldOutProducts: number;
  belowZero: number;
  reorderKinds: number;
  noCostKinds: number;
  deadPieces: number;
  /** A link in the card or under it opens the list with this filter */
  onShowList: (filter: StockFilter) => void;
}) {
  return (
    <>
      <section aria-label="أرقام المخزون" className="sx-card sx-strip ix-hero">
        <div>
          <span className="sx-eyebrow">قيمة المخزون بالكلفة</span>
          <span className="v big">{stock ? <Amt minor={stock.totalValueMinor} currency={base} /> : '…'}</span>
          <span className="note">
            {stock ? (
              <>
                {clothing ? 'المقاسات والألوان' : 'عدد الأصناف'}: <span className="sx-n">{kinds}</span>
              </>
            ) : null}
          </span>
        </div>
        <div>
          <span className="sx-eyebrow">القطع في المخزون</span>
          <span className="v sx-n">{stock ? formatQuantity(netPieces, digits) : '…'}</span>
          <span className="note">
            {belowZero > 0 ? 'الصافي بعد طرح ما نزل تحت الصفر' : 'ما على الرفوف في كل الفروع'}
          </span>
        </div>
        <div>
          <span className="sx-eyebrow">{soldOutLabel(clothing)}</span>
          <span className={`v sx-n${stock && soldOut > 0 ? ' warn' : ''}`}>{stock ? soldOut : '…'}</span>
          <span className="note">
            {stock ? (
              soldOut ? (
                <>
                  {soldOutSentence(soldOut, soldOutProducts, clothing)}
                  {belowZero > 0 ? <span className="block">{negativeNote(belowZero)}</span> : null}{' '}
                  <button type="button" onClick={() => onShowList('low')}>
                    اعرضها
                  </button>
                </>
              ) : (
                'في كل صنف قطع على الرف'
              )
            ) : null}
          </span>
        </div>
        <div className="ix-hero-note">
          <p className="ix-method" role="note">
            <b>طريقة التقييم: المتوسط المرجّح للكلفة.</b>
            <span>كل شراء جديد يدخل في متوسط الكلفة، وما يُباع أو يخرج يُحسب به.</span>
          </p>
          {reorderKinds > 0 ? (
            <p className="note">
              <bdi className="sx-n">{reorderKinds.toLocaleString('en-US')}</bdi> من الأصناف عند حد الطلب أو
              تحته.{' '}
              <button type="button" className="sx-linkbtn" onClick={() => onShowList('reorder')}>
                اعرضها
              </button>
            </p>
          ) : null}
          <SerialDriftChip me={me} />
          <InventoryProfit profit={profit} base={base} digits={digits} />
          <div className="ix-defs">
            <StockDefinitions />
          </div>
        </div>
      </section>
      {noCostKinds > 0 ? (
        <p className="ix-warn" role="note">
          <AlertCircleIcon size={20} />
          <span>
            {noCostKinds.toLocaleString('en-US')} من الأصناف لا كلفة مسجّلة لها، فقيمة المخزون والهامش أقل من
            الحقيقة.{' '}
            <button type="button" onClick={() => onShowList('nocost')}>
              اعرض الأصناف بلا كلفة
            </button>
          </span>
        </p>
      ) : null}
      {deadPieces > 0 ? (
        <p className="sx-note tight" style={{ margin: 0, padding: 0, border: 0 }}>
          منها <bdi className="sx-n">{formatQuantity(deadPieces, digits)}</bdi> قطعة منتهية أو موقوفة لا
          تُباع.{' '}
          <Link to="/expiry" className="sx-linkbtn">
            اعرضها في الصلاحية
          </Link>
        </p>
      ) : null}
    </>
  );
}

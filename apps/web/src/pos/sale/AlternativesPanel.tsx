import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  CheckIcon,
  CloseIcon,
  formatQuantity,
  Money,
  SearchIcon,
  useDigits,
} from '@serva/ui';
import type { Catalog, CatalogItem } from '../catalog';
import { usePos } from '../services';
import { alternativesFor } from './alternatives';
import { SalePanel } from './SalePanel';
import { askShortage } from './shortages';

/** «500 ملغ · أقراص»: what tells one medicine from another of the same ingredient */
const detail = (item: Pick<CatalogItem, 'strength' | 'dosageForm'>) =>
  [item.strength, item.dosageForm].filter(Boolean).join(' · ');

/**
 * «بدائل متوفرة» (round 38, pharmacy): the same active ingredient, strength and form, in stock now, with the
 * price, cheapest first; one tap puts it in the cart. «طلبو زبون وما كان موجود» writes the item on the
 * shortages list (kept on the device and sent when there is a connection).
 */
export function AlternativesPanel({
  source,
  catalog,
  today,
  onPick,
  onClose,
}: {
  source: CatalogItem;
  catalog: Pick<Catalog, 'items'>;
  today: string;
  onPick: (item: CatalogItem) => void;
  onClose: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const [asked, setAsked] = useState<'sent' | 'queued' | null>(null);
  const [busy, setBusy] = useState(false);
  const found = alternativesFor(source, catalog, today);
  const same = [source.genericName, detail(source)].filter(Boolean).join(' · ');

  async function ask() {
    setBusy(true);
    try {
      setAsked(await askShortage(pos, { variantId: source.variantId, name: source.name, qty: 1000 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SalePanel
      label="بدائل متوفرة"
      title="بدائل متوفرة"
      subtitle={source.genericName ? `«${source.name}»: ${same}` : `«${source.name}»`}
      icon={<SearchIcon size={20} />}
      actions={
        <Button variant="secondary" size="md" icon={<CloseIcon size={20} />} onClick={onClose}>
          أغلق
        </Button>
      }
    >
      {!source.genericName ? (
        <Alert tone="info">
          لم يُكتب الاسم العلمي لهذا الدواء، فلا بدائل له. يكتبه صاحب المحل في صفحة المنتج.
        </Alert>
      ) : found.length === 0 ? (
        <Alert tone="warning">لا بديل متوفر الآن بنفس المادة الفعالة والتركيز والشكل.</Alert>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="البدائل">
          {found.map(({ item, available }) => (
            <li key={item.variantId}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="flex min-h-14 w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-semibold text-ink">{item.name}</span>
                  <span className="text-sm text-ink-muted">{detail(item) || 'نفس المادة'}</span>
                </span>
                <Badge tone="success">
                  <bdi className="num">{formatQuantity(available, digits)}</bdi> متوفر
                </Badge>
                <Money minor={item.price.priceMinor} currency={item.price.currency} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {asked ? (
          <Alert tone="success">
            {asked === 'sent'
              ? 'سُجّل في النواقص.'
              : 'سُجّل على هذا الجهاز وسيُرسل إلى النواقص عند عودة الاتصال.'}
          </Alert>
        ) : (
          <Button
            variant="secondary"
            size="md"
            icon={<CheckIcon size={20} />}
            loading={busy}
            onClick={() => void ask()}
          >
            طلبو زبون وما كان موجود
          </Button>
        )}
      </div>
    </SalePanel>
  );
}

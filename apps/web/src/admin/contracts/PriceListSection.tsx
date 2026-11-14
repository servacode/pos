import { useState } from 'react';
import {
  CUSTOMER_KIND_LABELS,
  CUSTOMER_KINDS,
  getCurrency,
  type CustomerKind,
  type CustomerListItem,
  type PriceListSheet,
} from '@serva/core';
import { Alert, Button, Card, DataTable, Money, PrintIcon, Select, type DataColumn } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { downloadCsv } from '../exportCsv';
import { SectionHead } from '../purchases/parts';
import { getPriceListSheet } from './api';

const SOURCE_TEXT: Record<PriceListSheet['rows'][number]['source'], string> = {
  contract: 'سعر عقد',
  wholesale: 'سعر الجملة',
  retail: 'سعر المفرق',
};

/**
 * «قائمة أسعار للطباعة»: every product with the price one customer, or one type of customer, pays
 * today (the contract price in force, else the wholesale price for a wholesale customer, else the
 * shelf price). Printed from the browser or saved as CSV.
 */
export function PriceListSection({ customers }: { customers: CustomerListItem[] }) {
  const [who, setWho] = useState('');
  const [tier, setTier] = useState<'retail' | 'wholesale'>('retail');
  const [sheet, setSheet] = useState<PriceListSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isKind = who.startsWith('k:');

  async function show() {
    if (!who) return;
    setLoading(true);
    setError(null);
    try {
      const [type, value] = who.split(':');
      setSheet(
        await getPriceListSheet(
          type === 'c' ? { customerId: value! } : { kind: value as CustomerKind, tier },
        ),
      );
    } catch (e) {
      setSheet(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!sheet) return;
    const { decimals } = getCurrency(sheet.currency);
    downloadCsv(
      `قائمة-أسعار-${sheet.forName}-${sheet.asOf}`,
      ['الصنف', 'الرمز', `السعر (${sheet.currency})`, 'نوع السعر'],
      sheet.rows.map((r) => [
        r.item,
        r.sku ?? '',
        (r.priceMinor / 10 ** decimals).toFixed(decimals),
        SOURCE_TEXT[r.source],
      ]),
    );
  }

  const columns: DataColumn<PriceListSheet['rows'][number]>[] = [
    { key: 'item', header: 'الصنف', cell: (r) => r.item },
    {
      key: 'sku',
      header: 'الرمز',
      className: 'hidden sm:table-cell',
      cell: (r) => (r.sku ? <bdi className="num">{r.sku}</bdi> : <span className="text-ink-subtle">—</span>),
    },
    {
      key: 'price',
      header: 'السعر',
      numeric: true,
      cell: (r) => <Money minor={r.priceMinor} currency={sheet!.currency} className="font-semibold" />,
    },
    {
      key: 'source',
      header: 'نوع السعر',
      className: 'print:hidden',
      cell: (r) => SOURCE_TEXT[r.source],
    },
  ];

  return (
    <section aria-label="قائمة أسعار للطباعة" className="flex flex-col gap-3">
      <SectionHead
        title="قائمة أسعار للطباعة"
        description="كل الأصناف بالسعر الذي يدفعه زبون أو نوع زبائن اليوم: سعر العقد إن وُجد، ثم الجملة، ثم المفرق."
      />
      <Card className="flex flex-col gap-4 print:hidden">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <Select label="لمن القائمة" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">اختر</option>
            <optgroup label="نوع زبائن">
              {CUSTOMER_KINDS.map((k) => (
                <option key={k} value={`k:${k}`}>
                  كل زبائن النوع: {CUSTOMER_KIND_LABELS[k]}
                </option>
              ))}
            </optgroup>
            <optgroup label="زبون">
              {customers.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </Select>
          {isKind ? (
            <Select
              label="السعر الأساسي"
              value={tier}
              onChange={(e) => setTier(e.target.value as 'retail' | 'wholesale')}
            >
              <option value="retail">المفرق</option>
              <option value="wholesale">الجملة</option>
            </Select>
          ) : (
            <span />
          )}
          <Button type="button" disabled={!who} loading={loading} onClick={() => void show()}>
            اعرض القائمة
          </Button>
        </div>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {sheet ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-ink">
              قائمة أسعار: {sheet.forName} · {dayText(sheet.asOf)}
            </h3>
            <span className="flex gap-2 print:hidden">
              <Button type="button" variant="secondary" icon={<PrintIcon />} onClick={() => window.print()}>
                اطبع
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                حمّل CSV
              </Button>
            </span>
          </div>
          <DataTable
            caption="قائمة الأسعار"
            columns={columns}
            rows={sheet.rows}
            rowKey={(r) => r.variantId}
            empty={<p className="p-4 text-ink-muted">لا أصناف في المحل بعد.</p>}
          />
        </>
      ) : null}
    </section>
  );
}

import { addMonthsIso, serialLabel, warrantyUntilText } from '@serva/core/contracts/warranty';
import type { WarrantyCertificateData } from '../../lib/WarrantyCertificate';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import { businessDateOf } from '@serva/core/sale';

type SaleLine = SalePayload['lines'][number];

/** The day a sale counts on: its device time in the store's zone, after the day's cutoff */
export function soldOnOf(
  deviceTime: string,
  settings: Pick<SettingsRow, 'timezone' | 'businessDayCutoff'>,
): string {
  return businessDateOf(new Date(deviceTime), settings.timezone, settings.businessDayCutoff);
}

/** The numbers of a line's pieces, named «IMEI» for phones and «الرقم التسلسلي» elsewhere */
export function serialText(
  line: Pick<SaleLine, 'serials'>,
  settings: Pick<SettingsRow, 'sectors'>,
): string | null {
  return line.serials?.length ? `${serialLabel(settings.sectors)} ${line.serials.join('، ')}` : null;
}

/** «الكفالة حتى 30/10/2027» for a line sold with a warranty, else null */
export function warrantyText(
  line: Pick<SaleLine, 'serials' | 'warrantyMonths'>,
  deviceTime: string,
  settings: Pick<SettingsRow, 'timezone' | 'businessDayCutoff'>,
): string | null {
  if (!line.serials?.length || !line.warrantyMonths) return null;
  return warrantyUntilText(addMonthsIso(soldOnOf(deviceTime, settings), line.warrantyMonths));
}

/** The certificate of a sale's warranty devices: one row per serial; null when none was sold with a warranty */
export function certificateOf(
  data: {
    doc: { number?: string | null; deviceTime: string; payload: unknown };
    settings: SettingsRow;
    storeName: string;
    branchName: string;
    branch: { phone: string | null } | null;
  },
  customerPhone: string | null,
): WarrantyCertificateData | null {
  const sale = data.doc.payload as SalePayload;
  const soldOn = soldOnOf(data.doc.deviceTime, data.settings);
  const items = sale.lines.flatMap((line) =>
    line.warrantyMonths
      ? (line.serials ?? []).map((serial) => ({
          name: line.name.split(' · ')[0] ?? line.name,
          serial,
          soldOn,
          until: addMonthsIso(soldOn, line.warrantyMonths!),
        }))
      : [],
  );
  if (items.length === 0) return null;
  return {
    storeName: data.storeName,
    branchName: data.branchName,
    storePhone: data.branch?.phone ?? null,
    customerName: sale.customerName ?? null,
    customerPhone,
    saleNumber: data.doc.number ?? null,
    items,
    terms: data.settings.till?.warrantyTerms ?? null,
  };
}

/** The phone of the customer a sale named, from the customers this till pulled */
export function customerPhoneOf(
  catalog: { customers: readonly { id: string; phone: string | null }[] },
  data: { doc: { payload: unknown } },
): string | null {
  const id = (data.doc.payload as SalePayload).customerId;
  return (id ? catalog.customers.find((c) => c.id === id)?.phone : null) ?? null;
}

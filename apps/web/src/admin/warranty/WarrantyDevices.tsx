import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { dmy, type SerialRow } from '@serva/core';
import { Badge, Button, PrintIcon } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { WarrantyCertificate, type WarrantyCertificateData } from '../../lib/WarrantyCertificate';
import { serialsOf } from './api';

/**
 * The devices with a serial number a sale or a customer bought (03 › الإلكترونيات والأدوات الطبية),
 * each with the end of its warranty, a button to open a claim on it (prefilled in «الضمان والصيانة»)
 * and the A4 warranty certificate. Shows nothing when there are none (or the user may not see them).
 */
export function WarrantyDevices({
  by,
  storeName,
  branchName,
  customerName,
  customerPhone,
  heading = 'الأجهزة والكفالة',
}: {
  by: { saleId?: string; customerId?: string };
  storeName: string;
  branchName?: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  heading?: string;
}) {
  const me = useMe();
  const [rows, setRows] = useState<SerialRow[]>([]);
  const [certificate, setCertificate] = useState<WarrantyCertificateData | null>(null);

  useEffect(() => {
    let alive = true;
    serialsOf(by)
      .then((r) => alive && setRows(r.items.filter((s) => s.status === 'sold')))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [by.saleId, by.customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rows.length === 0) return null;

  function print(list: SerialRow[]) {
    setCertificate({
      storeName,
      branchName: branchName ?? null,
      customerName,
      customerPhone: customerPhone ?? null,
      saleNumber: list[0]?.saleNumber ?? null,
      items: list.flatMap((r) =>
        r.soldOn ? [{ name: r.name, serial: r.serial, soldOn: r.soldOn, until: r.warrantyUntil }] : [],
      ),
      terms: me.settings.warrantyTerms ?? null,
    });
    // The certificate is in the page once React has drawn it
    setTimeout(() => window.print(), 0);
  }

  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.serial}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface p-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{r.name}</span>
              <bdi dir="ltr" className="num text-sm text-ink-muted">
                {r.serial}
              </bdi>
              {r.warrantyUntil ? (
                <span className="block text-sm text-ink-muted">
                  الكفالة حتى <span className="num">{dmy(r.warrantyUntil)}</span>
                </span>
              ) : (
                <Badge tone="neutral">بلا كفالة</Badge>
              )}
            </span>
            <Link
              to={`/warranty?serial=${encodeURIComponent(r.serial)}`}
              className="min-h-11 rounded-control border border-line px-4 py-2.5 text-sm font-semibold text-brand-ink hover:bg-surface-muted"
            >
              افتح مطالبة
            </Link>
          </li>
        ))}
      </ul>
      {rows.some((r) => r.warrantyUntil) ? (
        <div>
          <Button
            variant="secondary"
            icon={<PrintIcon />}
            onClick={() => print(rows.filter((r) => r.warrantyUntil))}
          >
            اطبع شهادة الكفالة
          </Button>
        </div>
      ) : null}
      {certificate ? <WarrantyCertificate data={certificate} /> : null}
    </section>
  );
}

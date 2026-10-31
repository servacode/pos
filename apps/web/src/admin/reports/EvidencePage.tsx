import { useEffect, useState } from 'react';
import type { DeviceSummary } from '@serva/core';
import {
  Badge,
  Banner,
  Card,
  DataTable,
  displayNumber,
  EmptyState,
  ShieldCheckIcon,
  StatTile,
  useDigits,
  Select,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { isoDay } from '../../lib/dates';
import { listDevices } from '../devices/api';
import { EVIDENCE_ACCESS } from './access';
import { getEvidence } from './api';
import type { SyncEvidence } from './contracts';
import { seriesLabel } from './labels';
import { DayField, PageHead, ReportError, ReportLoading, ReportScreen, Section } from './parts';
import { useReport } from './useReport';

interface SeriesRow {
  series: string;
  announced: string | null;
  received: string | null;
}

/** Each series the device numbers in, with what it last announced and what last arrived. */
export function seriesRows(evidence: SyncEvidence): SeriesRow[] {
  const series = new Set([
    ...Object.keys(evidence.lastAnnouncedNumber),
    ...Object.keys(evidence.lastReceivedNumber),
  ]);
  return [...series].sort().map((key) => ({
    series: key,
    announced: evidence.lastAnnouncedNumber[key] ?? null,
    received: evidence.lastReceivedNumber[key] ?? null,
  }));
}

/** Nothing missing: every number the device announced has arrived. */
function caughtUp(row: SeriesRow): boolean {
  return row.announced === null || row.announced === row.received;
}

const columns: DataColumn<SeriesRow>[] = [
  {
    key: 'series',
    header: 'السلسلة',
    cell: (row) => <span className="font-semibold">{seriesLabel(row.series)}</span>,
  },
  {
    key: 'announced',
    header: 'آخر رقم أعلنه الجهاز',
    cell: (row) =>
      row.announced ? (
        <bdi dir="ltr" className="num">
          {row.announced}
        </bdi>
      ) : (
        '—'
      ),
  },
  {
    key: 'received',
    header: 'آخر رقم وصل',
    cell: (row) =>
      row.received ? (
        <bdi dir="ltr" className="num">
          {row.received}
        </bdi>
      ) : (
        '—'
      ),
  },
  {
    key: 'state',
    header: 'الحالة',
    cell: (row) =>
      caughtUp(row) ? <Badge tone="success">وصل كله</Badge> : <Badge tone="danger">ناقص</Badge>,
  },
];

function EvidenceBody({ evidence }: { evidence: SyncEvidence }) {
  const digits = useDigits();
  const rows = seriesRows(evidence);
  const missing = rows.filter((row) => !caughtUp(row));
  const n = (value: number) => displayNumber(String(value), digits);
  return (
    <>
      {missing.length === 0 && evidence.rejected === 0 && evidence.quarantined === 0 ? (
        <Banner tone="success">
          صفر مفقود: آخر رقم أعلنه «{evidence.deviceName}» هو آخر رقم وصل، والمكرر لم يُحسب مرتين.
        </Banner>
      ) : (
        <Banner tone="warning">
          {missing.length > 0
            ? `لم يصل كل ما أعلنه «${evidence.deviceName}»: ${missing.map((row) => seriesLabel(row.series)).join('، ')}.`
            : `وصل كل ما أعلنه «${evidence.deviceName}»، وفيه مستندات مرفوضة أو محجوزة للمراجعة.`}
        </Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="أُرسل" value={n(evidence.sent)} />
        <StatTile label="قُبل" value={n(evidence.accepted)} />
        <StatTile label="مكرر" value={n(evidence.duplicate)} footnote="وصل مرة ثانية ولم يُحسب" />
        <StatTile label="رُفض" value={n(evidence.rejected)} />
        <StatTile label="محجوز للمراجعة" value={n(evidence.quarantined)} />
      </div>
      <Section title="آخر رقم أعلنه الجهاز وآخر رقم وصل">
        <DataTable
          caption="آخر رقم أعلنه الجهاز وآخر رقم وصل لكل سلسلة"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.series}
          empty={<p className="px-6 py-8 text-center text-ink-muted">لم يرقّم الجهاز أي مستند بعد.</p>}
        />
      </Section>
    </>
  );
}

/**
 * «شاشة الدليل» (23 › مصفوفة التتبّع وشاشة الدليل): per device and day, in numbers, what the eye
 * cannot see: sent, accepted, duplicate, rejected and held for review, and for each series the last
 * number the device announced against the last one that arrived.
 */
export function EvidencePage() {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [date, setDate] = useState(today);

  useEffect(() => {
    let current = true;
    listDevices().then(
      (answer) => {
        if (!current) return;
        const linked = answer.devices.filter((d) => d.status === 'active' || d.status === 'revoked');
        setDevices(linked);
        setDeviceId((chosen) => chosen ?? linked[0]?.id ?? null);
        setDevicesError(null);
      },
      (error: unknown) => current && setDevicesError(errorMessage(error)),
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  const report = useReport(deviceId ? `${deviceId}|${date}` : null, () =>
    getEvidence({ deviceId: deviceId ?? '', date }),
  );

  return (
    <ReportScreen me={me} access={EVIDENCE_ACCESS} title="شاشة الدليل">
      <PageHead
        crumbs={['المتجر', 'الأجهزة']}
        title="شاشة الدليل"
        subtitle="ما لا تراه بعينك، بالأرقام: هل وصل كل ما باعه الجهاز، مرة واحدة؟"
      />
      {devicesError ? <ReportError message={devicesError} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {devices === null && !devicesError ? <ReportLoading label="نحمّل الأجهزة…" /> : null}
      {devices && devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheckIcon}
            title="لا أجهزة مربوطة بعد."
            description="تظهر هنا أرقام كل جهاز كاشير بعد ربطه وبيعه أول فاتورة."
          />
        </Card>
      ) : null}
      {devices && devices.length > 0 ? (
        <>
          <Card className="flex flex-wrap items-end gap-4">
            <Select
              label="الجهاز"
              value={deviceId ?? ''}
              onChange={(event) => setDeviceId(event.target.value)}
              className="min-w-56"
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.code ? `${device.name} · ${device.code}` : device.name}
                </option>
              ))}
            </Select>
            <DayField label="اليوم" value={date} max={today} onChange={setDate} />
          </Card>
          {report.loading ? <ReportLoading label="نحمّل أرقام الجهاز…" /> : null}
          {report.error ? <ReportError message={report.error} onRetry={report.retry} /> : null}
          {report.data ? <EvidenceBody evidence={report.data} /> : null}
        </>
      ) : null}
    </ReportScreen>
  );
}

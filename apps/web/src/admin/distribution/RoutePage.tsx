import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { CustomerListItem, RouteDetail } from '@serva/core';
import {
  AddIcon,
  Alert,
  BackIcon,
  Badge,
  Button,
  Card,
  CardHeader,
  CloseIcon,
  EmptyState,
  ExpandIcon,
  PageHeader,
  SearchField,
  Skeleton,
  TruckIcon,
} from '@serva/ui';
import { listCustomers } from '../customers/api';
import { errorMessage } from '../../lib/api';
import { getRoute, listRegions, listReps, setRouteCustomers } from './api';
import { useLoad } from './parts';
import { RouteDialog, weekdaysText } from './RoutesPage';

type Entry = { customerId: string; name: string; phone: string | null };

/** One step up (-1) or down (+1) in the order, the list kept as it is when the step falls outside it */
export function move<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const to = index + step;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** «خط السير»: the customers of one route in the order the rep visits them */
export function RoutePage() {
  const { id = '' } = useParams();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [everyone, setEveryone] = useState<CustomerListItem[] | null>(null);
  const regions = useLoad(listRegions);
  const reps = useLoad(listReps);

  function show(detail: RouteDetail) {
    setRoute(detail);
    setEntries(detail.customers.map((c) => ({ customerId: c.customerId, name: c.name, phone: c.phone })));
  }

  useEffect(() => {
    getRoute(id)
      .then(show)
      .catch((e: unknown) => setError(errorMessage(e)));
    listCustomers()
      .then((r) => setEveryone(r.items.filter((c) => !c.archived && c.approvalStatus !== 'rejected')))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  const inRoute = useMemo(() => new Set(entries.map((e) => e.customerId)), [entries]);
  const changed =
    route !== null &&
    (entries.length !== route.customers.length ||
      entries.some((e, i) => e.customerId !== route.customers[i]?.customerId));

  const results = useMemo(() => {
    const word = q.trim();
    return (everyone ?? [])
      .filter((c) => !inRoute.has(c.id))
      .filter((c) => !word || c.name.includes(word) || (c.phone ?? '').includes(word))
      .slice(0, 30);
  }, [everyone, inRoute, q]);

  const ofRegion = useMemo(
    () =>
      (everyone ?? []).filter((c) => route?.regionId && c.regionId === route.regionId && !inRoute.has(c.id)),
    [everyone, inRoute, route?.regionId],
  );

  const add = (list: readonly CustomerListItem[]) =>
    setEntries((current) => [
      ...current,
      ...list.map((c) => ({ customerId: c.id, name: c.name, phone: c.phone })),
    ]);

  async function save() {
    if (!route) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      show(
        await setRouteCustomers(route.id, {
          customerIds: entries.map((e) => e.customerId),
          version: route.version,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!route) {
    return error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-40 w-full" />;
  }

  return (
    <>
      <PageHeader
        title={route.name}
        description={`${weekdaysText(route.weekdays)} · ${route.repName ?? 'بلا مندوب'}${route.regionName ? ` · ${route.regionName}` : ''}`}
        icon={<TruckIcon />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/distribution/routes">
              <Button variant="secondary" icon={<BackIcon />}>
                كل الخطوط
              </Button>
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              عدّل الخط
            </Button>
          </div>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">حُفظ ترتيب الزبائن.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`زبائن الخط (${entries.length})`}
            description="بهذا الترتيب يزورهم المندوب."
            action={
              <Button onClick={() => void save()} loading={saving} disabled={!changed}>
                احفظ الترتيب
              </Button>
            }
          />
          {entries.length === 0 ? (
            <EmptyState icon={TruckIcon} title="الخط فارغ." description="أضف زبائن من القائمة المجاورة." />
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {entries.map((entry, i) => (
                <li key={entry.customerId} className="flex items-center gap-3 py-2">
                  <span className="num text-center text-sm text-ink-muted" style={{ minWidth: '1.75rem' }}>
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{entry.name}</span>
                    {entry.phone ? (
                      <bdi dir="ltr" className="num text-xs text-ink-muted">
                        {entry.phone}
                      </bdi>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`قدّم ${entry.name}`}
                    disabled={i === 0}
                    onClick={() => setEntries(move(entries, i, -1))}
                  >
                    <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                      <ExpandIcon />
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`أخّر ${entry.name}`}
                    disabled={i === entries.length - 1}
                    onClick={() => setEntries(move(entries, i, 1))}
                  >
                    <ExpandIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`أزل ${entry.name} من الخط`}
                    onClick={() => setEntries(entries.filter((e) => e.customerId !== entry.customerId))}
                  >
                    <CloseIcon />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader title="أضف زبائن" description="ابحث بالاسم أو الجوال." />
          <div className="flex flex-col gap-3">
            <SearchField
              label="ابحث عن زبون"
              placeholder="اسم الزبون أو جواله"
              value={q}
              onValueChange={setQ}
            />
            {route.regionName && ofRegion.length > 0 ? (
              <Button variant="secondary" icon={<AddIcon />} onClick={() => add(ofRegion)}>
                أضف كل زبائن {route.regionName} ({ofRegion.length})
              </Button>
            ) : null}
            {!everyone ? (
              <Skeleton className="h-24 w-full" />
            ) : results.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">لا زبائن يطابقون البحث.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {results.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="text-xs text-ink-muted">{c.regionName ?? 'بلا منطقة'}</span>
                    </div>
                    {c.approvalStatus === 'pending' ? <Badge tone="warning">بانتظار الموافقة</Badge> : null}
                    <Button variant="ghost" size="sm" icon={<AddIcon />} onClick={() => add([c])}>
                      أضف
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
      {editing ? (
        <RouteDialog
          route={route}
          regions={regions.data ?? []}
          reps={reps.data ?? []}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void getRoute(id).then(show);
          }}
        />
      ) : null}
    </>
  );
}

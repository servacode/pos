import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import {
  AddIcon,
  CartIcon,
  CashIcon,
  ChequeIcon,
  CustomersIcon,
  KeyIcon,
  ListIcon,
  ProductsIcon,
  SalesIcon,
  SearchIcon,
  SerialIcon,
  StoreIcon,
  TruckIcon,
  type Icon,
} from '@serva/ui';
import { holdsAny } from '../admin/reports/access';
import { useMe } from '../auth/useAuth';
import { matchesArabic, PAGE_KEYWORDS } from '../lib/arabicSearch';
import { formatNumber } from '../lib/format';
import type { NavSection } from './nav';
import { trapTab } from './popover';
import { useRecordSearch, warmRecordSearch, type RecordHit } from './recordSearch';

/** What the box is for: «ابحث» (Ctrl K), or the list of new things to make (Alt N). */
export type PaletteIntent = 'search' | 'new';

type Scope = 'all' | 'products' | 'customers' | 'invoices' | 'pages';

const SCOPES: readonly { key: Scope; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'products', label: 'منتجات' },
  { key: 'customers', label: 'زبائن' },
  { key: 'invoices', label: 'فواتير' },
  { key: 'pages', label: 'صفحات' },
];

/** Which record groups (recordSearch) each scope keeps. */
const SCOPE_GROUPS: Record<Exclude<Scope, 'all' | 'pages'>, readonly string[]> = {
  products: ['المنتجات', 'الأرقام التسلسلية'],
  customers: ['الزبائن'],
  invoices: ['الفواتير', 'فواتير الشراء', 'عروض الأسعار'],
};

const GROUP_ICON: Record<string, Icon> = {
  المنتجات: ProductsIcon,
  الزبائن: CustomersIcon,
  الموردون: TruckIcon,
  الفواتير: SalesIcon,
  'فواتير الشراء': CartIcon,
  'طلبات المتجر الإلكتروني': StoreIcon,
  الشيكات: ChequeIcon,
  التأجير: KeyIcon,
  'الأرقام التسلسلية': SerialIcon,
};

interface Action {
  key: string;
  title: string;
  hint: string;
  icon: Icon;
  shortcut?: string;
  run: () => void;
}

function Row({
  id,
  chosen,
  icon: RowIcon,
  title,
  sub,
  tail,
  onChoose,
  onHover,
}: {
  id: string;
  chosen: boolean;
  icon: Icon;
  title: ReactNode;
  sub?: ReactNode;
  tail?: ReactNode;
  onChoose: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      id={id}
      aria-selected={chosen}
      tabIndex={-1}
      className="sh-pi"
      onClick={onChoose}
      onMouseEnter={onHover}
    >
      <span className="sh-tile" aria-hidden="true">
        <RowIcon size={20} />
      </span>
      <span className="sh-pt">
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
      </span>
      {tail ? <span className="sh-tail">{tail}</span> : null}
    </button>
  );
}

/**
 * The command palette (هوية 4, round 45), opened by Ctrl K or the search field: scopes (الكل،
 * منتجات، زبائن، فواتير، صفحات), results in titled groups, a hint line of keys at the foot. The
 * pages are matched here; the records (products, customers, invoices, serial numbers…) come from
 * recordSearch. With nothing typed it offers the quick actions: the till (F2) and the new things
 * (Alt N opens it on those).
 */
export function CommandPalette({
  open,
  onOpenChange,
  intent,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: PaletteIntent;
  sections: NavSection[];
}) {
  const navigate = useNavigate();
  const me = useMe();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const listId = useId();
  // The mouse moving the active row must not scroll the list under it: only the keys do
  const byMouse = useRef(false);

  // The latest `me` is read by the effect below without restarting it: a refetched `me` must not
  // clear what the person typed
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    setQuery('');
    setScope('all');
    setActive(0);
    // The lists the search matches by hand start loading now, while the first letters are typed
    warmRecordSearch(meRef.current);
    const focus = window.setTimeout(() => input.current?.focus(), 0);
    return () => {
      window.clearTimeout(focus);
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, [open]);

  const q = query.trim();
  const canSell = holdsAny(me, ['sale.create']);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    if (canSell) {
      list.push({
        key: 'till',
        title: 'افتح الكاشير',
        hint: 'ابدأ بيعاً أو فاتورة جديدة',
        icon: CashIcon,
        shortcut: 'F2',
        run: () => window.location.assign('/pos'),
      });
    }
    if (holdsAny(me, ['catalog.manage'])) {
      list.push({
        key: 'product',
        title: 'منتج جديد',
        hint: 'أضف منتجاً إلى الكتالوج',
        icon: AddIcon,
        run: () => void navigate('/products/new'),
      });
    }
    if (holdsAny(me, ['purchases.manage'])) {
      list.push({
        key: 'po',
        title: 'طلبية شراء جديدة',
        hint: 'اطلب بضاعة من مورد',
        icon: CartIcon,
        run: () => void navigate('/purchase-orders/new'),
      });
    }
    return list;
  }, [canSell, me, navigate]);

  const showActions = q === '' && scope === 'all';
  const showPages = scope === 'all' || scope === 'pages';
  const pages = useMemo(() => {
    if (!showPages || (q === '' && intent === 'new')) return [];
    const all = sections.flatMap((section) =>
      section.pages
        .filter((page) => !q || matchesArabic(page.label, q, section.label, PAGE_KEYWORDS[page.to]))
        .map((page) => ({ section, page })),
    );
    // The pages whose own name matches come before the ones only a keyword reaches
    if (q)
      all.sort((a, b) => Number(!matchesArabic(a.page.label, q)) - Number(!matchesArabic(b.page.label, q)));
    // Nothing typed: a short list of places to jump to, not the whole menu
    return q === '' && scope === 'all' ? all.slice(0, 8) : all;
  }, [sections, q, showPages, scope, intent]);

  // Only the tabs of what this person may search: a cashier is not offered customers or invoices
  const scopes = SCOPES.filter(({ key }) =>
    key === 'products'
      ? holdsAny(me, ['catalog.manage'])
      : key === 'customers'
        ? holdsAny(me, ['customers.view'])
        : key === 'invoices'
          ? holdsAny(me, ['report.view', 'purchases.manage', 'sale.create'])
          : true,
  );

  const { hits: found, searching } = useRecordSearch(me, query, open && scope !== 'pages');
  const hits = useMemo(() => {
    if (scope === 'all') return found;
    if (scope === 'pages') return [];
    const keep = SCOPE_GROUPS[scope];
    return found.filter((hit) => keep.includes(hit.group));
  }, [found, scope]);

  const shownActions = showActions ? actions : [];
  const total = shownActions.length + pages.length + hits.length;
  const chosen = Math.min(active, Math.max(total - 1, 0));

  function close() {
    onOpenChange(false);
  }
  function go(to: string) {
    close();
    void navigate(to);
  }
  function choose(index: number) {
    if (index < shownActions.length) {
      close();
      shownActions[index]!.run();
    } else if (index < shownActions.length + pages.length) {
      go(pages[index - shownActions.length]!.page.to);
    } else {
      const hit = hits[index - shownActions.length - pages.length];
      if (hit) go(hit.to);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      byMouse.current = false;
      event.preventDefault();
      setActive(Math.min(chosen + 1, total - 1));
    } else if (event.key === 'ArrowUp') {
      byMouse.current = false;
      event.preventDefault();
      setActive(Math.max(chosen - 1, 0));
    } else if (event.key === 'Enter' && total > 0 && event.target === input.current) {
      event.preventDefault();
      choose(chosen);
    } else {
      trapTab(event, box.current);
    }
  }

  // The arrow keys keep the active row in view inside the scrolling list
  useEffect(() => {
    if (!open || total === 0 || byMouse.current) return;
    const row = document.getElementById(`${listId}-opt-${String(chosen)}`);
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [open, chosen, total, listId]);

  if (!open) return null;

  const optionId = (i: number) => `${listId}-opt-${String(i)}`;
  const hover = (i: number) => () => {
    byMouse.current = true;
    setActive(i);
  };
  const groups: { name: string; items: { hit: RecordHit; index: number }[] }[] = [];
  hits.forEach((hit, n) => {
    const index = shownActions.length + pages.length + n;
    const last = groups[groups.length - 1];
    if (last && last.name === hit.group) last.items.push({ hit, index });
    else groups.push({ name: hit.group, items: [{ hit, index }] });
  });
  const digits = me.settings.numberFormat;

  return createPortal(
    <>
      <div className="sh-scrim" aria-hidden="true" onMouseDown={close} />
      {/* The modal's own container keeps Tab inside and handles Esc and the arrows for its input. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="ابحث في المتجر"
        className="sh-pal"
        onKeyDown={onKeyDown}
      >
        <div className="sh-pin">
          <SearchIcon size={20} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            autoComplete="off"
            role="combobox"
            aria-label="ابحث في المتجر"
            aria-expanded={total > 0}
            aria-controls={[
              shownActions.length > 0 ? `${listId}-actions` : null,
              pages.length > 0 ? `${listId}-pages` : null,
              groups.length > 0 || (searching && scope !== 'pages') ? `${listId}-records` : null,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-autocomplete="list"
            aria-activedescendant={total > 0 ? optionId(chosen) : undefined}
            placeholder={intent === 'new' ? 'ماذا تريد أن تنشئ؟' : 'ابحث عن منتج أو زبون أو فاتورة أو صفحة…'}
          />
          <kbd className="sh-kbd">Esc</kbd>
        </div>
        <div className="sh-scopes" role="group" aria-label="نطاق البحث">
          {scopes.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="sh-scope"
              aria-pressed={scope === key}
              onClick={() => {
                setScope(key);
                setActive(0);
                input.current?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p role="status" aria-live="polite" className="sh-sr">
          {q.length < 2
            ? ''
            : searching
              ? 'جارٍ البحث…'
              : total === 0
                ? 'لا صفحة ولا سجل بهذا الاسم.'
                : `${String(total)} نتيجة`}
        </p>
        <div className="sh-pbody">
          {shownActions.length > 0 ? (
            <>
              <div className="sh-pg" aria-hidden="true">
                {intent === 'new' ? 'جديد' : 'إجراءات سريعة'}
              </div>
              <div id={`${listId}-actions`} role="listbox" aria-label="إجراءات سريعة">
                {shownActions.map((action, i) => (
                  <Row
                    key={action.key}
                    id={optionId(i)}
                    chosen={i === chosen}
                    icon={action.icon}
                    title={action.title}
                    sub={action.hint}
                    tail={action.shortcut ? <kbd className="sh-kbd">{action.shortcut}</kbd> : undefined}
                    onChoose={() => choose(i)}
                    onHover={hover(i)}
                  />
                ))}
              </div>
            </>
          ) : null}
          {pages.length > 0 ? (
            <>
              <div className="sh-pg" aria-hidden="true">
                {q === '' ? 'انتقال سريع' : 'الصفحات'}
              </div>
              <div id={`${listId}-pages`} role="listbox" aria-label="الصفحات">
                {pages.map(({ section, page }, n) => {
                  const i = shownActions.length + n;
                  return (
                    <Row
                      key={page.to}
                      id={optionId(i)}
                      chosen={i === chosen}
                      icon={page.icon}
                      title={page.label}
                      sub={section.label !== page.label ? section.label : undefined}
                      tail={i === chosen ? 'صفحة ↵' : 'صفحة'}
                      onChoose={() => choose(i)}
                      onHover={hover(i)}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
          {groups.length > 0 || (searching && scope !== 'pages') ? (
            <div id={`${listId}-records`} role="listbox" aria-label="السجلات">
              {groups.map((group) => (
                <div key={group.name} role="group" aria-label={group.name}>
                  <div className="sh-pg" aria-hidden="true">
                    {group.name} <span className="sh-num">{formatNumber(group.items.length, digits)}</span>
                  </div>
                  {group.items.map(({ hit, index }) => (
                    <Row
                      key={hit.key}
                      id={optionId(index)}
                      chosen={index === chosen}
                      icon={GROUP_ICON[hit.group] ?? ListIcon}
                      title={hit.labelLtr ? <bdi dir="ltr">{hit.label}</bdi> : hit.label}
                      sub={
                        hit.detail ? (
                          hit.detailLtr ? (
                            <bdi dir="ltr">{hit.detail}</bdi>
                          ) : (
                            hit.detail
                          )
                        ) : undefined
                      }
                      onChoose={() => choose(index)}
                      onHover={hover(index)}
                    />
                  ))}
                </div>
              ))}
              {searching ? (
                <p className="sh-pg" role="presentation">
                  {groups.length > 0 ? 'جارٍ البحث عن المزيد…' : 'جارٍ البحث…'}
                </p>
              ) : null}
            </div>
          ) : null}
          {total === 0 && !searching ? (
            <p className="sh-pempty">
              {q === '' ? 'ابدأ بالكتابة للبحث في المتجر.' : 'لا صفحة ولا سجل بهذا الاسم.'}
            </p>
          ) : null}
        </div>
        <div className="sh-pfoot" aria-hidden="true">
          <span>
            <kbd className="sh-kbd">↑</kbd>
            <kbd className="sh-kbd">↓</kbd>
            تنقّل
          </span>
          <span>
            <kbd className="sh-kbd">↵</kbd>
            فتح
          </span>
          <span>
            <kbd className="sh-kbd">Esc</kbd>
            إغلاق
          </span>
          {q.length >= 2 && total > 0 ? (
            <span className="sh-end">
              <bdi className="sh-num">{formatNumber(total, digits)}</bdi> نتيجة
            </span>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

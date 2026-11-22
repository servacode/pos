import { Button, SearchField, SegmentedControl, Select } from '@serva/ui';
import { DownloadGlyph } from '../sales/ui';
import type { Sort, StockFilter } from './inventoryShared';

type Branch = { id: string; name: string; kind: string };

/** The search, view, branch, filter, order and export bar over the stock list. */
export function InventoryFilters({
  counting,
  query,
  onQuery,
  hasOptions,
  view,
  onView,
  clothing,
  manyBranches,
  branchShown,
  onBranch,
  branchList,
  filter,
  onFilter,
  reorderKinds,
  sort,
  onSort,
  exportDisabled,
  onExport,
}: {
  counting: boolean;
  query: string;
  onQuery: (v: string) => void;
  /** Some piece has options (sizes, colours): the grid view means something */
  hasOptions: boolean;
  view: 'list' | 'grid';
  onView: (v: 'list' | 'grid') => void;
  clothing: boolean;
  manyBranches: boolean;
  branchShown: string;
  onBranch: (id: string) => void;
  branchList: Branch[];
  filter: StockFilter;
  onFilter: (f: StockFilter) => void;
  reorderKinds: number;
  sort: Sort;
  onSort: (s: Sort) => void;
  exportDisabled: boolean;
  onExport: () => void;
}) {
  return (
    <div className="sx-card sx-filterbar print:hidden">
      <div className="sx-search">
        <SearchField label="ابحث عن صنف" value={query} onValueChange={onQuery} />
      </div>
      {/* The grid only means something when a product has options; «المقاس واللون» is a clothing store's words */}
      {!counting && hasOptions ? (
        <SegmentedControl
          label="طريقة العرض"
          value={view}
          onValueChange={onView}
          options={[
            { value: 'list', label: 'قائمة' },
            { value: 'grid', label: clothing ? 'شبكة المقاس واللون' : 'شبكة الخيارات' },
          ]}
        />
      ) : null}
      {!counting && manyBranches ? (
        <Select
          label="الفرع"
          hideLabel
          value={branchShown}
          onChange={(e) => onBranch(e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="">كل الفروع</option>
          {branchList.map((b) => (
            <option key={b.id} value={b.id}>
              {b.kind === 'van' ? `${b.name} (مندوب)` : b.name}
            </option>
          ))}
        </Select>
      ) : null}
      {!counting && view === 'list' ? (
        <div role="radiogroup" aria-label="التصفية" className="sx-chips scroll">
          {(
            [
              ['all', 'الكل'],
              ['low', 'نفد أو سالب'],
              ['nocost', 'بلا كلفة'],
              ...(reorderKinds > 0 || filter === 'reorder' ? ([['reorder', 'تحت حد الطلب']] as const) : []),
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="sx-chip">
              <input
                type="radio"
                name="stock-filter"
                checked={filter === key}
                onChange={() => onFilter(key)}
              />
              {text}
            </label>
          ))}
        </div>
      ) : null}
      {!counting && view === 'list' ? (
        <Select
          label="الترتيب"
          hideLabel
          value={sort}
          onChange={(e) => onSort(e.target.value as Sort)}
          className="w-full sm:w-44"
        >
          <option value="name">الترتيب: بالاسم</option>
          <option value="value">الأعلى قيمة أولاً</option>
          <option value="qty">الأقل كمية أولاً</option>
        </Select>
      ) : null}
      {!counting ? (
        <Button
          variant="ghost"
          icon={<DownloadGlyph size={20} />}
          disabled={exportDisabled}
          onClick={onExport}
        >
          صدّر إلى إكسل
        </Button>
      ) : null}
    </div>
  );
}

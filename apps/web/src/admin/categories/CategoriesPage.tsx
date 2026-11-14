import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { createCategoryInput, updateCategoryInput, type Category } from '@serva/core';
import {
  AddIcon,
  Alert,
  ArchiveIcon,
  Badge,
  Button,
  Card,
  CategoriesIcon,
  Dialog,
  EditIcon,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  NumberField,
  PageHeader,
  RetryIcon,
  Select,
  Skeleton,
  TextField,
  Tooltip,
  UndoIcon,
  cn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { categoryExamples } from '../../lib/sectors';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { createCategory, listCategories, updateCategory } from '../catalog/api';
import {
  canManageCatalog,
  categoryOptionLabel,
  categoryTree,
  selfAndDescendants,
  type CategoryNode,
} from '../catalog/catalog';

type Editing = { mode: 'new'; parentId: string } | { mode: 'edit'; category: Category };

const CONFLICT_MESSAGE = 'غيّر أحدٌ هذا التصنيف للتو. حدّثنا القائمة، جرّب مرة أخرى.';

interface CategoryFormProps {
  editing: Editing;
  categories: Category[];
  onDone: (saved: Category) => void;
  onConflict: () => void;
  onCancel: () => void;
}

/** Add or change one category: its name, its parent (never itself or one of its children) and its order. */
function CategoryForm({ editing, categories, onDone, onConflict, onCancel }: CategoryFormProps) {
  const current = editing.mode === 'edit' ? editing.category : null;
  const [name, setName] = useState(current?.name ?? '');
  const [parentId, setParentId] = useState(
    current ? (current.parentId ?? '') : editing.mode === 'new' ? editing.parentId : '',
  );
  const [sortOrder, setSortOrder] = useState(String(current?.sortOrder ?? 0));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const excluded = current ? selfAndDescendants(categories, current.id) : new Set<string>();
  const parents = categoryTree(
    categories.filter((c) => !excluded.has(c.id) && (!c.archivedAt || c.id === parentId)),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const fields = { name, parentId: parentId || null, sortOrder: Number(sortOrder || '0') };
    const result = current
      ? updateCategoryInput.safeParse({ version: current.version, ...fields })
      : createCategoryInput.safeParse(fields);
    if (!result.success) {
      const next: Partial<Record<string, string>> = {};
      for (const issue of result.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      onDone(
        current
          ? await updateCategory(current.id, { version: current.version, ...fields })
          : await createCategory(fields),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_version') onConflict();
      else if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        label="اسم التصنيف"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Select
          label="يتبع"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          error={errors.parentId}
        >
          <option value="">لا شيء (تصنيف رئيسي)</option>
          {parents.map((node) => (
            <option key={node.category.id} value={node.category.id}>
              {categoryOptionLabel(node)}
            </option>
          ))}
        </Select>
        <NumberField
          label="الترتيب على الكاشير"
          hint="الأصغر أولاً."
          value={sortOrder}
          onValueChange={setSortOrder}
          error={errors.sortOrder}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-3 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          تراجع
        </Button>
        <Button type="submit" loading={saving}>
          احفظ
        </Button>
      </div>
    </form>
  );
}

// The tree's geometry (rem). Each level pads the row INDENT further in, and the tile steps a
// little more (TILE_STEP), so the elbow from the parent's line to a child's tile has room.
const ROW_START = 1;
const INDENT = 1.5;
const TILE_STEP = 0.5;
const TILE = 1.75;

/** Where a row's tile starts, from the row's inline start. */
const tileAt = (depth: number) => ROW_START + depth * (INDENT + TILE_STEP);
/** Where the guide under the tiles of a level runs: their middle. */
const guideAt = (level: number) => tileAt(level) + TILE / 2;

interface TreeRow extends CategoryNode {
  /** The last child of its parent: its line stops at its middle (└) instead of running on (├). */
  last: boolean;
  /** It has children: a line runs down from its tile to them. */
  parent: boolean;
  /** For each level above its parent's (0 … depth − 2): an ancestor's line passes through this row. */
  through: boolean[];
}

/** The flat tree (categoryTree) with what each row needs to draw its guides. */
function treeRows(tree: readonly CategoryNode[]): TreeRow[] {
  const lastAt: boolean[] = [];
  return tree.map((node, index) => {
    const next = tree.slice(index + 1).find((other) => other.depth <= node.depth);
    const last = !next || next.depth < node.depth;
    lastAt[node.depth] = last;
    const through = Array.from({ length: Math.max(0, node.depth - 1) }, (_, level) => !lastAt[level + 1]);
    const parent = (tree[index + 1]?.depth ?? -1) > node.depth;
    return { ...node, last, parent, through };
  });
}

/** The guide lines of one row: ancestors' lines passing by, the elbow to its tile, its own stem. */
function TreeGuides({ row }: { row: TreeRow }) {
  const line = 'pointer-events-none absolute border-line-control/40';
  const x = (level: number) => ({ insetInlineStart: `calc(${guideAt(level)}rem - 0.5px)` });
  const own = row.depth - 1;
  return (
    <>
      {row.through.map((on, level) =>
        on ? (
          <span key={level} aria-hidden="true" className={cn(line, 'inset-y-0 border-s')} style={x(level)} />
        ) : null,
      )}
      {row.depth > 0 ? (
        <span
          aria-hidden="true"
          className={cn(line, 'top-0 h-1/2 rounded-es-small border-s border-b')}
          style={{ ...x(own), width: `${tileAt(row.depth) - guideAt(own)}rem` }}
        />
      ) : null}
      {row.depth > 0 && !row.last ? (
        <span aria-hidden="true" className={cn(line, 'top-1/2 bottom-0 border-s')} style={x(own)} />
      ) : null}
      {row.parent ? (
        <span
          aria-hidden="true"
          className={cn(line, 'bottom-0 border-s')}
          style={{ ...x(row.depth), top: `calc(50% + ${TILE / 2}rem)` }}
        />
      ) : null}
    </>
  );
}

function CategoryRow({
  row,
  first,
  canManage,
  busy,
  onEdit,
  onAddChild,
  onArchive,
}: {
  row: TreeRow;
  first: boolean;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onAddChild: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const { category, depth } = row;
  const archived = category.archivedAt !== null;
  return (
    <li
      // A hairline between top-level categories only: a parent and its children read as one group.
      className={cn(
        'relative flex min-h-12 items-center gap-3 py-1.5 pe-3 transition-colors duration-120 ease-standard hover:bg-surface-muted/60',
        depth === 0 && !first && 'border-t border-line',
      )}
      style={{ paddingInlineStart: `${ROW_START + depth * INDENT}rem` }}
    >
      <TreeGuides row={row} />
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-small',
          archived
            ? 'bg-surface-muted text-ink-subtle'
            : depth === 0
              ? 'bg-brand-soft text-brand-ink'
              : 'bg-surface-muted text-ink-muted',
        )}
        style={{ marginInlineStart: `${depth * TILE_STEP}rem` }}
      >
        <CategoriesIcon size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={`/products?category=${category.id}`}
          className={cn(
            'min-w-0 truncate rounded-small font-semibold transition-colors duration-120 ease-standard hover:text-brand-ink',
            archived ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {category.name}
        </Link>
        {archived ? <Badge>مؤرشف</Badge> : null}
      </span>
      <Badge dot={false}>
        {category.productCount === 0 ? (
          'لا منتجات'
        ) : (
          <>
            <bdi className="num">{category.productCount}</bdi> منتج
          </>
        )}
      </Badge>
      {canManage ? (
        <Menu
          label={`إجراءات «${category.name}»`}
          align="end"
          trigger={
            <Tooltip content="إجراءات التصنيف">
              <IconButton label={`إجراءات «${category.name}»`} icon={<MoreIcon />} loading={busy} />
            </Tooltip>
          }
        >
          {!archived ? (
            <MenuItem icon={<AddIcon />} onSelect={onAddChild}>
              أضف تصنيفاً تحت <bdi className="text-ink-muted">«{category.name}»</bdi>
            </MenuItem>
          ) : null}
          <MenuItem icon={<EditIcon />} onSelect={onEdit}>
            عدّل <bdi className="text-ink-muted">«{category.name}»</bdi>
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={archived ? <UndoIcon /> : <ArchiveIcon />} onSelect={() => onArchive(!archived)}>
            {archived ? 'أعد' : 'أرشف'} <bdi className="text-ink-muted">«{category.name}»</bdi>
          </MenuItem>
        </Menu>
      ) : null}
    </li>
  );
}

/** The tree's shape while it loads: a few rows of tile, name and count. */
function TreeSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1"
    >
      <span className="sr-only">نحمّل التصنيفات…</span>
      {['w-40', 'w-28', 'w-36', 'w-24'].map((width, index) => (
        <span
          key={width}
          aria-hidden="true"
          className={cn('flex min-h-12 items-center gap-3 px-4', index > 0 && 'border-t border-line')}
        >
          <Skeleton className="size-7" />
          <Skeleton className={cn('h-3.5', width)} />
          <span className="flex-1" />
          <Skeleton className="h-5 w-16" />
        </span>
      ))}
    </div>
  );
}

/**
 * «التصنيفات» (12; kit admin/Products ٢): the category tree with each one's products, adding,
 * renaming, moving and archiving. An archived category keeps its products (09 › categories).
 */
export function CategoriesPage() {
  const me = useMe();
  const canManage = canManageCatalog(me);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCategories((await listCategories()).items);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const replace = (saved: Category) =>
    setCategories((current) => {
      if (!current) return [saved];
      return current.some((c) => c.id === saved.id)
        ? current.map((c) => (c.id === saved.id ? saved : c))
        : [...current, saved];
    });

  async function archive(category: Category, archived: boolean) {
    setBusyId(category.id);
    setActionError(null);
    try {
      replace(await updateCategory(category.id, { version: category.version, archived }));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_version') {
        setActionError(CONFLICT_MESSAGE);
        void refresh();
      } else setActionError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  const tree = categories ? categoryTree(categories) : [];
  const rows = treeRows(tree);

  return (
    <AppShell>
      <title>التصنيفات · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="التصنيفات"
          description="تجمع منتجاتك على شاشة البيع وفي التقارير. اضغط اسم التصنيف لترى منتجاته."
          actions={
            canManage ? (
              <Button icon={<AddIcon />} onClick={() => setEditing({ mode: 'new', parentId: '' })}>
                أضف تصنيفاً
              </Button>
            ) : null
          }
        />

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {categories === null && !loadError ? <TreeSkeleton /> : null}

        {loadError && categories === null ? (
          <Card className="flex flex-col items-start gap-4">
            <Alert tone="error" className="self-stretch">
              {loadError}
            </Alert>
            <Button variant="secondary" icon={<RetryIcon />} onClick={() => void refresh()}>
              أعد المحاولة
            </Button>
          </Card>
        ) : null}

        {categories !== null && tree.length === 0 ? (
          <EmptyState
            icon={CategoriesIcon}
            title="لا تصنيفات بعد."
            description={`التصنيفات تسرّع البحث على الكاشير، مثل ${categoryExamples(me.tenant.sectors)
              .map((n) => `«${n}»`)
              .join('، ')}.`}
            action={
              canManage ? (
                <Button icon={<AddIcon />} onClick={() => setEditing({ mode: 'new', parentId: '' })}>
                  أضف تصنيفاً
                </Button>
              ) : null
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <ul
            aria-label="التصنيفات"
            className="flex flex-col overflow-hidden rounded-card border border-line bg-surface py-1 shadow-e1"
          >
            {rows.map((row, index) => (
              <CategoryRow
                key={row.category.id}
                row={row}
                first={index === 0}
                canManage={canManage}
                busy={busyId === row.category.id}
                onEdit={() => setEditing({ mode: 'edit', category: row.category })}
                onAddChild={() => setEditing({ mode: 'new', parentId: row.category.id })}
                onArchive={(archived) => void archive(row.category, archived)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.mode === 'edit' ? `عدّل «${editing.category.name}»` : 'أضف تصنيفاً'}
        description={
          editing?.mode === 'edit'
            ? 'غيّر اسمه أو انقله تحت تصنيف آخر.'
            : 'يظهر على شاشة البيع ويجمع منتجاته في التقارير.'
        }
      >
        {editing && categories ? (
          <CategoryForm
            editing={editing}
            categories={categories}
            onDone={(saved) => {
              replace(saved);
              setEditing(null);
            }}
            onConflict={() => {
              setEditing(null);
              setActionError(CONFLICT_MESSAGE);
              void refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </AppShell>
  );
}

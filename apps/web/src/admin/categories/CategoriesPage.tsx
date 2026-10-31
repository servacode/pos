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
  NumberField,
  RetryIcon,
  Select,
  SkeletonText,
  TextField,
  UndoIcon,
  textLinkClass,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
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
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        label="اسم التصنيف"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
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
      <div className="flex flex-wrap justify-end gap-3">
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

function CategoryRow({
  node,
  canManage,
  busy,
  onEdit,
  onAddChild,
  onArchive,
}: {
  node: CategoryNode;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onAddChild: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const { category, depth } = node;
  const archived = category.archivedAt !== null;
  return (
    <li
      className="flex min-h-14 flex-wrap items-center gap-2 border-b border-line px-4 py-2 last:border-0"
      style={{ paddingInlineStart: `${1 + depth * 1.5}rem` }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <Link
            to={`/products?category=${category.id}`}
            className={archived ? 'font-semibold text-ink-muted' : 'font-semibold text-ink'}
          >
            {category.name}
          </Link>
          {archived ? <Badge>مؤرشف</Badge> : null}
        </span>
        <span className="text-sm text-ink-muted">
          {category.productCount === 0 ? 'لا منتجات' : `${category.productCount} منتج`}
        </span>
      </div>
      {canManage ? (
        <div className="flex items-center gap-1">
          {!archived ? (
            <IconButton
              label={`أضف تصنيفاً تحت «${category.name}»`}
              icon={<AddIcon />}
              onClick={onAddChild}
            />
          ) : null}
          <IconButton label={`عدّل «${category.name}»`} icon={<EditIcon />} onClick={onEdit} />
          <IconButton
            label={archived ? `أعد «${category.name}»` : `أرشف «${category.name}»`}
            icon={archived ? <UndoIcon /> : <ArchiveIcon />}
            loading={busy}
            onClick={() => onArchive(!archived)}
          />
        </div>
      ) : null}
    </li>
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

  return (
    <AppShell>
      <title>التصنيفات · Serva POS</title>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink">التصنيفات</h1>
            <p className="text-ink-muted">
              تجمع منتجاتك على شاشة البيع وفي التقارير.{' '}
              <Link to="/products" className={textLinkClass}>
                المنتجات
              </Link>
            </p>
          </div>
          {canManage ? (
            <Button
              icon={<AddIcon />}
              onClick={() => setEditing({ mode: 'new', parentId: '' })}
              className="max-sm:w-full"
            >
              أضف تصنيفاً
            </Button>
          ) : null}
        </div>

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {categories === null && !loadError ? (
          <Card aria-busy="true">
            <span className="sr-only">نحمّل التصنيفات…</span>
            <SkeletonText lines={4} />
          </Card>
        ) : null}

        {loadError && categories === null ? (
          <Card className="flex flex-col items-start gap-3">
            <Alert tone="error">{loadError}</Alert>
            <Button variant="secondary" icon={<RetryIcon />} onClick={() => void refresh()}>
              أعد المحاولة
            </Button>
          </Card>
        ) : null}

        {categories !== null && tree.length === 0 ? (
          <Card>
            <EmptyState
              icon={CategoriesIcon}
              title="لا تصنيفات بعد."
              description="التصنيفات مثل «ألبان وأجبان» و«منظفات» تسرّع البحث على الكاشير."
              action={
                canManage ? (
                  <Button icon={<AddIcon />} onClick={() => setEditing({ mode: 'new', parentId: '' })}>
                    أضف تصنيفاً
                  </Button>
                ) : null
              }
            />
          </Card>
        ) : null}

        {tree.length > 0 ? (
          <ul
            aria-label="التصنيفات"
            className="flex flex-col rounded-card border border-line bg-surface shadow-e1"
          >
            {tree.map((node) => (
              <CategoryRow
                key={node.category.id}
                node={node}
                canManage={canManage}
                busy={busyId === node.category.id}
                onEdit={() => setEditing({ mode: 'edit', category: node.category })}
                onAddChild={() => setEditing({ mode: 'new', parentId: node.category.id })}
                onArchive={(archived) => void archive(node.category, archived)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.mode === 'edit' ? `عدّل «${editing.category.name}»` : 'أضف تصنيفاً'}
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

import { useEffect, useState } from 'react';
import type { OptionValuesResponse } from '@serva/core';
import { AddIcon, Button, CloseIcon, cn, DeleteIcon, IconButton, Switch, TextField } from '@serva/ui';
import { apiFetch } from '../../lib/api';
import { DEFAULT_AXIS_NAMES, MAX_AXES, newKey, type Axis } from './form';
import { insertValue, presetGroups, SIZE_KINDS, type PresetGroup } from './presets';

interface OptionsEditorProps {
  axes: Axis[];
  /** How many live variants the axes make, for the summary line */
  variantCount: number;
  onChange: (axes: Axis[]) => void;
}

const defaultAxes = (): Axis[] => DEFAULT_AXIS_NAMES.map((name) => ({ key: newKey('a'), name, values: [] }));

/** The values the store's pieces already use, by option name; empty until (or unless) they load */
function useStoreValues(on: boolean): Map<string, string[]> {
  const [values, setValues] = useState(new Map<string, string[]>());
  useEffect(() => {
    if (!on) return;
    let alive = true;
    apiFetch<OptionValuesResponse>('/v1/products/options', { auth: true })
      .then((r) => alive && setValues(new Map(r.options.map((o) => [o.name, o.values]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [on]);
  return values;
}

/**
 * «المقاسات والألوان» (kit admin/ProductCard ٢): the options and their values; every combination
 * becomes a variant (contract Q8: the matrix is built here and sent as `variants`). Sizes, shoe
 * numbers, children's ages and colours are ready to tap (presets.ts), beside the values the store
 * already uses; anything else is typed once and offered from then on.
 */
export function OptionsEditor({ axes, variantCount, onChange }: OptionsEditorProps) {
  const on = axes.length > 0;
  const storeValues = useStoreValues(on);
  return (
    <div className="flex flex-col gap-4">
      <Switch
        label="له مقاسات أو ألوان"
        description="كل تركيبة متغيّر له سعره وباركوده ومخزونه."
        checked={on}
        onCheckedChange={(checked) => onChange(checked ? defaultAxes() : [])}
      />
      {on ? (
        <>
          {axes.map((axis, index) => (
            <AxisRow
              key={axis.key}
              axis={axis}
              first={index === 0}
              storeValues={storeValues.get(axis.name.trim()) ?? []}
              canRemove={axes.length > 1}
              onChange={(next) => onChange(axes.map((a) => (a.key === axis.key ? next : a)))}
              onRemove={() => onChange(axes.filter((a) => a.key !== axis.key))}
            />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {axes.length < MAX_AXES ? (
              <Button
                variant="ghost"
                icon={<AddIcon />}
                onClick={() => onChange([...axes, { key: newKey('a'), name: '', values: [] }])}
              >
                أضف خاصية
              </Button>
            ) : (
              <span />
            )}
            <p className="text-sm text-ink-muted" role="status">
              {variantCount > 1 ? `${variantCount} متغيّرات` : 'أضف القيم لتظهر المتغيّرات'}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AxisRow({
  axis,
  first,
  storeValues,
  canRemove,
  onChange,
  onRemove,
}: {
  axis: Axis;
  first: boolean;
  storeValues: readonly string[];
  canRemove: boolean;
  onChange: (axis: Axis) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState('');
  const title = axis.name.trim() || 'الخاصية';
  const presets = presetGroups(axis.name);
  const builtIn = new Set(presets.flatMap((g) => g.values));
  const own = storeValues.filter((v) => !builtIn.has(v));
  const groups: PresetGroup[] = [
    ...presets,
    ...(own.length > 0 ? [{ label: 'قيم المحل', values: own }] : []),
  ];

  function add() {
    const typed = value
      .split(/[,،]/)
      .map((v) => v.trim())
      .filter(Boolean);
    let values = axis.values;
    for (const v of typed) values = insertValue(values, v, presets);
    if (values.length !== axis.values.length) onChange({ ...axis, values });
    setValue('');
  }

  const toggle = (v: string) =>
    onChange({
      ...axis,
      values: axis.values.includes(v)
        ? axis.values.filter((x) => x !== v)
        : insertValue(axis.values, v, presets),
    });
  const takeAll = (group: PresetGroup) => {
    let values = axis.values;
    for (const v of group.values) values = insertValue(values, v, presets);
    onChange({ ...axis, values });
  };

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <div className="flex items-end gap-2">
        <TextField
          label="اسم الخاصية"
          value={axis.name}
          onChange={(event) => onChange({ ...axis, name: event.target.value })}
          className="flex-1"
        />
        {canRemove ? (
          <IconButton label={`احذف خاصية ${title}`} icon={<DeleteIcon />} onClick={onRemove} />
        ) : null}
      </div>
      {first ? (
        <div role="group" aria-label="نوع القياس" className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">القياس:</span>
          {SIZE_KINDS.map((kind) => (
            <button
              key={kind.name}
              type="button"
              aria-pressed={axis.name.trim() === kind.name}
              onClick={() => onChange({ ...axis, name: kind.name })}
              className={cn(
                'min-h-10 rounded-full border px-3 text-sm font-semibold',
                axis.name.trim() === kind.name
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-line bg-surface text-ink',
              )}
            >
              {kind.pick}
            </button>
          ))}
        </div>
      ) : null}
      {groups.map((group) => (
        <div
          key={group.label}
          role="group"
          aria-label={`${title}: ${group.label}`}
          className="flex flex-col gap-1.5"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-muted">{group.label}</span>
            {group.values.length > 3 ? (
              <Button size="sm" variant="ghost" onClick={() => takeAll(group)}>
                اختر الكل
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.values.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={axis.values.includes(v)}
                onClick={() => toggle(v)}
                className={cn(
                  'min-h-10 min-w-10 rounded-control border px-2.5 text-sm font-semibold',
                  axis.values.includes(v)
                    ? 'border-brand bg-brand text-on-brand'
                    : 'border-line bg-surface text-ink hover:bg-surface-muted',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      {axis.values.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`قيم ${title}`}>
          {axis.values.map((v) => (
            <li
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft ps-3 text-sm font-semibold text-brand-ink"
            >
              {v}
              <IconButton
                size="xs"
                label={`احذف ${v}`}
                icon={<CloseIcon size={16} />}
                onClick={() => onChange({ ...axis, values: axis.values.filter((x) => x !== v) })}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-start gap-2">
        <TextField
          label={`قيمة جديدة لـ${title}`}
          hideLabel
          placeholder={
            presets.length > 0
              ? `قيمة غير موجودة فوق، مثل ${axis.name === 'اللون' ? 'نيلي' : '6XL'}`
              : `قيمة جديدة لـ${title}`
          }
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="flex-1"
        />
        <Button variant="secondary" onClick={add}>
          أضف القيمة
        </Button>
      </div>
    </div>
  );
}

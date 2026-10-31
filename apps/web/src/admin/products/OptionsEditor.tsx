import { useState } from 'react';
import { AddIcon, Button, CloseIcon, DeleteIcon, IconButton, Switch, TextField } from '@serva/ui';
import { DEFAULT_AXIS_NAMES, MAX_AXES, newKey, type Axis } from './form';

interface OptionsEditorProps {
  axes: Axis[];
  /** How many live variants the axes make, for the summary line */
  variantCount: number;
  onChange: (axes: Axis[]) => void;
}

const defaultAxes = (): Axis[] => DEFAULT_AXIS_NAMES.map((name) => ({ key: newKey('a'), name, values: [] }));

/**
 * «المقاسات والألوان» (kit admin/ProductCard ٢): the options and their values; every combination
 * becomes a variant (contract Q8: the matrix is built here and sent as `variants`).
 */
export function OptionsEditor({ axes, variantCount, onChange }: OptionsEditorProps) {
  const on = axes.length > 0;
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
          {axes.map((axis) => (
            <AxisRow
              key={axis.key}
              axis={axis}
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
  canRemove,
  onChange,
  onRemove,
}: {
  axis: Axis;
  canRemove: boolean;
  onChange: (axis: Axis) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState('');
  const title = axis.name.trim() || 'الخاصية';

  function add() {
    const values = value
      .split(/[,،]/)
      .map((v) => v.trim())
      .filter((v) => v && !axis.values.includes(v));
    if (values.length > 0) onChange({ ...axis, values: [...axis.values, ...values] });
    setValue('');
  }

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
          placeholder={`قيمة جديدة لـ${title}، مثل ${axis.name === 'اللون' ? 'أحمر' : 'M'}`}
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

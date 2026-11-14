import { useEffect, useRef, type ComponentProps } from 'react';
import { useDensity } from './context';
import { CloseIcon, SearchIcon } from './icons';
import { ADORNMENT_INSET, FieldButton, TextField } from './TextField';

export interface SearchFieldProps extends Omit<
  ComponentProps<'input'>,
  'size' | 'type' | 'onChange' | 'value'
> {
  /** The accessible name; shown only to screen readers, the placeholder says it on screen. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Pressing «/» anywhere on the page focuses this field (tab 14 › خانة البحث). */
  slashShortcut?: boolean;
}

function typingInAField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The search box at the head of lists and the sale screen (هوية 4 › الحقول): the field's box with
 * the search icon at the start and, once something is typed, a clear button at the end.
 */
export function SearchField({
  label,
  value,
  onValueChange,
  slashShortcut = false,
  className,
  placeholder,
  ...rest
}: SearchFieldProps) {
  const density = useDensity();
  const inputRef = useRef<HTMLInputElement>(null);
  const iconSize = density === 'dense' ? 16 : 20;

  useEffect(() => {
    if (!slashShortcut) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingInAField(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [slashShortcut]);

  return (
    <TextField
      {...rest}
      ref={inputRef}
      type="search"
      label={label}
      hideLabel
      placeholder={placeholder ?? label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.preventDefault();
          onValueChange('');
        }
        rest.onKeyDown?.(event);
      }}
      className={className}
      // The browser's own clear cross would double the one drawn here.
      inputClassName="[&::-webkit-search-cancel-button]:appearance-none"
      startAdornment={<SearchIcon size={iconSize} className={ADORNMENT_INSET[density].start} />}
      endAdornment={
        value ? (
          <FieldButton
            label="امسح البحث"
            title="امسح البحث"
            icon={<CloseIcon size={iconSize} />}
            onClick={() => {
              onValueChange('');
              inputRef.current?.focus();
            }}
          />
        ) : undefined
      }
    />
  );
}

import { useEffect, useRef, type ComponentProps } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { CloseIcon, SearchIcon } from './icons';
import { TextField } from './TextField';

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

/** The search box at the head of lists and the sale screen: icon at the start, clear at the end. */
export function SearchField({
  label,
  value,
  onValueChange,
  slashShortcut = false,
  className,
  placeholder,
  ...rest
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
      inputClassName="ps-1 [&::-webkit-search-cancel-button]:appearance-none"
      startAdornment={<SearchIcon className={cn('ms-3.5 text-ink-subtle')} />}
      endAdornment={
        value ? (
          <IconButton
            label="امسح البحث"
            size="sm"
            icon={<CloseIcon />}
            className="me-1"
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

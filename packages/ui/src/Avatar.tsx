import { cn } from './cn';

/**
 * The first letters of the first two words, past the article «ال»: «خالد العلي» → «خع»,
 * «أبو أحمد الخلف» → «أأ», «سامر» → «س».
 */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word.length > 3 ? word.replace(/^ال/, '') : word)[0] ?? '')
    .join('');
}

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md';
  /** Decorative next to the written name (the default); set to give it the name when alone. */
  labelled?: boolean;
  className?: string;
}

/** A person's initials on brand-soft (kit .avatar): 40, or 32 small. No stock photos. */
export function Avatar({ name, size = 'md', labelled = false, className }: AvatarProps) {
  return (
    <span
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? name : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand-ink',
        size === 'sm' ? 'size-8 text-[0.8125rem]' : 'size-10 text-[0.9375rem]',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

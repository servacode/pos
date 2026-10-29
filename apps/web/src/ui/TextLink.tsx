import type { ComponentProps } from 'react';
import { Link } from 'react-router';
import { cn } from '../lib/cn';

export function TextLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        'rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:underline',
        className,
      )}
      {...rest}
    />
  );
}

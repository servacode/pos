import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface p-5 shadow-card sm:p-6', className)}
      {...rest}
    />
  );
}

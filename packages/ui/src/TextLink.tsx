import type { ElementType } from 'react';
import { cn } from './cn';
import type { PolymorphicProps } from './context';

export const textLinkClass =
  'rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:underline';

/** A link inside text. Renders an <a>, or the app's router link: `<TextLink as={Link} to="/login">`. */
export function TextLink<C extends ElementType = 'a'>({
  as,
  className,
  ...rest
}: PolymorphicProps<C, { className?: string }>) {
  const Component: ElementType = as ?? 'a';
  return <Component className={cn(textLinkClass, className)} {...rest} />;
}

import type { ElementType } from 'react';
import { cn } from './cn';
import type { PolymorphicProps } from './context';

/**
 * هوية 4 › الرابط: brand-ink and semibold inside text. The underline sits 4 px down, clear of the
 * dots under Arabic letters, and fades in on hover and on keyboard focus (with the focus ring).
 */
export const textLinkClass =
  'rounded-sm font-semibold text-brand-ink underline decoration-transparent decoration-1 underline-offset-4 transition-[text-decoration-color] duration-120 ease-standard hover:decoration-current focus-visible:decoration-current';

/** A link inside text. Renders an <a>, or the app's router link: `<TextLink as={Link} to="/login">`. */
export function TextLink<C extends ElementType = 'a'>({
  as,
  className,
  ...rest
}: PolymorphicProps<C, { className?: string }>) {
  const Component: ElementType = as ?? 'a';
  return <Component className={cn(textLinkClass, className)} {...rest} />;
}

import { useEffect, useState } from 'react';

/** A phone-width screen (under Tailwind's `sm`): a list becomes cards, as a table does not fit. */
export function useIsPhone(): boolean {
  const query = '(max-width: 639px)';
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const change = () => setPhone(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return phone;
}

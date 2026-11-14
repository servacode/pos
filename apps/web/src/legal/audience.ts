import { createContext } from 'react';

/**
 * Who is reading a legal page: the public, or a platform admin signed in to the panel in this same
 * browser tab (its session token is in sessionStorage, see platform/PlatformApp.tsx). The admin sees
 * what is still missing, loud; everyone else sees the text with the blanks quietly marked. The
 * token is not verified here: it only chooses which notice to draw, and the texts are public anyway.
 */
export const PLATFORM_TOKEN_KEY = 'servaPlatformToken';

export function isPlatformSession(): boolean {
  try {
    return Boolean(sessionStorage.getItem(PLATFORM_TOKEN_KEY));
  } catch {
    return false;
  }
}

/** True inside a legal page read by a signed-in platform admin */
export const AdminReaderContext = createContext(false);

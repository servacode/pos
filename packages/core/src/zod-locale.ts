import { z } from 'zod';

/**
 * Every message a schema does not word itself comes out in Arabic: a missing field, a wrong type, a
 * number out of range. A form never shows «Invalid input». Messages written on the schemas win.
 */
z.config(z.locales.ar());

// jsdom ships no types, and only themeBoot.test.ts uses it directly (to run index.html's inline
// script). This is the small part of its API that test needs.
declare module 'jsdom' {
  export interface ConstructorOptions {
    url?: string;
    runScripts?: 'dangerously' | 'outside-only';
    beforeParse?(window: Window & typeof globalThis): void;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}

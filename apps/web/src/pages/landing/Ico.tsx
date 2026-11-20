/** The landing's own small icon set (one 24 grid, 1.75 stroke), drawn once and used by name. */
export type IcoName =
  | 'check'
  | 'x'
  | 'plus'
  | 'wifi-off'
  | 'coins'
  | 'book'
  | 'truck'
  | 'branch'
  | 'shield'
  | 'chat'
  | 'arrow'
  | 'chart'
  | 'scan'
  | 'home'
  | 'lock'
  | 'card'
  | 'sync';

export function Ico({ name, lg = false }: { name: IcoName; lg?: boolean }) {
  return (
    <svg className={lg ? 'ico lg' : 'ico'} aria-hidden="true" focusable="false">
      <use href={`#lp-i-${name}`} />
    </svg>
  );
}

/** The symbols Ico points at: rendered once, at the top of the page. */
export function IcoSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="lp-i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </symbol>
        <symbol id="lp-i-x" viewBox="0 0 24 24">
          <path d="M18 6 6 18M6 6l12 12" />
        </symbol>
        <symbol id="lp-i-plus" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </symbol>
        <symbol id="lp-i-wifi-off" viewBox="0 0 24 24">
          <path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M14 10.4a10 10 0 0 1 5 2.5M12 20h.01" />
        </symbol>
        <symbol id="lp-i-coins" viewBox="0 0 24 24">
          <circle cx="8" cy="8" r="6" />
          <path d="M18.1 10.4A6 6 0 1 1 10.4 18.1M7 6h1v4M16.7 13.8l.7.7-2.8 2.8" />
        </symbol>
        <symbol id="lp-i-book" viewBox="0 0 24 24">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </symbol>
        <symbol id="lp-i-truck" viewBox="0 0 24 24">
          <path d="M10 17h4V5H2v12h3M14 9h4l4 4v4h-3M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0" />
        </symbol>
        <symbol id="lp-i-branch" viewBox="0 0 24 24">
          <path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21V12h6v9" />
        </symbol>
        <symbol id="lp-i-shield" viewBox="0 0 24 24">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />
        </symbol>
        <symbol id="lp-i-chat" viewBox="0 0 24 24">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z" />
        </symbol>
        <symbol id="lp-i-arrow" viewBox="0 0 24 24">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </symbol>
        <symbol id="lp-i-chart" viewBox="0 0 24 24">
          <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
        </symbol>
        <symbol id="lp-i-scan" viewBox="0 0 24 24">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8" />
        </symbol>
        <symbol id="lp-i-home" viewBox="0 0 24 24">
          <path d="M3 11l9-8 9 8M5 10v10h14V10" />
        </symbol>
        <symbol id="lp-i-lock" viewBox="0 0 24 24">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </symbol>
        <symbol id="lp-i-card" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M5 5 19 19" />
        </symbol>
        <symbol id="lp-i-sync" viewBox="0 0 24 24">
          <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M3 21v-5h5M21 3v5h-5" />
        </symbol>
      </defs>
    </svg>
  );
}

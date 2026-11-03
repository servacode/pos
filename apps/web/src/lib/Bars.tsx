import { barcodeModules } from './barcode';

/** The bars as one SVG path: dark runs as rectangles, so it stays sharp at any printer's dots. */
export function Bars({ code, height }: { code: string; height: number }) {
  const { modules } = barcodeModules(code);
  let d = '';
  for (let i = 0; i < modules.length;) {
    if (modules[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (modules[j] === '1') j++;
    d += `M${i} 0h${j - i}v${height}h${i - j}z`;
    i = j;
  }
  return (
    <svg
      viewBox={`0 0 ${modules.length} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`باركود ${code}`}
      className="block h-full w-full"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

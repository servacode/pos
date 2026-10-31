import { useMemo } from 'react';
import { create } from 'qrcode';

/**
 * A QR code drawn as SVG on the page itself, no network and no image: one path of dark modules
 * with the 4-module quiet zone. Medium error correction, enough for a screen photographed at an angle.
 * Always dark modules on a light ground, in dark mode too: many scanners refuse an inverted code.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-4} y={-4} width={size + 8} height={size + 8} className="fill-surface dark:fill-ink" />
      <path d={path} className="fill-ink dark:fill-surface" />
    </svg>
  );
}

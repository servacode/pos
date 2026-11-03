import { barcodeModules } from '../../lib/barcode';
import { DOTS, toBits } from './escpos';
import type { PrintLine } from './lines';

/**
 * Draws the receipt's lines on a canvas the width of the paper, right to left, and gives back its
 * 1-bit rows for the printer. The browser shapes the Arabic, so any printer that takes an image
 * prints it, Arabic font or not.
 */

const FONT = '"IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function renderLines(
  lines: readonly PrintLine[],
  paper: 80 | 58,
  doc: Document = document,
): { bits: Uint8Array; width: number; height: number } | null {
  const width = DOTS[paper];
  const size = paper === 80 ? 26 : 20;
  const pad = 8;
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = 4000;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // A printer image is black dots on white paper, not a themed colour of the screen
  // eslint-disable-next-line no-restricted-syntax
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, canvas.height);
  // eslint-disable-next-line no-restricted-syntax
  ctx.fillStyle = '#000';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';
  let y = pad;
  const font = (bold?: boolean, big?: boolean) =>
    `${bold ? 'bold ' : ''}${big ? Math.round(size * 1.35) : size}px ${FONT}`;
  for (const line of lines) {
    if (line.kind === 'rule') {
      ctx.fillRect(pad, y + size / 2, width - pad * 2, 2);
      y += size;
      continue;
    }
    if (line.kind === 'barcode') {
      // Whole dots per bar, centred, so a scanner reads it at the printer's resolution
      const { modules } = barcodeModules(line.code);
      const bar = Math.max(1, Math.floor((width - pad * 2) / modules.length));
      const left = Math.floor((width - bar * modules.length) / 2);
      const tall = size * 3;
      for (let i = 0; i < modules.length; i++) {
        if (modules[i] === '1') ctx.fillRect(left + i * bar, y, bar, tall);
      }
      y += tall + Math.round(size * 0.4);
      continue;
    }
    if (line.kind === 'pair') {
      ctx.font = font(line.bold);
      ctx.textAlign = 'right';
      ctx.fillText(line.start, width - pad, y);
      ctx.textAlign = 'left';
      ctx.fillText(line.end, pad, y);
      y += Math.round(size * 1.4);
      continue;
    }
    const big = line.kind === 'center' && line.big;
    ctx.font = font(line.bold, big);
    ctx.textAlign = line.kind === 'center' ? 'center' : 'right';
    const x = line.kind === 'center' ? width / 2 : width - pad;
    for (const part of wrap(ctx, line.text, width - pad * 2)) {
      ctx.fillText(part, x, y);
      y += Math.round((big ? size * 1.35 : size) * 1.4);
    }
  }
  const height = Math.min(canvas.height, y + pad);
  const image = ctx.getImageData(0, 0, width, height);
  return { bits: toBits(image.data, width, height), width, height };
}

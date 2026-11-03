/**
 * ESC/POS bytes for a thermal printer (21 › الطباعة المباشرة): the receipt as a raster image
 * (GS v 0), a feed and a cut, and the pulse that opens the cash drawer. Paper is 576 dots wide at
 * 80 mm and 384 at 58 mm (203 dpi).
 */

export const DOTS: Record<80 | 58, number> = { 80: 576, 58: 384 };

const ESC = 0x1b;
const GS = 0x1d;

/** Packs RGBA pixels into 1-bit rows, black where the pixel is darker than the threshold. */
export function toBits(rgba: Uint8ClampedArray, width: number, height: number, threshold = 160): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3]! / 255;
      // Transparent counts as paper (white)
      const luminance =
        (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * alpha + 255 * (1 - alpha);
      if (luminance < threshold) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return bits;
}

/** GS v 0: a raster image, sent in bands so no printer's buffer overflows. */
export function rasterImage(bits: Uint8Array, width: number, height: number, band = 256): Uint8Array[] {
  const rowBytes = Math.ceil(width / 8);
  const parts: Uint8Array[] = [];
  for (let top = 0; top < height; top += band) {
    const rows = Math.min(band, height - top);
    const head = [GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8];
    const body = bits.subarray(top * rowBytes, (top + rows) * rowBytes);
    const part = new Uint8Array(head.length + body.length);
    part.set(head, 0);
    part.set(body, head.length);
    parts.push(part);
  }
  return parts;
}

/** ESC @: back to the printer's defaults */
export const INIT = Uint8Array.of(ESC, 0x40);
/** Feed four lines, then a partial cut (GS V 66 0) */
export const FEED_AND_CUT = Uint8Array.of(ESC, 0x64, 4, GS, 0x56, 66, 0);
/** ESC p 0: a 50 ms pulse on the drawer kick pin, the usual way a cash drawer opens */
export const OPEN_DRAWER = Uint8Array.of(ESC, 0x70, 0, 25, 250);

/** The whole job: init, the image, feed and cut, and the drawer when cash was taken. */
export function printJob(bits: Uint8Array, width: number, height: number, openDrawer: boolean): Uint8Array[] {
  return [INIT, ...rasterImage(bits, width, height), FEED_AND_CUT, ...(openDrawer ? [OPEN_DRAWER] : [])];
}

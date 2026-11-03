/**
 * Pictures resized in the browser before they leave it (03 › الألبسة: صور القطع): a phone photo of
 * 4 MB becomes a JPEG of about 200 KB at most 1600 px on its long side, with a 400 px thumbnail, so
 * the upload is quick on a shop's connection and the store's database stays small.
 */

export interface ResizedImage {
  contentType: 'image/jpeg';
  /** base64, without the data: prefix */
  data: string;
  thumb: string;
  width: number;
  height: number;
}

export const FULL_SIDE = 1600;
export const THUMB_SIDE = 400;

/** The size that fits `side` on the long side, never larger than the original. */
export function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function encode(bitmap: ImageBitmap, side: number, quality: number) {
  const size = fitWithin(bitmap.width, bitmap.height, side);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  // A transparent PNG becomes white, not black, as a JPEG
  // eslint-disable-next-line no-restricted-syntax
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('encode');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), ...size };
}

/** A picture file the cashier or owner picked, ready to send; throws when it is not a picture. */
export async function resizeImage(file: File): Promise<ResizedImage> {
  if (!file.type.startsWith('image/')) throw new Error('not an image');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const full = await encode(bitmap, FULL_SIDE, 0.85);
    const thumb = await encode(bitmap, THUMB_SIDE, 0.8);
    return {
      contentType: 'image/jpeg',
      data: full.data,
      thumb: thumb.data,
      width: full.width,
      height: full.height,
    };
  } finally {
    bitmap.close();
  }
}

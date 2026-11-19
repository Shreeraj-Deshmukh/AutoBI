/**
 * Screenshots for the AI model: decoded and re-encoded in the browser as JPEG data URLs
 * (`data:image/jpeg;base64,...`), small enough to send in one request.
 *
 * Nothing here is stored: the images live in the page's memory until they are sent.
 * The whole request must stay under Vercel's 4.5 MB body limit (the EC2 server allows
 * more), so all images together are kept under BUDGET characters of base64, shrinking
 * them further when needed.
 */

export const MAX_IMAGES = 5;
export const ACCEPTED = 'image/png,image/jpeg,image/webp';
/** Largest file accepted before shrinking. */
export const MAX_FILE_BYTES = 20_000_000;
/** Total base64 characters across all images in one request. */
export const BUDGET = 3_200_000;

/** Long side in pixels and JPEG quality, tried in order until the images fit the budget. */
const STEPS: [number, number][] = [
  [2000, 0.85],
  [1600, 0.8],
  [1280, 0.72],
  [1024, 0.65],
];

export const isImageFile = (f: File) => /^image\/(png|jpe?g|webp)$/.test(f.type);

async function encode(file: Blob, longSide: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, longSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare images.');
    // transparent areas of a PNG become white rather than black in the JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bmp.close();
  }
}

/** A small preview for the thumbnail strip. */
export const thumbnail = (file: Blob) => encode(file, 320, 0.7);

/** Every image as a JPEG data URL, together within BUDGET (largest size that fits). */
export async function encodeForAI(files: Blob[]): Promise<string[]> {
  for (const [side, q] of STEPS) {
    const urls = await Promise.all(files.map((f) => encode(f, side, q)));
    if (urls.reduce((n, u) => n + u.length, 0) <= BUDGET) return urls;
  }
  throw new Error('The screenshots are too large to send together. Remove one or two and try again.');
}

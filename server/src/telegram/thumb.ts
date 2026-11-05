import type { Api } from 'telegram';

const WANT_W = 480;

/** Medium thumbnail: widest size up to 480px, else the smallest one that is bigger. Stripped (tiny) only as last resort. */
export function pickThumb(
  sizes: readonly Api.TypePhotoSize[] | undefined,
): Api.TypePhotoSize | undefined {
  const withW = (sizes ?? []).filter(
    (s): s is Api.TypePhotoSize & { w: number } => 'w' in s && typeof s.w === 'number',
  );
  const fit = withW.filter((s) => s.w <= WANT_W).sort((a, b) => b.w - a.w)[0];
  if (fit) return fit;
  const over = withW.sort((a, b) => a.w - b.w)[0];
  if (over) return over;
  return (sizes ?? []).find((s) => s.className === 'PhotoStrippedSize');
}

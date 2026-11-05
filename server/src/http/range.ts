export const BLOCK = 4096; // Telegram download offsets must be multiples of this
export const REQUEST_SIZE = 512 * 1024;

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number } // inclusive
  | { kind: 'invalid' };

/** Single `bytes=` range only. Anything unparsable or unsatisfiable → invalid (416). */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (header === undefined || header === '') return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '') || size <= 0) return { kind: 'invalid' };

  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]); // suffix: last n bytes
    if (n === 0) return { kind: 'invalid' };
    start = Math.max(size - n, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return { kind: 'invalid' };
  return { kind: 'partial', start, end };
}

/**
 * Yield exactly bytes [start..end] (inclusive). `open(offset)` must return chunks beginning at a
 * `align`-aligned offset, so we start at the block below `start` and trim head/tail ourselves.
 * Telegram needs multiples of 4096; real downloads pass REQUEST_SIZE (512 KB) so a request never
 * straddles a 1 MB boundary.
 */
export async function* sliceRange(
  open: (alignedOffset: number) => AsyncIterable<Uint8Array>,
  start: number,
  end: number,
  align = BLOCK,
): AsyncGenerator<Buffer> {
  const aligned = start - (start % align);
  let pos = aligned;
  for await (const raw of open(aligned)) {
    const chunk = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const from = pos;
    const to = pos + chunk.length - 1;
    pos += chunk.length;
    if (to < start) continue;
    yield chunk.subarray(Math.max(start, from) - from, Math.min(end, to) - from + 1);
    if (to >= end) return;
  }
  throw new Error(`short read: source ended at ${pos - 1}, wanted ${end}`);
}

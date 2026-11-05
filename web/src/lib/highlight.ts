export interface Seg {
  text: string;
  hit: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** plain search words of a query (#tag words are tag filters, not text to highlight) */
export const terms = (q: string | undefined): string[] =>
  (q ?? '')
    .normalize('NFC')
    .split(/\s+/)
    .filter((w) => w && !w.startsWith('#'));

/** Split text into matched / unmatched parts. Thai has no word breaks, so plain substring match. */
export function splitHighlight(text: string, q: string | undefined): Seg[] {
  const ts = terms(q);
  const src = text.normalize('NFC');
  if (!ts.length || !src) return [{ text: src, hit: false }];
  const re = new RegExp(
    ts
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|'),
    'giu',
  );
  const out: Seg[] = [];
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), hit: false });
  return out;
}

/** A short excerpt around the first match (for long descriptions); falls back to the start. */
export function snippet(text: string, q: string | undefined, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const ts = terms(q);
  const lower = flat.toLowerCase();
  const at = ts
    .map((t) => lower.indexOf(t.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined || at < max / 3) return flat.slice(0, max).trimEnd() + '…';
  const from = at - Math.floor(max / 3);
  return '…' + flat.slice(from, from + max).trim() + '…';
}

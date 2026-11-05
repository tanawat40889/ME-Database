export const HASHTAG = /#[\p{L}\p{M}\p{N}_]+/gu;

export const normalize = (s: string): string =>
  s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

export function extractTags(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.match(HASHTAG) ?? []) out.add(m.slice(1).toLowerCase().normalize('NFC'));
  }
  return [...out];
}

const stripTags = (s: string): string => s.replace(HASHTAG, '').replace(/\s+/g, ' ').trim();

/** First non-empty line (hashtags removed) of caption, then description; else file name. */
export function makeTitle(caption: string, description: string, fileName?: string): string {
  for (const line of `${caption}\n${description}`.split('\n')) {
    const t = stripTags(line);
    if (t) return t.slice(0, 200);
  }
  return fileName ?? '';
}

export const buildSearchText = (parts: (string | undefined)[]): string =>
  normalize(parts.filter(Boolean).join(' '));

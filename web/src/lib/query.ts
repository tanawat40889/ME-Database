export type Chip = 'all' | 'video' | 'pdf' | 'image' | 'fav';

export const CHIPS: { id: Chip; label: string; type?: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'video', label: 'วิดีโอ', type: 'video' },
  { id: 'pdf', label: 'PDF', type: 'pdf' },
  { id: 'image', label: 'ภาพ', type: 'image,album' },
  { id: 'fav', label: '⭐' },
];

export interface ListParams {
  category?: string;
  q?: string;
  type?: string;
  tag?: string;
  fav?: boolean;
}

export function paramsFromSearch(sp: URLSearchParams, category?: string): ListParams {
  return {
    category,
    q: sp.get('q')?.trim() || undefined,
    type: sp.get('type') || undefined,
    tag: sp.get('tag') || undefined,
    fav: sp.get('fav') === '1' || undefined,
  };
}

export function chipOf(p: ListParams): Chip {
  if (p.fav) return 'fav';
  return CHIPS.find((c) => c.type && c.type === p.type)?.id ?? 'all';
}

/** new URL params with the chip applied (chips are mutually exclusive) */
export function withChip(sp: URLSearchParams, chip: Chip): URLSearchParams {
  const n = new URLSearchParams(sp);
  n.delete('type');
  n.delete('fav');
  const c = CHIPS.find((x) => x.id === chip);
  if (chip === 'fav') n.set('fav', '1');
  else if (c?.type) n.set('type', c.type);
  return n;
}

export function withParam(
  sp: URLSearchParams,
  key: string,
  value: string | undefined,
): URLSearchParams {
  const n = new URLSearchParams(sp);
  if (value) n.set(key, value);
  else n.delete(key);
  return n;
}

export const listKey = (p: ListParams): string =>
  JSON.stringify([p.category ?? '', p.q ?? '', p.type ?? '', p.tag ?? '', p.fav ? 1 : 0]);

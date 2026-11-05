import { normalize } from './text.js';
import type { Item, ItemType } from './types.js';

export interface Query {
  category?: string;
  type?: ItemType | ItemType[]; // several = any of them (e.g. the web's "ภาพ" chip = image + album)
  q?: string;
  tag?: string;
  fav?: boolean;
  sort?: 'new' | 'old';
  cursor?: string;
  limit?: number;
}

export interface Page {
  items: Item[];
  nextCursor: string | null;
}

const cmp = (a: Item, b: Item): number =>
  a.postedAt < b.postedAt
    ? -1
    : a.postedAt > b.postedAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export function filterItems(all: Iterable<Item>, q: Query): Item[] {
  const terms: string[] = [];
  const tags: string[] = [];
  if (q.tag) tags.push(normalize(q.tag.replace(/^#/, '')));
  for (const w of normalize(q.q ?? '').split(' ')) {
    if (!w) continue;
    if (w.startsWith('#')) {
      if (w.length > 1) tags.push(w.slice(1));
    } else terms.push(w);
  }

  const types = q.type === undefined ? null : new Set([q.type].flat());
  const out: Item[] = [];
  for (const it of all) {
    if (q.category && it.categoryId !== q.category) continue;
    if (types && !types.has(it.type)) continue;
    if (q.fav && !it.favorite) continue;
    if (tags.some((t) => !it.tags.includes(t))) continue;
    if (terms.some((t) => !it.searchText.includes(t))) continue;
    out.push(it);
  }
  return out;
}

export function searchItems(all: Iterable<Item>, q: Query = {}): Page {
  const dir = q.sort === 'old' ? 1 : -1;
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 60);
  let list = filterItems(all, q).sort((a, b) => dir * cmp(a, b));

  if (q.cursor) {
    const [postedAt, ...rest] = q.cursor.split('|');
    const key = { postedAt, id: rest.join('|') } as Item;
    list = list.filter((it) => dir * cmp(it, key) > 0);
  }

  const items = list.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = list.length > limit && last ? `${last.postedAt}|${last.id}` : null;
  return { items, nextCursor };
}

export function listTags(all: Iterable<Item>, category?: string): { tag: string; count: number }[] {
  const n = new Map<string, number>();
  for (const it of all) {
    if (category && it.categoryId !== category) continue;
    for (const t of it.tags) n.set(t, (n.get(t) ?? 0) + 1);
  }
  return [...n]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}

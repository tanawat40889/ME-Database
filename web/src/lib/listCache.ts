import type { Item } from '../types';

export interface Entry {
  items: Item[];
  next: string | null;
  done: boolean;
  scrollY: number;
}

const MAX = 12;
const m = new Map<string, Entry>();

/** Keeps filter results + scroll position so "back" from a viewer lands exactly where you were. */
export const listCache = {
  get: (k: string) => m.get(k),
  set(k: string, e: Omit<Entry, 'scrollY'>) {
    const prev = m.get(k);
    m.delete(k);
    m.set(k, { ...e, scrollY: prev?.scrollY ?? 0 });
    while (m.size > MAX) m.delete(m.keys().next().value!);
  },
  setScroll(k: string, y: number) {
    const e = m.get(k);
    if (e) e.scrollY = y;
  },
  patch(it: Item) {
    for (const e of m.values()) e.items = e.items.map((x) => (x.id === it.id ? it : x));
  },
  clear: () => m.clear(),
};

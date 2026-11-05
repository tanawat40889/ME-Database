import type { Item } from '../types';
import { listCache } from './listCache';

type Fn = (it: Item) => void;
const subs = new Set<Fn>();

/** broadcast an updated item (e.g. favorite toggled) to open lists, the viewer and the list cache */
export function emitItem(it: Item): void {
  listCache.patch(it);
  subs.forEach((f) => f(it));
}
export function onItem(f: Fn): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

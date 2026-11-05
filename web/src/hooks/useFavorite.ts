import { useCallback, useRef } from 'react';
import { api, ApiError } from '../api';
import { emitItem } from '../lib/itemEvents';
import { useToast } from '../toast';
import type { Item } from '../types';

/** Optimistic ❤️ toggle: update everywhere at once, PUT, roll back + toast on error. */
export function useFavorite() {
  const toast = useToast();
  const pending = useRef(new Set<string>());
  return useCallback(
    async (item: Item) => {
      if (pending.current.has(item.id)) return;
      pending.current.add(item.id);
      emitItem({ ...item, favorite: !item.favorite });
      try {
        emitItem(await api.setFavorite(item.id, !item.favorite));
      } catch (e) {
        emitItem(item);
        toast(e instanceof ApiError ? e.message : 'กด ❤️ ไม่สำเร็จ');
      } finally {
        pending.current.delete(item.id);
      }
    },
    [toast],
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { onItem } from '../lib/itemEvents';
import { listCache } from '../lib/listCache';
import { listKey, type ListParams } from '../lib/query';
import type { Item } from '../types';

interface S {
  key: string;
  items: Item[];
  next: string | null;
  done: boolean;
  loading: boolean;
  error: string | null;
  indexing: boolean;
}

const fresh = (key: string): S => ({
  key,
  items: [],
  next: null,
  done: false,
  loading: false,
  error: null,
  indexing: false,
});

const fromCache = (key: string): S => {
  const c = listCache.get(key);
  return c ? { ...fresh(key), items: c.items, next: c.next, done: c.done } : fresh(key);
};

export function useItemList(params: ListParams) {
  const key = listKey(params);
  const [s, setS] = useState<S>(() => fromCache(key));
  const live = useRef({ key, params });
  live.current = { key, params };
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sRef = useRef(s);
  sRef.current = s;
  const inflight = useRef<string | null>(null);

  const fetchPage = useCallback((k: string, cursor: string | null) => {
    const p = live.current.params;
    inflight.current = k;
    setS((x) => (x.key === k ? { ...x, loading: true, error: null, indexing: false } : x));
    api
      .items({
        category: p.category,
        q: p.q,
        type: p.type,
        tag: p.tag,
        fav: p.fav,
        cursor: cursor ?? undefined,
        limit: 30,
      })
      .then(
        (page) => {
          if (inflight.current === k) inflight.current = null;
          if (live.current.key !== k) return; // filters changed meanwhile
          setS((x) =>
            x.key !== k
              ? x
              : {
                  ...x,
                  loading: false,
                  items: cursor
                    ? [...x.items, ...page.items.filter((n) => !x.items.some((o) => o.id === n.id))]
                    : page.items,
                  next: page.nextCursor,
                  done: page.nextCursor === null,
                },
          );
        },
        (e: unknown) => {
          if (inflight.current === k) inflight.current = null;
          if (live.current.key !== k) return;
          if (e instanceof ApiError && e.status === 503) {
            setS((x) => (x.key === k ? { ...x, loading: false, indexing: true } : x));
            retry.current = setTimeout(() => fetchPage(k, cursor), 4000);
          } else if (!(e instanceof ApiError && e.status === 401)) {
            setS((x) =>
              x.key === k
                ? { ...x, loading: false, error: e instanceof Error ? e.message : 'error' }
                : x,
            );
          }
        },
      );
  }, []);

  // filters changed: show cached results at once, otherwise load page 1
  useEffect(() => {
    clearTimeout(retry.current);
    const next = fromCache(key);
    setS(next);
    if (!listCache.get(key)) fetchPage(key, null);
    return () => clearTimeout(retry.current);
  }, [key, fetchPage]);

  // remember results for "back"
  useEffect(() => {
    if (s.key === key && s.items.length)
      listCache.set(key, { items: s.items, next: s.next, done: s.done });
  }, [s, key]);

  // favorite toggled somewhere else
  useEffect(
    () =>
      onItem((it) => setS((x) => ({ ...x, items: x.items.map((o) => (o.id === it.id ? it : o)) }))),
    [],
  );

  const view = s.key === key ? s : fresh(key);
  const loadMore = useCallback(() => {
    const x = sRef.current;
    if (x.key !== live.current.key || inflight.current === x.key) return;
    if (!x.loading && !x.done && !x.indexing && x.next) fetchPage(x.key, x.next);
  }, [fetchPage]);

  const reload = useCallback(() => {
    listCache.clear();
    fetchPage(live.current.key, null);
  }, [fetchPage]);

  return { ...view, loadMore, reload };
}

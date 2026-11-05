import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Category } from '../types';

let cache: Category[] | null = null;

/** categories with retry while the server is still building its first index (503) */
export function useCategories() {
  const [cats, setCats] = useState<Category[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.categories().then(
        (c) => {
          cache = c;
          if (!alive) return;
          setCats(c);
          setError(null);
          setIndexing(false);
        },
        (e: unknown) => {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 503) {
            setIndexing(true);
            timer = setTimeout(load, 4000);
          } else if (!(e instanceof ApiError && e.status === 401))
            setError(e instanceof Error ? e.message : 'error');
        },
      );
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return { cats, error, indexing };
}

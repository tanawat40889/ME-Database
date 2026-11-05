import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { BackIcon, SearchIcon } from '../components/icons';
import { ItemCard } from '../components/ItemCard';
import { useCategories } from '../hooks/useCategories';
import { useFavorite } from '../hooks/useFavorite';
import { useItemList } from '../hooks/useItemList';
import { listCache } from '../lib/listCache';
import { CHIPS, chipOf, listKey, paramsFromSearch, withChip, withParam } from '../lib/query';
import type { TagCount } from '../types';

const chipCls = (on: boolean) =>
  `h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${on ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-700 ring-1 ring-black/10 dark:bg-neutral-900 dark:text-neutral-200 dark:ring-white/15'}`;

export function ItemList({ mode }: { mode: 'category' | 'all' }) {
  const { cid } = useParams();
  const category = mode === 'category' ? cid : undefined;
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => paramsFromSearch(sp, category), [sp, category]);
  const key = listKey(params);
  const list = useItemList(params);
  const { cats } = useCategories();
  const fav = useFavorite();

  // search box: type freely, URL (and the request) follows after 300 ms
  const [text, setText] = useState(params.q ?? '');
  useEffect(() => {
    setText(params.q ?? '');
  }, [params.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== (params.q ?? ''))
        setSp(withParam(sp, 'q', text.trim() || undefined), { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [text, params.q, sp, setSp]);

  // tags of this category (or of everything)
  const [tags, setTags] = useState<TagCount[]>([]);
  useEffect(() => {
    let alive = true;
    api.tags(category).then(
      (t) => alive && setTags(t.slice(0, 40)),
      () => alive && setTags([]),
    );
    return () => {
      alive = false;
    };
  }, [category]);

  // restore scroll when coming back from a viewer, otherwise start at the top
  useLayoutEffect(() => {
    window.scrollTo(0, listCache.get(key)?.scrollY ?? 0);
  }, [key]);
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => listCache.setScroll(keyRef.current, window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), {
      rootMargin: '800px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, list.items.length, list.done]);

  const cat = cats?.find((c) => c.id === category);
  const title = cat
    ? `${cat.emoji ?? ''} ${cat.groupName ? cat.groupName + ' › ' : ''}${cat.name}`.trim()
    : params.fav
      ? '⭐ Favorites ทั้งหมด'
      : params.q
        ? 'ผลการค้นหา'
        : category
          ? '…'
          : 'ทุกหมวด';
  const chip = chipOf(params);

  return (
    <main className="mx-auto max-w-5xl pb-10">
      <header className="sticky top-0 z-10 space-y-2 bg-neutral-50/90 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur dark:bg-neutral-950/90">
        <div className="flex items-center gap-1">
          <Link
            to="/"
            aria-label="กลับหน้าหลัก"
            className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
          >
            <BackIcon />
          </Link>
          <h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
        </div>
        <label className="relative block">
          <span className="sr-only">ค้นหา</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={category ? 'ค้นหาในหมวดนี้' : 'ค้นหา'}
            className="h-11 w-full rounded-xl border border-neutral-300 bg-white pr-4 pl-11 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          role="group"
          aria-label="ตัวกรองชนิด"
        >
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chip === c.id}
              className={chipCls(chip === c.id)}
              onClick={() => setSp(withChip(sp, c.id), { replace: true })}
            >
              {c.label}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <div
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
            role="group"
            aria-label="แท็ก"
          >
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                aria-pressed={params.tag === t.tag}
                onClick={() =>
                  setSp(withParam(sp, 'tag', params.tag === t.tag ? undefined : t.tag), {
                    replace: true,
                  })
                }
                className={`h-8 shrink-0 rounded-full px-3 text-xs font-medium ${params.tag === t.tag ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-200/70 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'}`}
              >
                #{t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 px-4 pt-2 sm:grid-cols-3 lg:grid-cols-4">
        {list.items.map((it) => (
          <ItemCard key={it.id} item={it} q={params.q} onFav={fav} />
        ))}
      </div>

      <div ref={sentinel} className="px-4 py-6 text-center text-sm text-neutral-500">
        {list.indexing && 'กำลังสร้างดัชนีจาก Telegram — รอสักครู่'}
        {list.loading && 'กำลังโหลด…'}
        {list.error && (
          <button
            type="button"
            onClick={list.reload}
            className="rounded-lg px-3 py-2 text-rose-600 underline"
          >
            {list.error} — ลองใหม่
          </button>
        )}
        {!list.loading &&
          !list.error &&
          !list.indexing &&
          list.done &&
          list.items.length === 0 &&
          'ไม่พบรายการ'}
      </div>
    </main>
  );
}

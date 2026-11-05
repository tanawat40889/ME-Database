import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SearchIcon } from '../components/icons';
import { useCategories } from '../hooks/useCategories';
import type { Category } from '../types';

function CatCard({ c, sub }: { c: Category; sub?: string }) {
  return (
    <Link
      to={`/c/${encodeURIComponent(c.id)}`}
      className="flex min-h-20 items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-black/5 transition active:scale-[0.99] dark:bg-neutral-900 dark:ring-white/10"
    >
      <span
        className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-100 text-2xl dark:bg-neutral-800"
        aria-hidden
      >
        {c.emoji ?? '📁'}
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 block font-medium break-words">{c.name}</span>
        <span className="block text-xs text-neutral-500 dark:text-neutral-400">
          {c.count.toLocaleString('th-TH')} ไฟล์{c.favorites ? ` · ❤️ ${c.favorites}` : ''}
          {sub}
          {c.closed ? ' · ปิดแล้ว' : ''}
        </span>
      </span>
    </Link>
  );
}

export function Home() {
  const nav = useNavigate();
  const { cats, error, indexing } = useCategories();
  const [q, setQ] = useState('');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const { plain, groups, favs } = useMemo(() => {
    const plain: Category[] = [];
    const g = new Map<string, { name: string; cats: Category[] }>();
    let favs = 0;
    for (const c of cats ?? []) {
      favs += c.favorites;
      if (c.groupName === null) plain.push(c);
      else
        (
          g.get(c.chatId) ?? g.set(c.chatId, { name: c.groupName, cats: [] }).get(c.chatId)!
        ).cats.push(c);
    }
    return { plain, groups: [...g.values()], favs };
  }, [cats]);

  function search(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (t) nav(`/all?q=${encodeURIComponent(t)}`);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <form
        onSubmit={search}
        role="search"
        className="sticky top-0 z-10 -mx-4 mb-4 bg-neutral-50/90 px-4 py-3 backdrop-blur dark:bg-neutral-950/90"
      >
        <label className="relative block">
          <span className="sr-only">ค้นหาทุกหมวด</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาทุกหมวด"
            className="h-12 w-full rounded-xl border border-neutral-300 bg-white pr-4 pl-11 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </form>

      <Link
        to="/all?fav=1"
        className="mb-6 flex min-h-14 items-center justify-between rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 px-4 font-medium text-white shadow-sm transition active:scale-[0.99]"
      >
        <span>⭐ Favorites ทั้งหมด</span>
        <span className="text-sm opacity-90 tabular-nums">
          {cats ? favs.toLocaleString('th-TH') : ''}
        </span>
      </Link>

      {indexing && (
        <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
          กำลังสร้างดัชนีจาก Telegram ครั้งแรก — รอสักครู่ หน้านี้จะอัปเดตเอง
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-rose-100 p-3 text-sm text-rose-900 dark:bg-rose-500/20 dark:text-rose-100"
        >
          {error}
        </p>
      )}
      {!cats && !error && !indexing && <p className="text-neutral-500">กำลังโหลด…</p>}
      {cats && cats.length === 0 && (
        <p className="text-neutral-500">
          ยังไม่พบกลุ่ม TBackup — สร้างกลุ่ม private ที่ชื่อขึ้นต้นด้วย TBackup ใน Telegram
        </p>
      )}

      {plain.length > 0 && (
        <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plain.map((c) => (
            <CatCard key={c.id} c={c} />
          ))}
        </section>
      )}
      {groups.map((g) => (
        <section key={g.name} className="mb-8">
          <h2 className="mb-3 px-1 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            {g.name}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.cats.map((c) => (
              <CatCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

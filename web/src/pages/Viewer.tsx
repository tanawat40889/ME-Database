import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, fileUrl, thumbUrl } from '../api';
import { HeartButton } from '../components/HeartButton';
import { BackIcon, ExternalIcon, FileIcon } from '../components/icons';
import { useBack } from '../hooks/useBack';
import { useFavorite } from '../hooks/useFavorite';
import { fmtDate, fmtDuration, fmtSize } from '../lib/format';
import { onItem } from '../lib/itemEvents';
import type { Item } from '../types';
import { AlbumViewer } from './AlbumViewer';

const PdfViewer = lazy(() => import('./PdfViewer'));

function Media({ item }: { item: Item }) {
  const url = fileUrl(item.chatId, item.messageIds[0]);
  switch (item.type) {
    case 'video':
      return (
        <div className="bg-black">
          <video
            src={url}
            poster={thumbUrl(item)}
            controls
            preload="metadata"
            playsInline
            className="mx-auto max-h-[72dvh] w-full"
          />
        </div>
      );
    case 'image':
      return (
        <div className="bg-black">
          <img
            src={url}
            alt={item.title}
            className="mx-auto max-h-[78dvh] max-w-full object-contain"
          />
        </div>
      );
    case 'album':
      return <AlbumViewer item={item} />;
    case 'pdf':
      return (
        <>
          <div className="flex justify-end px-4 py-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/15"
            >
              <ExternalIcon className="size-4" /> เปิดในแท็บใหม่
            </a>
          </div>
          <Suspense
            fallback={
              <p className="p-6 text-center text-sm text-neutral-500">กำลังโหลดตัวอ่าน PDF…</p>
            }
          >
            <PdfViewer url={url} />
          </Suspense>
        </>
      );
    default:
      return (
        <div className="grid place-items-center gap-3 px-4 py-14 text-center">
          <FileIcon className="size-12 text-neutral-400" />
          <p className="break-all">{item.fileName ?? item.title}</p>
          <a
            href={url}
            download
            className="inline-flex h-12 items-center rounded-xl bg-indigo-600 px-6 font-medium text-white"
          >
            ดาวน์โหลด {fmtSize(item.size)}
          </a>
        </div>
      );
  }
}

export function Viewer() {
  const { id = '' } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const back = useBack('/');
  const fav = useFavorite();

  useEffect(() => {
    window.scrollTo(0, 0);
    let alive = true;
    setItem(null);
    setErr(null);
    api.item(id).then(
      (it) => alive && setItem(it),
      (e: unknown) =>
        alive &&
        !(e instanceof ApiError && e.status === 401) &&
        setErr(
          e instanceof ApiError && e.status === 404
            ? 'ไม่พบรายการนี้ (อาจถูกลบแล้ว)'
            : e instanceof Error
              ? e.message
              : 'error',
        ),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => onItem((it) => setItem((x) => (x && x.id === it.id ? it : x))), []);

  const meta =
    item &&
    [
      fmtDate(item.postedAt),
      item.type === 'video' && fmtDuration(item.duration),
      item.size !== undefined && item.type !== 'album' && fmtSize(item.size),
      item.type === 'album' && `${item.messageIds.length} ไฟล์`,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <main className="mx-auto max-w-4xl pb-16">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-neutral-50/90 px-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1 backdrop-blur dark:bg-neutral-950/90">
        <button
          type="button"
          onClick={back}
          aria-label="กลับ"
          className="grid size-11 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
        >
          <BackIcon />
        </button>
        {item && (
          <HeartButton
            on={item.favorite}
            onToggle={() => fav(item)}
            className={item.favorite ? '' : '!text-neutral-500 dark:!text-neutral-300'}
          />
        )}
      </header>

      {err && (
        <p role="alert" className="p-6 text-center text-rose-600">
          {err}
        </p>
      )}
      {!item && !err && <p className="p-6 text-center text-neutral-500">กำลังโหลด…</p>}
      {item && (
        <>
          <Media key={item.id} item={item} />
          <section className="space-y-3 px-4 pt-4">
            <h1 className="text-xl font-semibold leading-snug break-words">{item.title}</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{meta}</p>
            {item.caption && item.caption.trim() !== item.title && (
              <p className="whitespace-pre-wrap break-words">{item.caption}</p>
            )}
            {item.description && (
              <p className="whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
                {item.description}
              </p>
            )}
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {item.tags.map((t) => (
                  <Link
                    key={t}
                    to={`/c/${encodeURIComponent(item.categoryId)}?tag=${encodeURIComponent(t)}`}
                    className="inline-flex h-8 items-center rounded-full bg-neutral-200/70 px-3 text-xs font-medium dark:bg-neutral-800"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

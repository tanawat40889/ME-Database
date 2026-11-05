import { useCallback, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { ChevronIcon } from '../components/icons';
import type { Item } from '../types';

/** swipe / arrow keys / buttons; shows "3/8"; preloads the next photo */
export function AlbumViewer({ item }: { item: Item }) {
  const list = item.albumItems ?? [];
  const [i, setI] = useState(0);
  const go = useCallback(
    (d: number) => setI((x) => Math.min(list.length - 1, Math.max(0, x + d))),
    [list.length],
  );
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useEffect(() => {
    for (const j of [i + 1, i - 1]) {
      const n = list[j];
      if (n?.type === 'image') new Image().src = fileUrl(item.chatId, n.messageId);
    }
  }, [i, list, item.chatId]);

  const cur = list[i];
  if (!cur) return null;
  const src = fileUrl(item.chatId, cur.messageId);

  return (
    <div
      className="relative touch-pan-y bg-black select-none"
      onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5)
          go(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (start.current = null)}
    >
      <div className="grid h-[68dvh] place-items-center">
        {cur.type === 'video' ? (
          <video
            key={src}
            src={src}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            key={src}
            src={src}
            alt={`${item.title} (${i + 1}/${list.length})`}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
      <div
        className="absolute top-3 left-3 rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white tabular-nums"
        aria-live="polite"
      >
        {i + 1}/{list.length}
      </div>
      {i > 0 && (
        <button
          type="button"
          aria-label="รูปก่อนหน้า"
          onClick={() => go(-1)}
          className="absolute top-1/2 left-2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white md:grid"
        >
          <ChevronIcon dir="left" />
        </button>
      )}
      {i < list.length - 1 && (
        <button
          type="button"
          aria-label="รูปถัดไป"
          onClick={() => go(1)}
          className="absolute top-1/2 right-2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white md:grid"
        >
          <ChevronIcon />
        </button>
      )}
    </div>
  );
}

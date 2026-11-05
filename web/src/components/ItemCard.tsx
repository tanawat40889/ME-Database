import { memo } from 'react';
import { Link } from 'react-router-dom';
import { fmtDuration } from '../lib/format';
import { snippet, terms } from '../lib/highlight';
import type { Item } from '../types';
import { Highlight } from './Highlight';
import { HeartButton } from './HeartButton';
import { AlbumIcon, PlayIcon } from './icons';
import { Thumb } from './Thumb';

function Badge({ item }: { item: Item }) {
  const cls =
    'absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums';
  if (item.type === 'video') {
    return (
      <span className={cls}>
        <PlayIcon className="size-3" />
        {fmtDuration(item.duration)}
      </span>
    );
  }
  if (item.type === 'album') {
    return (
      <span className={cls}>
        <AlbumIcon className="size-3" />
        {item.messageIds.length}
      </span>
    );
  }
  if (item.type === 'pdf') return <span className={cls}>PDF</span>;
  return null;
}

function ItemCardImpl({ item, q, onFav }: { item: Item; q?: string; onFav: (it: Item) => void }) {
  const descMatch = terms(q).some((t) => item.description.toLowerCase().includes(t.toLowerCase()));
  const desc = item.description && (descMatch || !q) ? snippet(item.description, q) : '';
  return (
    <article className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
      <Link
        to={`/v/${encodeURIComponent(item.id)}`}
        className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500"
      >
        <div className="relative">
          <Thumb item={item} className="aspect-video" />
          <Badge item={item} />
        </div>
        <div className="space-y-0.5 p-2.5">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug break-words">
            <Highlight text={item.title} q={q} />
          </h3>
          {desc && (
            <p className="line-clamp-2 text-xs text-neutral-500 break-words dark:text-neutral-400">
              <Highlight text={desc} q={q} />
            </p>
          )}
        </div>
      </Link>
      <HeartButton
        on={item.favorite}
        onToggle={() => onFav(item)}
        className="absolute top-0 right-0 bg-gradient-to-bl from-black/40 to-transparent"
      />
    </article>
  );
}

export const ItemCard = memo(ItemCardImpl);

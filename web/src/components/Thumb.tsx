import { useState } from 'react';
import { thumbUrl } from '../api';
import type { Item } from '../types';
import { TypeIcon } from './icons';

/** server thumbnail (404 for PDFs / files without one → type icon) */
export function Thumb({ item, className = '' }: { item: Item; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-neutral-200 dark:bg-neutral-800 ${className}`}>
      {broken ? (
        <div className="grid size-full place-items-center text-neutral-400 dark:text-neutral-500">
          <TypeIcon type={item.type} className="size-10" />
        </div>
      ) : (
        <img
          src={thumbUrl(item)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

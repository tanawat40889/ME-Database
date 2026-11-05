import type { IndexStore } from './store.js';
import type { RawMsg } from './types.js';

export type LiveEvent =
  | { t: 'msg'; msg: RawMsg } // new or edited media/text message
  | { t: 'delete'; chatId: string | null; ids: number[] } // null = basic group (no chat id in update)
  | { t: 'reaction'; chatId: string; id: number; favorite: boolean }
  | {
      t: 'topic';
      chatId: string;
      topicId: number;
      create: boolean;
      title?: string;
      iconEmojiId?: string;
      emoji?: string;
      closed?: boolean;
    }
  | { t: 'reconcile' }; // group rules may have changed: rename, public, join/leave, forum toggle, migrate

export interface Applied {
  rebuild: Set<string>;
  changed: boolean;
}

/** Apply one event to the store. Items are rebuilt later (coalesced) for the returned categories. */
export function applyEvent(store: IndexStore, ev: LiveEvent, prefix: string): Applied {
  const none: Applied = { rebuild: new Set(), changed: false };
  switch (ev.t) {
    case 'msg': {
      const { chatId, topicId } = ev.msg;
      if (!store.chats.has(chatId)) return none; // chat not scanned yet; its scan will pick this up
      store.ensureCategory(chatId, topicId, prefix);
      return { rebuild: store.upsert([ev.msg]), changed: true };
    }
    case 'delete': {
      const rebuild = store.remove(ev.chatId, ev.ids);
      return { rebuild, changed: rebuild.size > 0 };
    }
    case 'reaction': {
      const cat = store.setFavorite(ev.chatId, ev.id, ev.favorite);
      return { rebuild: new Set(cat ? [cat] : []), changed: !!cat };
    }
    case 'topic': {
      if (!store.chats.has(ev.chatId)) return none;
      const cat = store.ensureCategory(ev.chatId, ev.topicId, prefix);
      store.setCategory({
        ...cat,
        ...(ev.title !== undefined && { name: ev.title }),
        ...(ev.emoji !== undefined && { emoji: ev.emoji }),
        ...(ev.closed !== undefined ? { closed: ev.closed } : ev.create && { closed: false }),
      });
      return { rebuild: new Set(), changed: true };
    }
    case 'reconcile':
      return none;
  }
}

/** Coalesces rebuilds (an album of 10 photos = 10 events, 1 rebuild) and buffers events during a rescan. */
export class LiveIndex {
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private buffer: LiveEvent[] | null = null;

  constructor(
    private getStore: () => IndexStore,
    private prefix: string,
    private onChange: () => void,
    private flushMs = 300,
  ) {}

  apply(ev: LiveEvent): void {
    this.buffer?.push(ev);
    const r = applyEvent(this.getStore(), ev, this.prefix);
    for (const c of r.rebuild) this.dirty.add(c);
    if (r.changed && !this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const store = this.getStore();
    for (const c of this.dirty) store.rebuildCategory(c);
    this.dirty.clear();
    this.onChange();
  }

  startBuffering(): void {
    this.buffer = [];
  }

  /** Stop buffering and return what arrived meanwhile (to replay onto a freshly scanned store). */
  stopBuffering(): LiveEvent[] {
    const b = this.buffer ?? [];
    this.buffer = null;
    return b;
  }
}

/** Replay buffered events onto `store` (idempotent) and rebuild what they touched. */
export function replay(store: IndexStore, events: LiveEvent[], prefix: string): void {
  const touched = new Set<string>();
  for (const ev of events) for (const c of applyEvent(store, ev, prefix).rebuild) touched.add(c);
  for (const c of touched) store.rebuildCategory(c);
}

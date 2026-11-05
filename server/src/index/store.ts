import { categoryName } from '../telegram/vault.js';
import { buildItems } from './build.js';
import { SNAPSHOT_VERSION, type Snapshot } from './snapshot.js';
import { categoryId, type Category, type ChatMeta, type Item, type RawMsg } from './types.js';

/** Bot-API style peer ids: channels/supergroups are <= -1e12, basic groups are small negatives. */
const isChannelPeerId = (id: string): boolean => BigInt(id) <= -1000000000000n;

export class IndexStore {
  chats = new Map<string, ChatMeta>();
  categories = new Map<string, Category>();
  private msgs = new Map<string, Map<number, RawMsg>>(); // by categoryId
  private items = new Map<string, Item>();
  private itemIds = new Map<string, string[]>(); // categoryId → item ids

  constructor(private windowMin = 0) {}

  setChat(c: ChatMeta): void {
    this.chats.set(c.id, c);
  }

  setCategory(c: Category): void {
    this.categories.set(c.id, c);
  }

  /** Create a placeholder category (e.g. message in a topic we have not listed yet). */
  ensureCategory(chatId: string, topicId: number | null, prefix: string): Category {
    const id = categoryId(chatId, topicId);
    const have = this.categories.get(id);
    if (have) return have;
    const chat = this.chats.get(chatId);
    const siblings = [...this.categories.values()].filter((c) => c.chatId === chatId);
    const cat: Category = {
      id,
      chatId,
      topicId,
      name:
        topicId === null
          ? categoryName(chat?.title ?? '', prefix)
          : topicId === 1
            ? 'General'
            : `Topic ${topicId}`,
      groupName: topicId === null ? null : categoryName(chat?.title ?? '', prefix),
      order: siblings.reduce((n, c) => Math.max(n, c.order + 1), 0),
    };
    this.categories.set(id, cat);
    return cat;
  }

  lastId(chatId: string): number {
    return this.chats.get(chatId)?.lastId ?? 0;
  }

  /** Insert/replace messages; returns the categories whose items need rebuilding. */
  upsert(batch: RawMsg[]): Set<string> {
    const touched = new Set<string>();
    for (const m of batch) {
      const cat = categoryId(m.chatId, m.topicId);
      let bucket = this.msgs.get(cat);
      if (!bucket) this.msgs.set(cat, (bucket = new Map()));
      bucket.set(m.id, m);
      touched.add(cat);
      const chat = this.chats.get(m.chatId);
      if (chat && m.id > chat.lastId) chat.lastId = m.id;
    }
    return touched;
  }

  private bucketsOf(chatId: string | null): [string, Map<number, RawMsg>][] {
    // null = delete event without chat id (basic groups): every non-channel chat
    return [...this.msgs].filter(([cat]) => {
      const chat = cat.split(':')[0];
      return chatId === null ? !isChannelPeerId(chat) : chat === chatId;
    });
  }

  /**
   * Remove deleted messages. A deleted media (whole album) leaves a tombstone so the text that
   * followed it is never re-attached to the previous media. Returns touched categories.
   */
  remove(chatId: string | null, ids: number[]): Set<string> {
    const want = new Set(ids);
    const touched = new Set<string>();
    for (const [cat, bucket] of this.bucketsOf(chatId)) {
      const gone = [...bucket.values()]
        .filter((m) => want.has(m.id) && m.kind !== 'tombstone')
        .sort((a, b) => a.id - b.id);
      if (!gone.length) continue;
      touched.add(cat);
      for (const m of gone) bucket.delete(m.id);
      const ghosted = new Set<string>();
      for (const m of gone) {
        if (m.kind !== 'media') continue;
        if (m.groupedId) {
          if (ghosted.has(m.groupedId)) continue;
          const alive = [...bucket.values()].some(
            (x) => x.kind === 'media' && x.groupedId === m.groupedId,
          );
          if (alive) continue;
          ghosted.add(m.groupedId);
        }
        bucket.set(m.id, {
          id: m.id,
          chatId: m.chatId,
          topicId: m.topicId,
          date: m.date,
          kind: 'tombstone',
          text: '',
          favorite: false,
        });
      }
    }
    return touched;
  }

  /** Update favorite flag of a stored media message. Returns the touched category or null. */
  setFavorite(chatId: string, msgId: number, favorite: boolean): string | null {
    for (const [cat, bucket] of this.bucketsOf(chatId)) {
      const m = bucket.get(msgId);
      if (m && m.kind === 'media') {
        if (m.favorite === favorite) return null;
        m.favorite = favorite;
        return cat;
      }
    }
    return null;
  }

  /** The stored media message, if the index knows it (gate for streaming files / thumbnails). */
  mediaMessage(chatId: string, msgId: number): RawMsg | undefined {
    for (const [, bucket] of this.bucketsOf(chatId)) {
      const m = bucket.get(msgId);
      if (m?.kind === 'media') return m;
    }
    return undefined;
  }

  tombstones(): RawMsg[] {
    return [...this.msgs.values()].flatMap((b) =>
      [...b.values()].filter((m) => m.kind === 'tombstone'),
    );
  }

  /** Keep another store's tombstones (a rescan cannot see deleted messages). Returns touched categories. */
  carryTombstones(prev: IndexStore, prefix: string): Set<string> {
    const fresh = prev
      .tombstones()
      .filter((t) => this.chats.has(t.chatId))
      .filter((t) => !this.msgs.get(categoryId(t.chatId, t.topicId))?.has(t.id));
    for (const t of fresh) this.ensureCategory(t.chatId, t.topicId, prefix);
    return this.upsert(fresh);
  }

  rebuildCategory(cat: string): void {
    for (const id of this.itemIds.get(cat) ?? []) this.items.delete(id);
    const built = buildItems([...(this.msgs.get(cat)?.values() ?? [])], this.windowMin);
    for (const it of built) this.items.set(it.id, it);
    this.itemIds.set(
      cat,
      built.map((i) => i.id),
    );
  }

  rebuildAll(): void {
    for (const cat of this.msgs.keys()) this.rebuildCategory(cat);
  }

  removeChat(chatId: string): void {
    this.chats.delete(chatId);
    for (const [cat, c] of this.categories) {
      if (c.chatId !== chatId) continue;
      for (const id of this.itemIds.get(cat) ?? []) this.items.delete(id);
      this.itemIds.delete(cat);
      this.msgs.delete(cat);
      this.categories.delete(cat);
    }
  }

  setChatTitle(chatId: string, title: string): void {
    const c = this.chats.get(chatId);
    if (c) c.title = title;
  }

  allItems(): Item[] {
    return [...this.items.values()];
  }

  getItem(id: string): Item | undefined {
    return this.items.get(id);
  }

  categoryStats(): (Category & { count: number; favorites: number })[] {
    const stats = new Map<string, { count: number; favorites: number }>();
    for (const it of this.items.values()) {
      const s = stats.get(it.categoryId) ?? { count: 0, favorites: 0 };
      s.count++;
      if (it.favorite) s.favorites++;
      stats.set(it.categoryId, s);
    }
    return [...this.categories.values()].map((c) => ({
      ...c,
      count: stats.get(c.id)?.count ?? 0,
      favorites: stats.get(c.id)?.favorites ?? 0,
    }));
  }

  toSnapshot(): Snapshot {
    return {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      chats: [...this.chats.values()],
      categories: [...this.categories.values()],
      messages: [...this.msgs.values()].flatMap((b) => [...b.values()]),
    };
  }

  static fromSnapshot(s: Snapshot, windowMin = 0): IndexStore {
    const st = new IndexStore(windowMin);
    for (const c of s.chats) st.setChat(c);
    for (const c of s.categories) st.setCategory(c);
    st.upsert(s.messages);
    st.rebuildAll();
    return st;
  }
}

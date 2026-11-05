import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEvent, LiveIndex, replay, type LiveEvent } from './live.js';
import { IndexStore } from './store.js';
import type { MediaInfo, RawMsg } from './types.js';

const C = '-1001234567890';
const P = 'TBackup';
const msg = (id: number, o: Partial<RawMsg> = {}): RawMsg => ({
  id,
  chatId: C,
  topicId: null,
  date: 1_700_000_000 + id,
  kind: 'text',
  text: '',
  favorite: false,
  ...o,
});
const media = (id: number, m: Partial<MediaInfo> = {}, o: Partial<RawMsg> = {}) =>
  msg(id, { kind: 'media', media: { type: 'video', fileName: `f${id}.mp4`, ...m }, ...o });
const text = (id: number, t: string, o: Partial<RawMsg> = {}) => msg(id, { text: t, ...o });

function mkStore(forum = false): IndexStore {
  const st = new IndexStore();
  st.setChat({ id: C, title: 'TBackup - x', forum, lastId: 0 });
  if (!forum)
    st.setCategory({ id: C, chatId: C, topicId: null, name: 'x', groupName: null, order: 0 });
  return st;
}

/** apply events then rebuild, like LiveIndex.flush */
function run(st: IndexStore, ...evs: LiveEvent[]) {
  const touched = new Set<string>();
  for (const e of evs) for (const c of applyEvent(st, e, P).rebuild) touched.add(c);
  for (const c of touched) st.rebuildCategory(c);
}
const m = (msg: RawMsg): LiveEvent => ({ t: 'msg', msg });
const del = (...ids: number[]): LiveEvent => ({ t: 'delete', chatId: C, ids });
const item = (st: IndexStore, id: number) => st.getItem(`${C}_${id}`);

describe('new / edited messages', () => {
  it('new media appears; description message attaches; #tags searchable', () => {
    const st = mkStore();
    run(st, m(media(1)));
    expect(item(st, 1)?.description).toBe('');
    run(st, m(text(2, 'ซ้อมดนตรี #ซ้อม')));
    expect(item(st, 1)?.description).toBe('ซ้อมดนตรี #ซ้อม');
    expect(item(st, 1)?.tags).toEqual(['ซ้อม']);
  });
  it('edit text updates description, edit caption updates title', () => {
    const st = mkStore();
    run(st, m(media(1, {}, { text: 'old' })), m(text(2, 'a')));
    run(st, m(text(2, 'b')), m(media(1, {}, { text: 'new' })));
    expect(item(st, 1)?.description).toBe('b');
    expect(item(st, 1)?.title).toBe('new');
  });
  it('album arriving one photo at a time becomes one item', () => {
    const st = mkStore();
    run(st, ...[1, 2, 3].map((i) => m(media(i, { type: 'image' }, { groupedId: 'g' }))));
    expect(st.allItems()).toHaveLength(1);
    expect(item(st, 1)?.messageIds).toEqual([1, 2, 3]);
  });
  it('advances lastId; ignores chats not in the store yet', () => {
    const st = mkStore();
    run(st, m(media(5)));
    expect(st.lastId(C)).toBe(5);
    run(st, m(media(6, {}, { chatId: '-1009999999999' })));
    expect(st.allItems()).toHaveLength(1);
  });
});

describe('delete', () => {
  it('deleted description text disappears from the item', () => {
    const st = mkStore();
    run(st, m(media(1)), m(text(2, 'a')), m(text(3, 'b')));
    run(st, del(2));
    expect(item(st, 1)?.description).toBe('b');
  });
  it('deleted media: item gone, its text is NOT re-bound to the previous media', () => {
    const st = mkStore();
    run(st, m(media(1)), m(text(2, 'for-1')), m(media(3)), m(text(4, 'for-3')));
    run(st, del(3));
    expect(item(st, 3)).toBeUndefined();
    expect(item(st, 1)?.description).toBe('for-1');
  });
  it('album: deleting some photos keeps it; deleting all removes it without re-binding', () => {
    const st = mkStore();
    run(
      st,
      m(media(1)),
      m(text(2, 'v')),
      ...[3, 4, 5].map((i) => m(media(i, { type: 'image' }, { groupedId: 'g' }))),
      m(text(6, 'album text')),
    );
    run(st, del(4));
    expect(item(st, 3)?.messageIds).toEqual([3, 5]);
    run(st, del(5, 3));
    expect(item(st, 3)).toBeUndefined();
    expect(item(st, 1)?.description).toBe('v');
  });
  it('deleting highest album photo first then the rest still leaves no re-binding', () => {
    const st = mkStore();
    run(
      st,
      m(media(1)),
      ...[3, 4].map((i) => m(media(i, {}, { groupedId: 'g' }))),
      m(text(6, 'x')),
    );
    run(st, del(4));
    run(st, del(3));
    expect(item(st, 1)?.description).toBe('');
  });
  it('null chat id (basic group) only touches non-channel chats', () => {
    const st = mkStore();
    st.setChat({ id: '-555', title: 'TBackup - b', forum: false, lastId: 0 });
    st.setCategory({
      id: '-555',
      chatId: '-555',
      topicId: null,
      name: 'b',
      groupName: null,
      order: 0,
    });
    run(st, m(media(1)), m(media(1, {}, { chatId: '-555' })));
    run(st, { t: 'delete', chatId: null, ids: [1] });
    expect(st.getItem(`${C}_1`)).toBeDefined();
    expect(st.getItem('-555_1')).toBeUndefined();
  });
  it('a basic group id that merely starts with 100 is not treated as a channel', () => {
    const st = new IndexStore();
    st.setChat({ id: '-1001234', title: 'TBackup - b', forum: false, lastId: 0 });
    st.setCategory({
      id: '-1001234',
      chatId: '-1001234',
      topicId: null,
      name: 'b',
      groupName: null,
      order: 0,
    });
    run(st, m(media(1, {}, { chatId: '-1001234' })));
    run(st, { t: 'delete', chatId: null, ids: [1] });
    expect(st.allItems()).toEqual([]);
  });
});

describe('favorite (reaction)', () => {
  it('toggles on and off', () => {
    const st = mkStore();
    run(st, m(media(1)));
    run(st, { t: 'reaction', chatId: C, id: 1, favorite: true });
    expect(item(st, 1)?.favorite).toBe(true);
    run(st, { t: 'reaction', chatId: C, id: 1, favorite: false });
    expect(item(st, 1)?.favorite).toBe(false);
  });
  it('album: only the first photo counts', () => {
    const st = mkStore();
    run(st, m(media(1, {}, { groupedId: 'g' })), m(media(2, {}, { groupedId: 'g' })));
    run(st, { t: 'reaction', chatId: C, id: 2, favorite: true });
    expect(item(st, 1)?.favorite).toBe(false);
    run(st, { t: 'reaction', chatId: C, id: 1, favorite: true });
    expect(item(st, 1)?.favorite).toBe(true);
  });
  it('reaction on unknown / text message is a no-op', () => {
    const st = mkStore();
    run(st, m(text(1, 'x')));
    expect(applyEvent(st, { t: 'reaction', chatId: C, id: 1, favorite: true }, P).changed).toBe(
      false,
    );
    expect(applyEvent(st, { t: 'reaction', chatId: C, id: 99, favorite: true }, P).changed).toBe(
      false,
    );
  });
});

describe('topics', () => {
  it('create makes a category, messages land in it, edit renames/closes', () => {
    const st = mkStore(true);
    run(st, { t: 'topic', chatId: C, topicId: 77, create: true, title: 'ซ้อมดนตรี', emoji: '🎵' });
    expect(st.categories.get(`${C}:77`)).toMatchObject({
      name: 'ซ้อมดนตรี',
      emoji: '🎵',
      groupName: 'x',
      closed: false,
    });
    run(st, m(media(80, {}, { topicId: 77 })));
    expect(item(st, 80)?.categoryId).toBe(`${C}:77`);
    run(st, { t: 'topic', chatId: C, topicId: 77, create: false, title: 'ซ้อมใหญ่', closed: true });
    expect(st.categories.get(`${C}:77`)).toMatchObject({
      name: 'ซ้อมใหญ่',
      closed: true,
      emoji: '🎵',
    });
  });
  it('message in an unlisted topic gets a placeholder category (General = topic 1)', () => {
    const st = mkStore(true);
    run(st, m(media(1, {}, { topicId: 1 })), m(media(2, {}, { topicId: 9 })));
    expect(st.categories.get(`${C}:1`)?.name).toBe('General');
    expect(st.categories.get(`${C}:9`)?.name).toBe('Topic 9');
  });
  it('topic event for an unknown chat is ignored', () => {
    const st = mkStore(true);
    expect(
      applyEvent(st, { t: 'topic', chatId: '-1', topicId: 1, create: true, title: 'x' }, P).changed,
    ).toBe(false);
  });
});

describe('LiveIndex', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('coalesces a burst into one rebuild + one change callback', () => {
    const st = mkStore();
    const onChange = vi.fn();
    const live = new LiveIndex(() => st, P, onChange, 300);
    for (const i of [1, 2, 3, 4]) live.apply(m(media(i, { type: 'image' }, { groupedId: 'g' })));
    expect(st.allItems()).toHaveLength(0); // not rebuilt yet
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(st.allItems()).toHaveLength(1);
  });

  it('events during a rescan are replayed onto the new store', () => {
    const old = mkStore();
    const live = new LiveIndex(
      () => old,
      P,
      () => {},
      300,
    );
    live.startBuffering();
    live.apply(m(media(1)));
    live.apply(m(text(2, 'late text')));
    live.apply({ t: 'reaction', chatId: C, id: 1, favorite: true });

    const fresh = mkStore(); // rescan finished without seeing them
    replay(fresh, live.stopBuffering(), P);
    expect(item(fresh, 1)).toMatchObject({ description: 'late text', favorite: true });
  });
});

describe('rescan keeps tombstones', () => {
  it('text after a deleted media stays unbound after a rescan', () => {
    const prev = mkStore();
    run(prev, m(media(1)), m(media(3)), m(text(4, 'for-3')));
    run(prev, del(3));

    const next = mkStore(); // Telegram no longer has media 3
    for (const c of next.upsert([media(1), text(4, 'for-3')])) next.rebuildCategory(c);
    expect(item(next, 1)?.description).toBe('for-3'); // the bug a naive rescan would cause

    for (const c of next.carryTombstones(prev, P)) next.rebuildCategory(c);
    expect(item(next, 1)?.description).toBe('');
  });
  it('tombstones of chats that left the vault are dropped', () => {
    const prev = mkStore();
    run(prev, m(media(3)));
    run(prev, del(3));
    const next = new IndexStore();
    expect(next.carryTombstones(prev, P).size).toBe(0);
  });
});

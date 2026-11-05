import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSnapshot, saveSnapshot } from './snapshot.js';
import { IndexStore } from './store.js';
import type { RawMsg } from './types.js';

const C = '-1001';
const msg = (id: number, o: Partial<RawMsg>): RawMsg => ({
  id,
  chatId: C,
  topicId: null,
  date: 1_700_000_000 + id,
  kind: 'text',
  text: '',
  favorite: false,
  ...o,
});

function sample(): IndexStore {
  const st = new IndexStore();
  st.setChat({ id: C, title: 'TBackup - x', forum: false, lastId: 0 });
  st.setCategory({ id: C, chatId: C, topicId: null, name: 'x', groupName: null, order: 0 });
  const touched = st.upsert([
    msg(1, { kind: 'media', media: { type: 'video', fileName: 'a.mp4' } }),
    msg(2, { text: 'ซ้อมดนตรี #ซ้อม' }),
    msg(3, { kind: 'media', media: { type: 'pdf', fileName: 'b.pdf' }, favorite: true }),
  ]);
  for (const c of touched) st.rebuildCategory(c);
  return st;
}

describe('IndexStore', () => {
  it('derives items, tracks lastId, counts', () => {
    const st = sample();
    expect(
      st
        .allItems()
        .map((i) => i.id)
        .sort(),
    ).toEqual([`${C}_1`, `${C}_3`]);
    expect(st.getItem(`${C}_1`)?.description).toBe('ซ้อมดนตรี #ซ้อม');
    expect(st.lastId(C)).toBe(3);
    expect(st.categoryStats()[0]).toMatchObject({ count: 2, favorites: 1 });
  });

  it('rebuildCategory replaces stale items (edit text → description updates)', () => {
    const st = sample();
    for (const c of st.upsert([msg(2, { text: 'แก้แล้ว' })])) st.rebuildCategory(c);
    expect(st.getItem(`${C}_1`)?.description).toBe('แก้แล้ว');
    expect(st.getItem(`${C}_1`)?.tags).toEqual([]);
  });

  it('removeChat drops everything of that chat', () => {
    const st = sample();
    st.removeChat(C);
    expect(st.allItems()).toEqual([]);
    expect(st.categories.size).toBe(0);
  });
});

describe('snapshot', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'tgv-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('round-trips to identical items', async () => {
    const st = sample();
    const f = join(dir, 'sub', 'index.json');
    await saveSnapshot(f, st.toSnapshot());
    expect((await readdir(join(dir, 'sub'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    const back = IndexStore.fromSnapshot((await loadSnapshot(f))!);
    expect(back.allItems().sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      st.allItems().sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(back.lastId(C)).toBe(3);
  });

  it('missing, corrupt or wrong-version file → null (caller rescans)', async () => {
    expect(await loadSnapshot(join(dir, 'nope.json'))).toBeNull();
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{not json');
    expect(await loadSnapshot(bad)).toBeNull();
    await writeFile(bad, JSON.stringify({ version: 999, messages: [] }));
    expect(await loadSnapshot(bad)).toBeNull();
  });
});

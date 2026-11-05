import { describe, expect, it } from 'vitest';
import { listTags, searchItems } from './search.js';
import { buildSearchText } from './text.js';
import type { Item } from './types.js';

let seq = 0;
const mk = (o: Partial<Item> & { words?: string[] }): Item => {
  seq++;
  const { words = [], ...rest } = o;
  const it: Item = {
    id: `-1_${seq}`,
    categoryId: '-1',
    chatId: '-1',
    messageIds: [seq],
    type: 'video',
    title: words[0] ?? 't',
    caption: '',
    description: '',
    tags: [],
    favorite: false,
    postedAt: new Date(Date.UTC(2025, 0, seq)).toISOString(),
    searchText: '',
    ...rest,
  };
  it.searchText = buildSearchText([
    it.title,
    it.caption,
    it.description,
    it.fileName,
    ...it.tags,
    ...words,
  ]);
  return it;
};

const A = mk({ title: 'ซ้อมเพลง Heal the World รอบ 2', tags: ['ซ้อม', 'ดนตรี'] });
const B = mk({ title: 'งานกีฬาสี เขต 11', type: 'album', categoryId: '-2' });
const C = mk({
  title: 'report',
  fileName: 'Report.PDF',
  type: 'pdf',
  favorite: true,
  tags: ['ซ้อมใหญ่'],
});
const all = [A, B, C];
const ids = (q: Parameters<typeof searchItems>[1]) => searchItems(all, q).items.map((i) => i.title);

describe('search (Thai)', () => {
  it('substring without word boundaries', () => {
    expect(ids({ q: 'ซ้อม' })).toEqual([C.title, A.title]); // C matches via tag ซ้อมใหญ่
    expect(ids({ q: 'เพลง' })).toEqual([A.title]);
    expect(ids({ q: 'กีฬา' })).toEqual([B.title]);
  });
  it('AND across terms', () => {
    expect(ids({ q: 'ซ้อม heal' })).toEqual([A.title]);
    expect(ids({ q: 'ซ้อม กีฬา' })).toEqual([]);
  });
  it('case-insensitive, matches file name', () => {
    expect(ids({ q: 'HEAL' })).toEqual([A.title]);
    expect(ids({ q: 'report.pdf' })).toEqual([C.title]);
  });
  it('#tag is exact, not prefix/substring', () => {
    expect(ids({ q: '#ซ้อม' })).toEqual([A.title]);
    expect(ids({ q: '#ซ้อมใหญ่' })).toEqual([C.title]);
    expect(ids({ q: '#ซ้' })).toEqual([]);
  });
  it('#tag combines with plain terms; lone # ignored', () => {
    expect(ids({ q: '#ซ้อม heal' })).toEqual([A.title]);
    expect(ids({ q: '#ซ้อม กีฬา' })).toEqual([]);
    expect(ids({ q: '# heal' })).toEqual([A.title]);
  });
  it('tag param', () => {
    expect(ids({ tag: 'ดนตรี' })).toEqual([A.title]);
    expect(ids({ tag: '#ดนตรี' })).toEqual([A.title]);
  });
});

describe('filters / sort / paging', () => {
  it('category, type, fav', () => {
    expect(ids({ category: '-2' })).toEqual([B.title]);
    expect(ids({ type: 'pdf' })).toEqual([C.title]);
    expect(ids({ type: ['pdf', 'album'] })).toEqual([C.title, B.title]);
    expect(ids({ fav: true })).toEqual([C.title]);
    expect(ids({ type: 'pdf', fav: false })).toEqual([C.title]);
  });
  it('sort new→old default, old→new', () => {
    expect(ids({})).toEqual([C.title, B.title, A.title]);
    expect(ids({ sort: 'old' })).toEqual([A.title, B.title, C.title]);
  });
  it('keyset cursor pagination, both directions', () => {
    const p1 = searchItems(all, { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual([C.id, B.id]);
    const p2 = searchItems(all, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual([A.id]);
    expect(p2.nextCursor).toBeNull();

    const q1 = searchItems(all, { limit: 2, sort: 'old' });
    const q2 = searchItems(all, { limit: 2, sort: 'old', cursor: q1.nextCursor! });
    expect([...q1.items, ...q2.items].map((i) => i.id)).toEqual([A.id, B.id, C.id]);
  });
  it('limit clamps to 60', () => {
    const many = Array.from({ length: 100 }, () => mk({}));
    expect(searchItems(many, { limit: 500 }).items).toHaveLength(60);
  });
  it('listTags counts per category', () => {
    expect(listTags(all)).toEqual([
      { tag: 'ซ้อม', count: 1 },
      { tag: 'ซ้อมใหญ่', count: 1 },
      { tag: 'ดนตรี', count: 1 },
    ]);
    expect(listTags(all, '-2')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildItems } from './build.js';
import type { MediaInfo, RawMsg } from './types.js';

const C = '-1001';
const base = { chatId: C, topicId: null, favorite: false };
const m = (id: number, media: MediaInfo, o: Partial<RawMsg> = {}): RawMsg => ({
  ...base,
  id,
  date: 1_700_000_000 + id,
  kind: 'media',
  text: '',
  media,
  ...o,
});
const t = (id: number, text: string): RawMsg => ({
  ...base,
  id,
  date: 1_700_000_000 + id,
  kind: 'text',
  text,
});

describe('buildItems', () => {
  it('types: video / pdf / image / file', () => {
    const items = buildItems([
      m(1, { type: 'video', mimeType: 'video/mp4', duration: 61 }),
      m(2, { type: 'pdf', fileName: 'a.pdf' }),
      m(3, { type: 'image' }),
      m(4, { type: 'file', fileName: 'x.zip' }),
    ]);
    expect(items.map((i) => i.type)).toEqual(['video', 'pdf', 'image', 'file']);
    expect(items[0].duration).toBe(61);
  });

  it('album: groups by groupedId, first id is item id, albumItems in order', () => {
    const [it, ...rest] = buildItems([
      m(5, { type: 'image' }, { groupedId: 'g', text: 'งานกีฬาสี' }),
      m(6, { type: 'video' }, { groupedId: 'g' }),
      m(7, { type: 'image' }, { groupedId: 'g' }),
    ]);
    expect(rest).toEqual([]);
    expect(it.type).toBe('album');
    expect(it.id).toBe(`${C}_5`);
    expect(it.messageIds).toEqual([5, 6, 7]);
    expect(it.albumItems).toEqual([
      { messageId: 5, type: 'image' },
      { messageId: 6, type: 'video' },
      { messageId: 7, type: 'image' },
    ]);
    expect(it.caption).toBe('งานกีฬาสี');
  });

  it('description, tags and title from following text; search text includes them', () => {
    const [it] = buildItems([
      m(1, { type: 'video', fileName: 'IMG_1.mp4' }),
      t(2, 'ซ้อมดนตรี #ซ้อม'),
      t(3, '#ดนตรี'),
    ]);
    expect(it.description).toBe('ซ้อมดนตรี #ซ้อม\n#ดนตรี');
    expect(it.tags).toEqual(['ซ้อม', 'ดนตรี']);
    expect(it.title).toBe('ซ้อมดนตรี');
    expect(it.searchText).toContain('img_1.mp4');
    expect(it.searchText).toContain('ซ้อม');
  });

  it('caption + description tags merge', () => {
    const [it] = buildItems([m(1, { type: 'image' }, { text: 'x #a' }), t(2, '#b #a')]);
    expect(it.tags).toEqual(['a', 'b']);
  });

  it('PDF with no text uses file name as title', () => {
    const [it] = buildItems([m(1, { type: 'pdf', fileName: 'report.pdf' })]);
    expect(it.title).toBe('report.pdf');
    expect(it.description).toBe('');
  });

  it('favorite follows the first message of an album', () => {
    const [a] = buildItems([
      m(1, { type: 'image' }, { groupedId: 'g', favorite: true }),
      m(2, { type: 'image' }, { groupedId: 'g' }),
    ]);
    const [b] = buildItems([
      m(1, { type: 'image' }, { groupedId: 'g' }),
      m(2, { type: 'image' }, { groupedId: 'g', favorite: true }),
    ]);
    expect(a.favorite).toBe(true);
    expect(b.favorite).toBe(false);
  });

  it('postedAt is ISO of first message; categoryId includes topic', () => {
    const [it] = buildItems([m(9, { type: 'image' }, { topicId: 7 })]);
    expect(it.postedAt).toBe(new Date((1_700_000_000 + 9) * 1000).toISOString());
    expect(it.categoryId).toBe(`${C}:7`);
  });

  it('respects description window', () => {
    const [it] = buildItems(
      [m(1, { type: 'image' }), { ...t(2, 'late'), date: 1_700_000_001 + 3600 }],
      10,
    );
    expect(it.description).toBe('');
  });
});

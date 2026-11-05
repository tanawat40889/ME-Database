import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtSize } from './format';
import { snippet, splitHighlight } from './highlight';
import { CHIPS, chipOf, listKey, paramsFromSearch, withChip, withParam } from './query';

describe('format', () => {
  it('duration', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(3725)).toBe('1:02:05');
    expect(fmtDuration(59.6)).toBe('1:00');
    expect(fmtDuration(undefined)).toBe('');
  });
  it('size', () => {
    expect(fmtSize(0)).toBe('0 B');
    expect(fmtSize(1536)).toBe('1.5 KB');
    expect(fmtSize(1024 ** 3)).toBe('1.0 GB');
    expect(fmtSize(25 * 1024 ** 2)).toBe('25 MB');
    expect(fmtSize(undefined)).toBe('');
  });
});

describe('splitHighlight', () => {
  const join = (s: { text: string; hit: boolean }[]) =>
    s.map((x) => (x.hit ? `[${x.text}]` : x.text)).join('');
  it('Thai substring, no word breaks', () => {
    expect(join(splitHighlight('ซ้อมเพลง Heal the World รอบ 2', 'ซ้อม'))).toBe(
      '[ซ้อม]เพลง Heal the World รอบ 2',
    );
    expect(join(splitHighlight('ซ้อมเพลงซ้อมใหญ่', 'ซ้อม'))).toBe('[ซ้อม]เพลง[ซ้อม]ใหญ่');
  });
  it('case-insensitive, several terms, longest first', () => {
    expect(join(splitHighlight('Heal the World', 'world heal'))).toBe('[Heal] the [World]');
    expect(join(splitHighlight('abcd', 'ab abc'))).toBe('[abc]d');
  });
  it('regex characters are literal', () => {
    expect(join(splitHighlight('a.b (c)', 'a.b (c)'))).toBe('[a.b] [(c)]');
    expect(join(splitHighlight('axb', 'a.b'))).toBe('axb');
  });
  it('#tag words and empty query highlight nothing', () => {
    expect(join(splitHighlight('ซ้อม #ซ้อม', '#ซ้อม'))).toBe('ซ้อม #ซ้อม');
    expect(join(splitHighlight('abc', ''))).toBe('abc');
    expect(join(splitHighlight('abc', undefined))).toBe('abc');
    expect(splitHighlight('', 'a')).toEqual([{ text: '', hit: false }]);
  });
  it('concatenating segments gives back the text', () => {
    const t = 'ซ้อมดนตรี Rock ซ้อม';
    expect(
      splitHighlight(t, 'ซ้อม rock')
        .map((s) => s.text)
        .join(''),
    ).toBe(t);
  });
});

describe('snippet', () => {
  it('short text unchanged, whitespace flattened', () => {
    expect(snippet('a\n b', undefined)).toBe('a b');
  });
  it('long text: starts at the beginning without a match', () => {
    expect(snippet('x'.repeat(200), undefined, 50)).toBe('x'.repeat(50) + '…');
  });
  it('centres on a late match', () => {
    const t = 'a'.repeat(100) + 'ซ้อม' + 'b'.repeat(100);
    const s = snippet(t, 'ซ้อม', 60);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('ซ้อม');
    expect(s.length).toBeLessThanOrEqual(62);
  });
});

describe('query params', () => {
  const sp = (s: string) => new URLSearchParams(s);
  it('paramsFromSearch', () => {
    expect(paramsFromSearch(sp('q=%20ซ้อม%20&type=video&tag=a&fav=1'), 'c1')).toEqual({
      category: 'c1',
      q: 'ซ้อม',
      type: 'video',
      tag: 'a',
      fav: true,
    });
    expect(paramsFromSearch(sp(''))).toEqual({
      category: undefined,
      q: undefined,
      type: undefined,
      tag: undefined,
      fav: undefined,
    });
  });
  it('chips are exclusive and round-trip', () => {
    for (const c of CHIPS)
      expect(chipOf(paramsFromSearch(withChip(sp('q=x&tag=t'), c.id)))).toBe(c.id);
    expect(withChip(sp('type=video'), 'fav').toString()).toBe('fav=1');
    expect(withChip(sp('fav=1&q=x'), 'image').toString()).toBe('q=x&type=image%2Calbum');
    expect(withChip(sp('type=pdf'), 'all').toString()).toBe('');
  });
  it('withParam sets and clears', () => {
    expect(withParam(sp('a=1'), 'tag', 'x').toString()).toBe('a=1&tag=x');
    expect(withParam(sp('a=1&tag=x'), 'tag', undefined).toString()).toBe('a=1');
  });
  it('listKey differs per filter', () => {
    const a = listKey({ category: 'c' });
    expect(
      new Set([
        a,
        listKey({ category: 'c', q: 'x' }),
        listKey({ category: 'c', fav: true }),
        listKey({ category: 'd' }),
      ]).size,
    ).toBe(4);
    expect(listKey({ category: 'c' })).toBe(a);
  });
});

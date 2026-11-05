import { describe, expect, it } from 'vitest';
import { buildSearchText, extractTags, makeTitle, normalize } from './text.js';

describe('extractTags', () => {
  it('handles Thai vowels and tone marks', () => {
    expect(extractTags('ซ้อมเพลง #ซ้อม #ดนตรี #เพลงรัก_2')).toEqual(['ซ้อม', 'ดนตรี', 'เพลงรัก_2']);
  });
  it('lower-cases, dedupes, merges multiple texts', () => {
    expect(extractTags('#Music #music', '#ซ้อม #MUSIC')).toEqual(['music', 'ซ้อม']);
  });
  it('stops at punctuation', () => {
    expect(extractTags('#a,#b. #c!')).toEqual(['a', 'b', 'c']);
  });
  it('ignores lone #', () => {
    expect(extractTags('# not a tag')).toEqual([]);
  });
});

describe('normalize', () => {
  it('lower-case + NFC + collapse spaces', () => {
    expect(normalize('  Café   TEST\n x ')).toBe('café test x');
    expect(normalize('Café')).toBe(normalize('Café'));
  });
});

describe('makeTitle', () => {
  it('first caption line without hashtags', () => {
    expect(makeTitle('ซ้อมเพลง #ซ้อม\nบรรทัดสอง', '')).toBe('ซ้อมเพลง');
  });
  it('falls to description when caption is only tags', () => {
    expect(makeTitle('#ซ้อม', 'ซ้อมเพลง Heal the World รอบ 2\n#ดนตรี')).toBe(
      'ซ้อมเพลง Heal the World รอบ 2',
    );
  });
  it('falls to file name', () => {
    expect(makeTitle('', '', 'doc.pdf')).toBe('doc.pdf');
    expect(makeTitle('#a', '#b', 'doc.pdf')).toBe('doc.pdf');
  });
  it('empty when nothing', () => {
    expect(makeTitle('', '')).toBe('');
  });
});

describe('buildSearchText', () => {
  it('joins normalized parts, skipping empties', () => {
    expect(buildSearchText(['Title', undefined, 'ซ้อม  ดนตรี', ''])).toBe('title ซ้อม ดนตรี');
  });
});

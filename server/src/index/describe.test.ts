import { describe, expect, it } from 'vitest';
import { bindDescriptions, type SeqMsg } from './describe.js';

const media = (id: number, date = 0, groupedId?: string): SeqMsg => ({
  id,
  kind: 'media',
  date,
  groupedId,
  text: '',
});
const text = (id: number, t: string, date = 0): SeqMsg => ({ id, kind: 'text', date, text: t });
const gone = (id: number): SeqMsg => ({ id, kind: 'tombstone', date: 0, text: '' });
const desc = (seq: SeqMsg[], w = 0) =>
  Object.fromEntries(bindDescriptions(seq, w).map((u) => [u.key, u.description]));

describe('bindDescriptions (SPEC §5)', () => {
  it('spec example', () => {
    const seq = [
      media(1), // video A
      text(2, 'ซ้อมเพลง Heal the World รอบ 2'),
      text(3, '#ดนตรี #ซ้อม'),
      media(4, 0, 'g'), // album B (8 photos)
      ...[5, 6, 7, 8, 9, 10, 11].map((i) => media(i, 0, 'g')),
      text(12, 'งานกีฬาสี เขต 11'),
      text(13, '// โน้ต: เดี๋ยวอัปเพิ่ม'),
      media(14), // PDF C
    ];
    const u = bindDescriptions(seq);
    expect(u.map((x) => x.key)).toEqual([1, 4, 14]);
    expect(u[0].description).toBe('ซ้อมเพลง Heal the World รอบ 2\n#ดนตรี #ซ้อม');
    expect(u[1].messageIds).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(u[1].description).toBe('งานกีฬาสี เขต 11');
    expect(u[2].description).toBe('');
  });

  it('joins consecutive text with newline until next media', () => {
    expect(desc([media(1), text(2, 'a'), text(3, 'b'), media(4), text(5, 'c')])).toEqual({
      1: 'a\nb',
      4: 'c',
    });
  });

  it('text before first media is skipped', () => {
    expect(desc([text(1, 'orphan'), media(2), text(3, 'x')])).toEqual({ 2: 'x' });
  });

  it('// note is not bound and does not break the run', () => {
    expect(desc([media(1), text(2, 'a'), text(3, '  // note'), text(4, 'b')])).toEqual({
      1: 'a\nb',
    });
  });

  it('window=0 means unlimited', () => {
    expect(desc([media(1, 0), text(2, 'late', 999999)])).toEqual({ 1: 'late' });
  });

  it('window>0 binds only text within N minutes of the media', () => {
    const seq = [media(1, 1000), text(2, 'in', 1000 + 5 * 60), text(3, 'out', 1000 + 11 * 60)];
    expect(desc(seq, 10)).toEqual({ 1: 'in' });
  });

  it('window is measured from the last album photo', () => {
    const seq = [media(1, 0, 'g'), media(2, 590, 'g'), text(3, 'ok', 1100)];
    expect(desc(seq, 10)).toEqual({ 1: 'ok' });
  });

  it('deleted media: its text is NOT moved to the previous media', () => {
    expect(
      desc([
        media(1),
        text(2, 'for-1'),
        gone(3),
        text(4, 'for-deleted'),
        media(5),
        text(6, 'for-5'),
      ]),
    ).toEqual({
      1: 'for-1',
      5: 'for-5',
    });
  });

  it('deleted text message just disappears from the description', () => {
    expect(desc([media(1), text(2, 'a'), text(4, 'c')])).toEqual({ 1: 'a\nc' });
  });

  it('sorts by id regardless of input order', () => {
    expect(desc([text(3, 'b'), media(1), text(2, 'a')])).toEqual({ 1: 'a\nb' });
  });

  it('two different albums back to back stay separate', () => {
    const u = bindDescriptions([
      media(1, 0, 'a'),
      media(2, 0, 'a'),
      media(3, 0, 'b'),
      text(4, 'x'),
    ]);
    expect(u.map((x) => x.messageIds)).toEqual([[1, 2], [3]]);
    expect(u[1].description).toBe('x');
  });
});

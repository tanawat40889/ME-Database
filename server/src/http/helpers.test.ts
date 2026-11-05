import { Api } from 'telegram';
import { describe, expect, it } from 'vitest';
import {
  FavoriteError,
  chosenFrom,
  nextReactions,
  setFavoriteReaction,
} from '../telegram/reactions.js';
import { pickThumb } from '../telegram/thumb.js';
import { BLOCK, parseRange, sliceRange } from './range.js';
import { Semaphore } from './semaphore.js';

describe('parseRange', () => {
  const S = 10_000;
  it.each([
    [undefined, { kind: 'full' }],
    ['bytes=0-1023', { kind: 'partial', start: 0, end: 1023 }],
    ['bytes=5000-', { kind: 'partial', start: 5000, end: 9999 }],
    ['bytes=9000-99999', { kind: 'partial', start: 9000, end: 9999 }],
    ['bytes=-500', { kind: 'partial', start: 9500, end: 9999 }],
    ['bytes=-99999', { kind: 'partial', start: 0, end: 9999 }],
    ['bytes=0-0', { kind: 'partial', start: 0, end: 0 }],
  ])('%s', (h, out) => expect(parseRange(h, S)).toEqual(out));

  it.each([
    'bytes=10000-',
    'bytes=20000-30000',
    'bytes=5-4',
    'bytes=-0',
    'bytes=-',
    'bytes=a-b',
    'items=0-1',
    'bytes=0-1,5-6',
    'bytes=1.5-2',
  ])('%s → invalid', (h) => expect(parseRange(h, S)).toEqual({ kind: 'invalid' }));
  it('empty file: every range invalid', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'invalid' });
  });
});

describe('sliceRange (4096-aligned source)', () => {
  const SIZE = 50_000;
  const byte = (i: number) => (i * 7 + 3) % 251;
  const data = Buffer.from(Array.from({ length: SIZE }, (_, i) => byte(i)));
  const CHUNK = 8192;
  const opens: number[] = [];
  const open = (offset: number) => {
    expect(offset % BLOCK).toBe(0); // the source rejects unaligned offsets, like Telegram
    opens.push(offset);
    return (async function* () {
      for (let p = offset; p < SIZE; p += CHUNK)
        yield new Uint8Array(data.subarray(p, Math.min(p + CHUNK, SIZE)));
    })();
  };
  const read = async (s: number, e: number) => {
    const parts: Buffer[] = [];
    for await (const c of sliceRange(open, s, e)) parts.push(c);
    return Buffer.concat(parts);
  };

  it.each([
    [0, 1023],
    [5000, 9999], // start not on a block boundary
    [4096, 4096],
    [4095, 4097],
    [8191, 8192],
    [12345, 40000], // spans many chunks, unaligned both ends
    [SIZE - 1, SIZE - 1],
    [0, SIZE - 1],
  ])('bytes %i-%i exact', async (s, e) => {
    const got = await read(s, e);
    expect(got.length).toBe(e - s + 1);
    expect(got.equals(data.subarray(s, e + 1))).toBe(true);
  });

  it('starts the download at the block below start', async () => {
    opens.length = 0;
    await read(5000, 5100);
    expect(opens).toEqual([4096]);
  });

  it('stops pulling chunks once the range is served', async () => {
    let pulled = 0;
    const it = sliceRange(
      () =>
        (async function* () {
          for (let i = 0; i < 100; i++) {
            pulled++;
            yield new Uint8Array(4096);
          }
        })(),
      0,
      100,
    );
    for await (const c of it) void c;
    expect(pulled).toBe(1);
  });

  it('throws if the source ends early (never sends a short body silently)', async () => {
    await expect(
      (async () => {
        for await (const c of sliceRange(
          () =>
            (async function* () {
              yield new Uint8Array(10);
            })(),
          0,
          99,
        ))
          void c;
      })(),
    ).rejects.toThrow(/short read/);
  });
});

describe('Semaphore', () => {
  it('limits concurrency and releases in order', async () => {
    const s = new Semaphore(2);
    const a = await s.acquire();
    const b = await s.acquire();
    let got = false;
    const p = s.acquire().then((r) => ((got = true), r));
    await Promise.resolve();
    expect(got).toBe(false);
    expect(s.waiting).toBe(1);
    a();
    const c = await p;
    expect(got).toBe(true);
    a(); // double release is a no-op
    b();
    c();
    expect(s.waiting).toBe(0);
  });
  it('abort while queued removes the waiter without leaking a slot', async () => {
    const s = new Semaphore(1);
    const hold = await s.acquire();
    const ac = new AbortController();
    const p = s.acquire(ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow('aborted');
    expect(s.waiting).toBe(0);
    hold();
    const again = await s.acquire();
    again();
  });
});

describe('pickThumb', () => {
  const ps = (type: string, w: number) => new Api.PhotoSize({ type, w, h: w, size: w });
  it('widest up to 480', () => {
    expect(pickThumb([ps('s', 90), ps('m', 320), ps('x', 800)])).toMatchObject({ type: 'm' });
  });
  it('all too big → smallest', () => {
    expect(pickThumb([ps('x', 800), ps('y', 1280)])).toMatchObject({ type: 'x' });
  });
  it('stripped only as last resort; none → undefined', () => {
    const stripped = new Api.PhotoStrippedSize({ type: 'i', bytes: Buffer.alloc(1) });
    expect(pickThumb([stripped])).toBe(stripped);
    expect(pickThumb([stripped, ps('s', 90)])).toMatchObject({ type: 's' });
    expect(pickThumb([])).toBeUndefined();
    expect(pickThumb(undefined)).toBeUndefined();
  });
});

describe('favorite reactions', () => {
  const e = (s: string) => new Api.ReactionEmoji({ emoticon: s });
  const names = (r: Api.TypeReaction[]) => r.map((x) => (x as Api.ReactionEmoji).emoticon);

  it('chosenFrom: only ours, in chosen order', () => {
    const r = new Api.MessageReactions({
      results: [
        new Api.ReactionCount({ count: 9, reaction: e('👍') }),
        new Api.ReactionCount({ count: 1, chosenOrder: 1, reaction: e('🔥') }),
        new Api.ReactionCount({ count: 1, chosenOrder: 0, reaction: e('🎉') }),
      ],
    });
    expect(names(chosenFrom(r))).toEqual(['🎉', '🔥']);
    expect(chosenFrom(undefined)).toEqual([]);
  });
  it('add keeps our other reactions; sends bare heart', () => {
    expect(names(nextReactions([e('🔥')], '❤️', true))).toEqual(['🔥', '❤']);
  });
  it('add is idempotent; remove drops only the heart (any VS form)', () => {
    expect(names(nextReactions([e('❤️')], '❤️', true))).toEqual(['❤']);
    expect(names(nextReactions([e('🔥'), e('❤️')], '❤', false))).toEqual(['🔥']);
    expect(nextReactions([e('❤')], '❤️', false)).toEqual([]);
  });

  const io = (chosen: Api.TypeReaction[], fail: (n: number) => unknown = () => null) => {
    const sent: string[][] = [];
    return {
      sent,
      chosen: async () => chosen,
      send: async (r: Api.TypeReaction[]) => {
        const f = fail(sent.length);
        sent.push(names(r));
        if (f) throw f;
      },
    };
  };
  const rpc = (m: string) => Object.assign(new Error(m), { errorMessage: m });

  it('sends the merged list', async () => {
    const x = io([e('🔥')]);
    await setFavoriteReaction(x, '❤️', true);
    expect(x.sent).toEqual([['🔥', '❤']]);
  });
  it('REACTIONS_TOO_MANY (non-Premium) → retry with only the heart', async () => {
    const x = io([e('🔥')], (n) => (n === 0 ? rpc('REACTIONS_TOO_MANY') : null));
    await setFavoriteReaction(x, '❤️', true);
    expect(x.sent).toEqual([['🔥', '❤'], ['❤']]);
  });
  it('REACTION_INVALID → readable error mentioning how to fix', async () => {
    const x = io([], () => rpc('REACTION_INVALID'));
    const err = await setFavoriteReaction(x, '❤️', true).catch((z) => z);
    expect(err).toBeInstanceOf(FavoriteError);
    expect(err.code).toBe('chat_reaction_disabled');
    expect(err.message).toContain('Reactions');
  });
  it('other errors → telegram_error', async () => {
    const x = io([], () => rpc('FLOOD_X'));
    const err = await setFavoriteReaction(x, '❤️', false).catch((z) => z);
    expect(err.code).toBe('telegram_error');
  });
});
